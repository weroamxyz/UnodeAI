/*---------------------------------------------------------------------------------------------
 *  UnodeAi - WorkflowEngine
 *  Drives multi-agent workflows by sending task.assign messages and advancing when the
 *  assigned agent reports task.complete (republished by SessionManager from the backend).
 *
 *  Templates reference agents by ROLE (e.g. 'senior-dev'); at run time each role is resolved to
 *  a concrete session via SessionManager.resolveByRoleOrId. (The previous implementation looked
 *  sessions up by role against a map keyed by UUID, so no step could ever start.)
 *--------------------------------------------------------------------------------------------*/

import { v4 as uuidv4 } from 'uuid';
import { SessionManager } from '../session/SessionManager';
import { MessageBus } from '../bus/MessageBus';
import {
  Message,
  MessagePayload,
  WorkflowConfig,
  WorkflowInstance,
  WorkflowStep,
} from '../types';
import { TierController } from './TierController';
import { WorkflowGate, decideGate, resolveBranch } from './GatedWorkflow';
import { validateWorkflowGotos } from './workflowSerialize';

/** Safety cap on step transitions per instance, so a misconfigured loop branch can't run forever. */
const MAX_TRANSITIONS = 100;

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  builtin?: boolean;
  /** P2: gates evaluated after a step (objective run_checks + tier switching + retry). */
  gates?: WorkflowGate[];
}

export interface WorkflowAuthoringStore {
  loadTeamConfig(): Promise<{ workflows: WorkflowConfig[] } | undefined>;
  saveCustomWorkflows(workflows: WorkflowConfig[]): Promise<void>;
}

/** Deterministic gate machinery the engine uses for gated workflows (injected, optional). */
export interface GateDeps {
  /** Switch agents between model tiers on pass/fail (cost arbitrage). */
  tierController?: TierController;
  /**
   * Objective check (build/type-check/test the whole project). `blocked: true` means the check
   * could not run at all (e.g. command execution disabled by policy) — a CONFIG problem, not a
   * quality failure, so the gate pauses with guidance instead of escalating/retrying.
   */
  runChecks?: () => Promise<{ ok: boolean; output?: string; blocked?: boolean }>;
}

const BUILTIN_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'code-review',
    name: 'Code Review Pipeline',
    description: 'Senior dev writes code → Tester runs tests → Security audits',
    steps: [
      { id: 'step1', from: 'architect', to: 'senior-dev', action: 'Implement the requested change with tests', autoTransition: true },
      { id: 'step2', from: 'senior-dev', to: 'tester', action: 'Run and extend the test suite for the change', autoTransition: true },
      { id: 'step3', from: 'tester', to: 'security', action: 'Security-audit the change', autoTransition: true },
    ],
  },
  {
    id: 'feature-implement',
    name: 'Feature Implementation',
    description: 'Architect designs → Senior dev implements → QA validates',
    steps: [
      { id: 'step1', from: 'pm', to: 'architect', action: 'Produce a design spec for the feature', autoTransition: true },
      { id: 'step2', from: 'architect', to: 'senior-dev', action: 'Implement the design spec', autoTransition: true },
      { id: 'step3', from: 'senior-dev', to: 'tester', action: 'Validate the implementation', autoTransition: true },
    ],
  },
  {
    id: 'bug-fix',
    name: 'Bug Fix Pipeline',
    description: 'Tester reproduces → Senior dev fixes → Tester verifies',
    steps: [
      { id: 'step1', from: 'pm', to: 'senior-dev', action: 'Diagnose and fix the reported bug', autoTransition: true },
      { id: 'step2', from: 'senior-dev', to: 'tester', action: 'Verify the fix and guard it with a regression test', autoTransition: true },
    ],
  },
  {
    id: 'docs-generate',
    name: 'Documentation Generation',
    description: 'Senior dev explains code → Tech writer documents',
    steps: [
      { id: 'step1', from: 'senior-dev', to: 'tech-writer', action: 'Document the code/system for developers', autoTransition: true },
    ],
  },
  {
    id: 'feature-gated',
    name: 'Feature (Gated, cost-optimized)',
    description: 'Architect designs → Dev implements → run_checks gate (escalate model on fail) → QA validates',
    steps: [
      { id: 'design', from: 'pm', to: 'architect', action: 'Design the feature + public contracts', autoTransition: true },
      { id: 'code', from: 'architect', to: 'senior-dev', action: 'Implement to the contracts with tests', autoTransition: true },
      { id: 'qa', from: 'senior-dev', to: 'tester', action: 'Validate the implementation', autoTransition: true },
    ],
    // After implementation: run_checks. Pass → drop the dev back to economy (cost arbitrage);
    // fail → escalate the dev to premium and retry (up to 2), else pause for a human.
    gates: [
      {
        after: 'code',
        objective: true,
        onPass: { 'senior-dev': 'economy' },
        onFail: { setTier: { 'senior-dev': 'premium' }, maxRetries: 2, onExhaust: 'human' },
      },
    ],
  },
];

export class WorkflowEngine {
  private activeWorkflows = new Map<string, WorkflowInstance>();
  private disposers = new Map<string, () => void>();
  /** Gates per active instance (kept out of WorkflowConfig; also mirrored into context for L3). */
  private gates = new Map<string, WorkflowGate[]>();

  constructor(
    private sessionManager: SessionManager,
    private messageBus: MessageBus,
    /** Invoked whenever workflow state changes, so the host can persist it (L3 recovery). */
    private onChange: () => void = () => {},
    /** Optional gate machinery (run_checks + tier switching) for gated workflows. */
    private gateDeps: GateDeps = {},
    private authoringStore?: WorkflowAuthoringStore
  ) {}

  getWorkflowTemplates(): WorkflowTemplate[] {
    return BUILTIN_TEMPLATES.map((template) => ({ ...template, builtin: true }));
  }

  async listWorkflows(): Promise<WorkflowTemplate[]> {
    const custom = (await this.authoringStore?.loadTeamConfig())?.workflows ?? [];
    return [
      ...this.getWorkflowTemplates(),
      ...custom.map(workflowToTemplate),
    ];
  }

  async saveWorkflow(workflow: WorkflowConfig): Promise<{ ok: true } | { ok: false; error: string }> {
    const prepared = normalizeWorkflow(workflow);
    if (!prepared.id) {
      return { ok: false, error: 'Workflow id is required.' };
    }
    if (!prepared.name) {
      return { ok: false, error: 'Workflow name is required.' };
    }
    if (BUILTIN_TEMPLATES.some((template) => template.id === prepared.id)) {
      return { ok: false, error: `Workflow "${prepared.id}" is built-in and cannot be overwritten.` };
    }
    const gotoError = validateWorkflowGotos(prepared);
    if (gotoError) {
      return { ok: false, error: gotoError };
    }
    if (!this.authoringStore) {
      return { ok: false, error: 'Workflow persistence is not available.' };
    }

    const current = (await this.authoringStore.loadTeamConfig())?.workflows ?? [];
    const next = current.filter((item) => item.id !== prepared.id);
    next.push(prepared);
    await this.authoringStore.saveCustomWorkflows(next);
    return { ok: true };
  }

  async deleteWorkflow(id: string): Promise<void> {
    if (BUILTIN_TEMPLATES.some((template) => template.id === id) || !this.authoringStore) {
      return;
    }
    const current = (await this.authoringStore.loadTeamConfig())?.workflows ?? [];
    await this.authoringStore.saveCustomWorkflows(current.filter((item) => item.id !== id));
  }

  getActiveWorkflows(): WorkflowInstance[] {
    return Array.from(this.activeWorkflows.values());
  }

  getWorkflow(workflowId: string): WorkflowInstance | undefined {
    return this.activeWorkflows.get(workflowId);
  }

  /**
   * Start a workflow from a template. `seedContext` (e.g. the user's feature description) is
   * passed to the first step so the chain has something concrete to work on.
   */
  async run(
    templateOrId: string | WorkflowTemplate,
    seedContext: Record<string, unknown> = {}
  ): Promise<WorkflowInstance> {
    const template =
      typeof templateOrId === 'string'
        ? BUILTIN_TEMPLATES.find((t) => t.id === templateOrId)
        : templateOrId;
    if (!template) {
      throw new Error(`Workflow template '${String(templateOrId)}' not found`);
    }

    // Validate every referenced role resolves to a present agent before starting.
    const missing = new Set<string>();
    for (const step of template.steps) {
      if (!this.sessionManager.resolveByRoleOrId(step.to)) {
        missing.add(step.to);
      }
    }
    if (missing.size > 0) {
      throw new Error(
        `Workflow needs agents for: ${[...missing].join(', ')}. Add them to your team first.`
      );
    }

    const config: WorkflowConfig = {
      id: template.id,
      name: template.name,
      description: template.description,
      steps: template.steps,
    };

    const instance: WorkflowInstance = {
      id: uuidv4(),
      config,
      status: 'running',
      currentStep: config.steps[0]?.id,
      startedAt: new Date().toISOString(),
      context: seedContext,
    };
    this.activeWorkflows.set(instance.id, instance);
    if (template.gates && template.gates.length > 0) {
      this.gates.set(instance.id, template.gates);
      instance.context.__gates = template.gates; // mirror for L3 restore
    }
    this.subscribe(instance);
    this.onChange();

    this.executeStep(instance, config.steps[0]);
    return instance;
  }

  /**
   * L3 recovery (P1#5): re-arm workflow instances persisted before a reload and re-issue their
   * current step, so an interrupted workflow resumes instead of being silently lost. Only
   * 'running' instances are restored; finished ones are ignored.
   */
  restore(instances: WorkflowInstance[]): void {
    for (const instance of instances) {
      if (instance.status !== 'running' || this.activeWorkflows.has(instance.id)) {
        continue;
      }
      const step = instance.config.steps.find((s) => s.id === instance.currentStep);
      if (!step || !this.sessionManager.resolveByRoleOrId(step.to)) {
        continue; // can't resume a step whose agent is gone
      }
      this.activeWorkflows.set(instance.id, instance);
      const gates = instance.context.__gates as WorkflowGate[] | undefined;
      if (Array.isArray(gates) && gates.length > 0) {
        this.gates.set(instance.id, gates);
      }
      this.subscribe(instance);
      this.executeStep(instance, step); // re-assign the in-flight step that was interrupted
    }
    this.onChange();
  }

  /** Running instances worth persisting for L3 recovery. */
  exportState(): WorkflowInstance[] {
    return this.getActiveWorkflows().filter((w) => w.status === 'running');
  }

  /** Wire a (new or restored) instance to advance when its current step completes. */
  private subscribe(instance: WorkflowInstance): void {
    const offComplete = this.messageBus.onType('task.complete', (msg) =>
      this.onStepResult(instance.id, msg, false)
    );
    const offError = this.messageBus.onType('system.error', (msg) =>
      this.onStepResult(instance.id, msg, true)
    );
    this.disposers.set(instance.id, () => {
      offComplete();
      offError();
    });
  }

  cancel(workflowId: string): void {
    const instance = this.activeWorkflows.get(workflowId);
    if (instance && instance.status === 'running') {
      instance.status = 'cancelled';
      instance.completedAt = new Date().toISOString();
      this.cleanup(workflowId);
      this.onChange();
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────

  private executeStep(instance: WorkflowInstance, step: WorkflowStep | undefined): void {
    if (!step) {
      this.finish(instance, 'completed');
      return;
    }

    const worker = this.sessionManager.resolveByRoleOrId(step.to);
    if (!worker) {
      instance.status = 'failed';
      instance.completedAt = new Date().toISOString();
      this.cleanup(instance.id);
      this.onChange();
      return;
    }

    instance.currentStep = step.id;
    const sender = this.sessionManager.resolveByRoleOrId(step.from)?.id ?? 'workflow';

    const payload: MessagePayload = {
      instruction: step.action,
      context: instance.context,
      metadata: { workflowId: instance.id, step: step.id },
    };

    // correlationId = instance.id lets us match the completion back to this run.
    this.messageBus.send(sender, worker.id, 'task.assign', payload, 'high', instance.id);
  }

  private onStepResult(instanceId: string, msg: Message, isError: boolean): void {
    if (msg.correlationId !== instanceId) {
      return;
    }
    const instance = this.activeWorkflows.get(instanceId);
    if (!instance || instance.status !== 'running') {
      return;
    }

    if (isError) {
      instance.status = 'failed';
      instance.completedAt = new Date().toISOString();
      this.cleanup(instanceId);
      this.onChange();
      return;
    }

    // Carry the step's output forward as context for the next agent.
    instance.context = {
      ...instance.context,
      [`${instance.currentStep}_output`]: msg.payload.instruction ?? '',
    };

    const steps = instance.config.steps;
    const idx = steps.findIndex((s) => s.id === instance.currentStep);
    const completedStep = idx >= 0 ? steps[idx] : undefined;
    const next = idx >= 0 ? steps[idx + 1] : undefined;

    // P2: if a gate sits after this step, evaluate it (objective check + tier switch + retry)
    // before advancing. Non-gated steps keep the original linear behavior.
    const gate = this.gates.get(instanceId)?.find((g) => g.after === instance.currentStep);
    if (gate && completedStep) {
      void this.handleGate(instance, gate, completedStep, next);
      return;
    }

    // P2 conditional routing: a matching branch jumps to its `goto` step (if/else + loops),
    // guarded by a transition cap so a bad loop can't run forever.
    const goto = resolveBranch(completedStep?.branches, msg.payload.instruction ?? '');
    if (goto) {
      const target = steps.find((s) => s.id === goto);
      if (target && this.countTransition(instance) <= MAX_TRANSITIONS) {
        this.executeStep(instance, target);
      } else if (!target) {
        this.finish(instance, 'failed'); // branch points at an unknown step
      } else {
        this.finish(instance, 'failed'); // transition cap hit (likely a runaway loop)
      }
      this.onChange();
      return;
    }

    if (!next) {
      this.finish(instance, 'completed');
    } else if (next.autoTransition) {
      this.executeStep(instance, next);
    }
    this.onChange();
    // Non-auto steps wait for an explicit advance() call (left for the UI to drive).
  }

  /** Count a step transition for loop-safety; returns the running total. */
  private countTransition(instance: WorkflowInstance): number {
    const n = ((instance.context.__transitions as number | undefined) ?? 0) + 1;
    instance.context.__transitions = n;
    return n;
  }

  /**
   * Evaluate a gate after a completed step: run the objective check, apply tier changes, and either
   * advance, retry the step (optionally re-routed + escalated), or escalate out (pause for a human).
   */
  private async handleGate(
    instance: WorkflowInstance,
    gate: WorkflowGate,
    completedStep: WorkflowStep,
    next: WorkflowStep | undefined
  ): Promise<void> {
    let passed = true;
    let blocked = false;
    if (gate.objective && this.gateDeps.runChecks) {
      try {
        const res = await this.gateDeps.runChecks();
        passed = res.ok;
        blocked = !!res.blocked;
      } catch {
        passed = false;
      }
    }
    if (instance.status !== 'running') {
      return; // cancelled while checks ran
    }

    // A blocked check is a configuration problem (command execution disabled), not a quality
    // failure — don't escalate the model or burn retries; pause with actionable guidance.
    if (blocked) {
      instance.status = 'paused';
      instance.completedAt = new Date().toISOString();
      instance.context.__blockedReason =
        'run_checks could not run: command execution is disabled. Set roam.commandApproval to "allowlist" and configure roam.verifyCommand to enable the gate.';
      this.cleanup(instance.id);
      this.onChange();
      return;
    }

    const attempt = this.bumpAttempt(instance, gate.after);
    const decision = decideGate(gate, passed, attempt);

    if (decision.applyTiers) {
      this.gateDeps.tierController?.applyTiers(decision.applyTiers);
    }

    if (decision.proceed) {
      if (!next) {
        this.finish(instance, 'completed');
      } else if (next.autoTransition) {
        this.executeStep(instance, next);
      }
    } else if (decision.retry) {
      const redo = decision.route ? { ...completedStep, to: decision.route } : completedStep;
      this.executeStep(instance, redo);
    } else {
      instance.status = decision.escalate === 'human' ? 'paused' : 'failed';
      instance.completedAt = new Date().toISOString();
      this.cleanup(instance.id);
    }
    this.onChange();
  }

  /** Count attempts of a gated step (persisted in context for L3); returns the new count. */
  private bumpAttempt(instance: WorkflowInstance, gateId: string): number {
    const attempts = (instance.context.__attempts as Record<string, number> | undefined) ?? {};
    attempts[gateId] = (attempts[gateId] ?? 0) + 1;
    instance.context.__attempts = attempts;
    return attempts[gateId];
  }

  private finish(instance: WorkflowInstance, status: WorkflowInstance['status']): void {
    instance.status = status;
    instance.completedAt = new Date().toISOString();
    this.cleanup(instance.id);
  }

  private cleanup(instanceId: string): void {
    this.disposers.get(instanceId)?.();
    this.disposers.delete(instanceId);
    this.gates.delete(instanceId);
  }
}

function workflowToTemplate(workflow: WorkflowConfig): WorkflowTemplate {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description ?? '',
    steps: workflow.steps.map((step) => ({ ...step, branches: step.branches?.map((branch) => ({ ...branch })) })),
    builtin: false,
  };
}

function normalizeWorkflow(workflow: WorkflowConfig): WorkflowConfig {
  return {
    ...workflow,
    id: String(workflow.id ?? '').trim(),
    name: String(workflow.name ?? '').trim(),
    description: workflow.description,
    steps: Array.isArray(workflow.steps)
      ? workflow.steps.map((step) => ({
          ...step,
          id: String(step.id ?? '').trim(),
          from: String(step.from ?? '').trim(),
          to: String(step.to ?? '').trim(),
          action: String(step.action ?? ''),
          autoTransition: step.autoTransition !== false,
          branches: step.branches?.map((branch) => ({
            whenResultContains: branch.whenResultContains,
            goto: String(branch.goto ?? '').trim(),
          })),
        }))
      : [],
  };
}
