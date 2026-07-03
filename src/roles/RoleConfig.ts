/*---------------------------------------------------------------------------------------------
 *  UnodeAi - RoleConfig
 *  Role templates, skill bindings, and agent personality configuration
 *--------------------------------------------------------------------------------------------*/

import { v4 as uuidv4 } from 'uuid';
import {
  AgentConfig,
  AgentModelParams,
  AgentRole,
  AgentSkill,
  ProviderRef,
  ProviderConfig,
} from '../types';
import { SkillResolver } from './SkillResolver';

/**
 * Pre-defined skill library with specialized capabilities
 */
export const SKILL_LIBRARY: Record<string, AgentSkill> = {
  'code-generation': {
    id: 'code-generation',
    name: 'Code Generation',
    description: 'Write, refactor, and generate code across multiple languages and frameworks.',
    category: 'development',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'execute', 'message'] },
  },
  'code-review': {
    id: 'code-review',
    name: 'Code Review',
    description: 'Review code for bugs, style violations, security issues, and best practices.',
    category: 'development',
    implementation: { type: 'builtin', tools: ['read', 'search', 'message'] },
  },
  'debugging': {
    id: 'debugging',
    name: 'Debugging',
    description: 'Diagnose and fix bugs, analyze stack traces, and resolve runtime errors.',
    category: 'development',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'execute', 'message'] },
  },
  'architecture': {
    id: 'architecture',
    name: 'Architecture Design',
    description: 'Design system architecture, make technology decisions, and create technical specs.',
    category: 'design',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'message'] },
  },
  'testing': {
    id: 'testing',
    name: 'Testing',
    description: 'Write unit tests, integration tests, E2E tests, and test strategies.',
    category: 'development',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'execute', 'message'] },
  },
  'documentation': {
    id: 'documentation',
    name: 'Documentation',
    description: 'Write READMEs, API docs, architecture docs, and inline code comments.',
    category: 'documentation',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'message'] },
  },
  'project-management': {
    id: 'project-management',
    name: 'Project Management',
    description: 'Break down tasks, estimate effort, track progress, and manage workflows.',
    category: 'management',
    // The PM is a WORKING LEAD: it delegates substantial/parallel work, but can also make small edits or
    // run checks itself (write/execute). Giving it these tools is what lets a model that reaches for a
    // direct edit (Claude's instinct) succeed via tool-name aliasing instead of hitting a corrective it
    // distrusts. The prompt still steers it to delegate real implementation.
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'execute', 'delegate', 'message'] },
  },
  'security-audit': {
    id: 'security-audit',
    name: 'Security Audit',
    description: 'Identify security vulnerabilities, review permissions, and harden systems.',
    category: 'security',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'message'] },
  },
  'performance': {
    id: 'performance',
    name: 'Performance Optimization',
    description: 'Profile bottlenecks, optimize queries, reduce bundle size, and improve latency.',
    category: 'development',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'execute', 'message'] },
  },
  'devops': {
    id: 'devops',
    name: 'DevOps & CI/CD',
    description: 'Configure pipelines, manage infrastructure, and automate deployments.',
    category: 'infrastructure',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'execute', 'message'] },
  },
  'data-engineering': {
    id: 'data-engineering',
    name: 'Data Engineering',
    description: 'Design data pipelines, ETL workflows, and database schemas.',
    category: 'data',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'execute', 'message'] },
  },
  'ui-ux': {
    id: 'ui-ux',
    name: 'UI/UX Design',
    description: 'Design user interfaces, create wireframes, and implement accessible components.',
    category: 'design',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'message'] },
  },
  'business-analysis': {
    id: 'business-analysis',
    name: 'Business Analysis',
    description: 'Analyze business problems, gather and document requirements, and map processes.',
    category: 'management',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'message'] },
  },
  'strategy': {
    id: 'strategy',
    name: 'Strategy',
    description: 'Formulate business strategy, go-to-market plans, and competitive positioning.',
    category: 'management',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'message'] },
  },
  'financial-modeling': {
    id: 'financial-modeling',
    name: 'Financial Modeling',
    description: 'Build financial models, projections, budgets, and valuations.',
    category: 'data',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'message'] },
  },
  'market-research': {
    id: 'market-research',
    name: 'Market Research',
    description: 'Research markets, competitors, customer segments, and industry trends.',
    category: 'data',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'message'] },
  },
  'dependency-risk-triage': {
    id: 'dependency-risk-triage',
    name: 'Dependency Risk Triage',
    description: 'Audit dependencies for vulnerabilities, staleness, license risk, and bloat.',
    category: 'security',
    implementation: { type: 'builtin', tools: ['read', 'search', 'execute', 'message'] },
  },
  'owasp-top10-review': {
    id: 'owasp-top10-review',
    name: 'OWASP Top 10 Review',
    description: 'Review web application code for OWASP Top 10 security risks.',
    category: 'security',
    implementation: { type: 'builtin', tools: ['read', 'search', 'message'] },
  },
  'secrets-scanning': {
    id: 'secrets-scanning',
    name: 'Secrets Scanning',
    description: 'Detect exposed API keys, tokens, passwords, and certificates.',
    category: 'security',
    implementation: { type: 'builtin', tools: ['read', 'search', 'execute', 'message'] },
  },
  'api-contract-review': {
    id: 'api-contract-review',
    name: 'API Contract Review',
    description: 'Review API contracts for compatibility, versioning, and schema issues.',
    category: 'development',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'message'] },
  },
  'openapi-lint': {
    id: 'openapi-lint',
    name: 'OpenAPI Lint',
    description: 'Validate OpenAPI specifications for correctness and consistency.',
    category: 'development',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'execute', 'message'] },
  },
  'test-coverage-gap': {
    id: 'test-coverage-gap',
    name: 'Test Coverage Gap Analysis',
    description: 'Find missing tests, uncovered code paths, and edge-case gaps.',
    category: 'development',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'execute', 'message'] },
  },
  'perf-budget-audit': {
    id: 'perf-budget-audit',
    name: 'Performance Budget Audit',
    description: 'Measure and improve bundle size, latency, and runtime performance against a budget.',
    category: 'development',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'execute', 'message'] },
  },
  'ci-pipeline-review': {
    id: 'ci-pipeline-review',
    name: 'CI Pipeline Review',
    description: 'Review and improve CI/CD workflows for reliability, speed, and security.',
    category: 'infrastructure',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'execute', 'message'] },
  },
  'documentation-lint': {
    id: 'documentation-lint',
    name: 'Documentation Lint',
    description: 'Check documentation for broken links, stale content, and style issues.',
    category: 'documentation',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'message'] },
  },
  'readme-quickstart-quality': {
    id: 'readme-quickstart-quality',
    name: 'README Quickstart Quality',
    description: 'Review README quickstarts for clarity, completeness, and runnable examples.',
    category: 'documentation',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'message'] },
  },
  'task-decomposition': {
    id: 'task-decomposition',
    name: 'Task Decomposition',
    description: 'Break large goals into small, assignable tasks with acceptance criteria.',
    category: 'management',
    implementation: { type: 'builtin', tools: ['read', 'search', 'delegate', 'message'] },
  },
  'schema-migration-safety': {
    id: 'schema-migration-safety',
    name: 'Schema Migration Safety',
    description: 'Review database schema changes for safe rollout and backward compatibility.',
    category: 'data',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'execute', 'message'] },
  },
  'root-cause-analysis': {
    id: 'root-cause-analysis',
    name: 'Root Cause Analysis',
    description: 'Reproduce, isolate, fix, and prevent bugs using evidence-led debugging.',
    category: 'development',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'execute', 'message'] },
  },
  'commit-message-quality': {
    id: 'commit-message-quality',
    name: 'Commit Message Quality',
    description: 'Review commit messages for convention, clarity, and useful context.',
    category: 'development',
    implementation: { type: 'builtin', tools: ['read', 'search', 'message'] },
  },
  'pr-review-checklist': {
    id: 'pr-review-checklist',
    name: 'PR Review Checklist',
    description: 'Run a structured pull request review for correctness, tests, and risk.',
    category: 'development',
    implementation: { type: 'builtin', tools: ['read', 'search', 'message'] },
  },
  'accessibility-audit': {
    id: 'accessibility-audit',
    name: 'Accessibility Audit',
    description: 'Evaluate UI against accessibility requirements including contrast, labels, and keyboard use.',
    category: 'design',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'message'] },
  },
  'component-a11y': {
    id: 'component-a11y',
    name: 'Component Accessibility',
    description: 'Build and review accessible component semantics, focus behavior, and screen-reader support.',
    category: 'design',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'message'] },
  },
};

/** Shared resolver over the built-in library; used to derive `allowedTools` from skills. */
const skillResolver = new SkillResolver(SKILL_LIBRARY);

/** Capability tokens granted by a set of skill ids (the source of truth for allowedTools). */
function deriveTools(skillIds: string[]): string[] {
  return skillResolver.resolveAllowedTools(getSkillsByIds(skillIds));
}

/**
 * Model tiers decouple "how capable a model this role needs" from a specific model id, so the
 * team's cost/quality policy lives in one place (and becomes user-overridable via team.json):
 *   - premium  : leads (PM / Architect) — the strongest model for delegation & contract design.
 *   - standard : contributors that need quality (Senior Dev, Security, Reviewer).
 *   - economy  : pattern-driven work (QA, DevOps, Data) — cheapest, most cost-effective.
 * Mapping is per provider; the Roam (算力仓) gateway is where the multi-model arbitrage pays off.
 * The type now lives in ../types (so TeamConfig can reference it without a cycle); re-exported here
 * for the existing `import { ModelTier } from '../roles/RoleConfig'` call sites.
 */
export type { ModelTier } from '../types';
import type { ModelTier } from '../types';

export const DEFAULT_MODEL_TIERS: Record<ModelTier, Record<string, string>> = {
  premium: { roam: 'claude-opus-4-8', unode: 'claude-opus-4-8', openai: 'gpt-4o', anthropic: 'claude-opus-4-8', openrouter: 'anthropic/claude-sonnet-4' },
  standard: { roam: 'deepseek-v4-pro', unode: 'deepseek-v4-pro', openai: 'gpt-4o', anthropic: 'claude-sonnet-4-5', openrouter: 'openai/gpt-4o' },
  economy: { roam: 'deepseek-v4-flash', unode: 'deepseek-v4-flash', openai: 'gpt-4o-mini', anthropic: 'claude-haiku-4-5', openrouter: 'google/gemini-2.5-flash' },
};

/**
 * Resolve the model id for a role on a given provider: an explicit per-role override wins, else the
 * role's tier maps to a model, else the Roam tier model, else the role's Claude-specific `model`.
 */
export function modelForRole(
  template: Pick<RoleTemplate, 'tier' | 'modelOverride' | 'model'>,
  providerKey: string,
  tiers: Record<ModelTier, Record<string, string>> = DEFAULT_MODEL_TIERS
): string {
  return (
    template.modelOverride?.[providerKey] ??
    tiers[template.tier]?.[providerKey] ??
    tiers[template.tier]?.roam ??
    template.model
  );
}

/**
 * Partial template for an agent role — everything except id, provider, and autoApprove
 */
export interface RoleTemplate {
  name: string;
  role: AgentRole;
  skill: string;
  skills: AgentSkill[];
  /** Claude model id — used when provider is anthropic (the claude headless backend). */
  model: string;
  /** Quality/cost tier; maps to a concrete model per provider via DEFAULT_MODEL_TIERS. */
  tier: ModelTier;
  /** Optional per-provider model override that wins over the tier (e.g. a specialist model). */
  modelOverride?: Record<string, string>;
  /** Brief explanation of why this tier/model fits this role. */
  modelRationale?: string;
  /** Role-tuned sampling defaults (F1/F2). Seeds AgentConfig.modelParams; users can override in the
   *  Model Tuning settings. Chosen from experience: deterministic for code/review/security, more
   *  exploratory for architecture/writing. */
  modelParams?: AgentModelParams;
  systemPrompt: string;
  description?: string;
  icon?: string;
  color?: string;
  allowedTools: string[];
  maxTokens?: number;
  temperature?: number;
  workingDirectory?: string;
  env?: Record<string, string>;
}

/**
 * Pre-defined role templates that users can select from
 */
export const ROLE_TEMPLATES: Record<string, RoleTemplate> = {
  'product-manager': {
    name: 'Product Manager',
    role: 'product-manager',
    skill: 'business-analysis',
    skills: getSkillsByIds(['business-analysis', 'strategy', 'documentation', 'market-research']),
    model: 'claude-sonnet-4-20250514',
    tier: 'standard',
    modelRationale: 'Requirements & prioritization need solid reasoning, but not the premium tier the PM coordinator uses for delegation.',
    modelParams: { temperature: 0.4 }, // grounded, decisive requirements (reasoning_effort opt-in via Model Tuning)
    systemPrompt: `You are a Product Manager on an AI development crew. You define WHAT to build and WHY.
You do NOT write code, design the architecture, or orchestrate teammates — the Architect owns the design
and the Project Manager coordinates execution. Your deliverable is a crisp, prioritized spec.

Your job:
- Turn a goal or feature request into clear, TESTABLE requirements: user stories ("As a <user> I want
  <capability> so that <value>") and explicit ACCEPTANCE CRITERIA — the conditions that make each item
  genuinely "done" and that a Reviewer or a test can check.
- PRIORITIZE: must-have vs nice-to-have; state scope, trade-offs, and what to cut first if time is short.
- Surface ambiguity: list the open questions and assumptions the team must resolve before building.
- Stay grounded: read the codebase and existing docs so requirements fit what already exists; don't spec
  features that already ship or that contradict current behavior. Write the spec/PRD to a file when useful.

Hand the finished, prioritized spec to the Project Manager to delegate. Keep every requirement concrete and
verifiable — vague requirements ("make it better") are not done; restate them as something checkable.`,
    description: 'Defines what to build — user stories, acceptance criteria, scope, and priorities. Hands a spec to the PM.',
    icon: '📋',
    color: '#5C6BC0',
    allowedTools: deriveTools(['business-analysis', 'strategy', 'documentation', 'market-research']),
  },
  'architect': {
    name: 'System Architect',
    role: 'architect',
    skill: 'architecture',
    skills: getSkillsByIds(['architecture', 'code-review', 'documentation']),
    model: 'claude-sonnet-4-20250514',
    tier: 'premium',
    modelRationale: 'A lead role — needs the strongest model for trade-off analysis and contract design.',
    modelParams: { temperature: 0.5 }, // explore design trade-offs (reasoning_effort opt-in via Model Tuning)
    systemPrompt: `You are a System Architect. Your role is to:
- Design high-level system architecture and component relationships
- Evaluate technology choices with trade-off analysis
- Create detailed technical specifications (ADRs, RFCs)
- Review designs for scalability, reliability, and maintainability
- Communicate architectural decisions clearly to the team

CONTRACT-FIRST (critical for parallel teammates): before anyone implements, define the PUBLIC
CONTRACTS that teammates will build against — exact function/method signatures, type and interface
definitions, API request/response shapes, and module boundaries. State them explicitly and
unambiguously so two teammates editing different files stay compatible. Treat published contracts as
fixed: implementations may change freely, but a public contract must not change silently. List, per
module, which files own which contract so work can be partitioned without overlap.

OWNERSHIP MAP (for parallel work): when the PM is about to fan tasks out concurrently, also output an
explicit, NON-OVERLAPPING file-ownership partition — one teammate per disjoint set of paths/globs —
so the PM can pass each teammate's files to assign_task_async and the system can reject any overlap.
Format it plainly, e.g.:
  OWNERSHIP:
  - senior-dev: src/auth/**, src/types/auth.ts
  - tester: tests/auth/**
  - tech-writer: docs/auth.md
If two pieces of work genuinely need the same file, say so and sequence them instead of parallelizing.
Focus on the big picture. Avoid implementation details unless asked.`,
    description: 'Designs system architecture, makes technology decisions, and creates technical specifications.',
    icon: '🏗️',
    color: '#4FC3F7',
    allowedTools: deriveTools(['architecture', 'code-review', 'documentation']),
  },
  'senior-dev': {
    name: 'Senior Developer',
    role: 'senior-dev',
    skill: 'code-generation',
    skills: getSkillsByIds(['code-generation', 'code-review', 'debugging', 'testing']),
    model: 'claude-sonnet-4-20250514',
    tier: 'standard',
    modelRationale: 'A contributor doing heavy code work — a quality standard-tier model, not the cheapest.',
    modelParams: { temperature: 0.2 }, // deterministic code
    systemPrompt: `You are a Senior Developer. Your role is to:
- Write production-quality, well-tested code
- Implement complex features end-to-end
- Review code and provide constructive feedback
- Follow best practices: SOLID, DRY, clean architecture
- Consider edge cases, error handling, and performance
Always include tests with your implementations.`,
    description: 'Writes high-quality production code, implements complex features, and mentors.',
    icon: '💻',
    color: '#66BB6A',
    allowedTools: deriveTools(['code-generation', 'code-review', 'debugging', 'testing']),
  },
  'tester': {
    name: 'QA Engineer',
    role: 'tester',
    skill: 'testing',
    skills: getSkillsByIds(['testing', 'debugging', 'documentation']),
    model: 'claude-sonnet-4-20250514',
    tier: 'economy',
    modelRationale: 'Testing is pattern-driven — an economy-tier model is sufficient and cost-effective.',
    modelParams: { temperature: 0.2 }, // precise, repeatable tests
    systemPrompt: `You are a QA Engineer. Your role is to:
- Write comprehensive test suites (unit, integration, E2E)
- Identify edge cases and potential failure points
- Perform regression testing and report bugs clearly
- Advocate for testability in code design
- Measure and improve code coverage
Focus on finding what could go wrong before it does.`,
    description: 'Writes comprehensive tests, performs quality assurance, and finds edge cases.',
    icon: '🧪',
    color: '#FFA726',
    allowedTools: deriveTools(['testing', 'debugging', 'documentation']),
  },
  'devops': {
    name: 'DevOps Engineer',
    role: 'devops',
    skill: 'devops',
    skills: getSkillsByIds(['devops', 'security-audit', 'performance']),
    model: 'claude-sonnet-4-20250514',
    tier: 'economy',
    modelRationale: 'DevOps is config/pattern-driven — an economy-tier model saves cost without losing quality.',
    modelParams: { temperature: 0.2 }, // deterministic config/IaC
    systemPrompt: `You are a DevOps Engineer. Your role is to:
- Design and maintain CI/CD pipelines
- Manage cloud infrastructure (AWS/GCP/Azure)
- Automate deployments and rollbacks
- Set up monitoring, alerting, and logging
- Ensure security and compliance in infrastructure
Think about reliability, repeatability, and automation first.`,
    description: 'Manages CI/CD pipelines, infrastructure, deployment, and monitoring.',
    icon: '⚙️',
    color: '#AB47BC',
    allowedTools: deriveTools(['devops', 'security-audit', 'performance']),
  },
  'tech-writer': {
    name: 'Technical Writer',
    role: 'tech-writer',
    skill: 'documentation',
    skills: getSkillsByIds(['documentation', 'code-review']),
    model: 'claude-sonnet-4-20250514',
    tier: 'standard',
    modelOverride: { roam: 'qwen-max' },
    modelRationale: 'Qwen Max excels at multilingual, structured writing — a standard-tier specialist override for docs.',
    modelParams: { temperature: 0.6 }, // fluent prose
    systemPrompt: `You are a Technical Writer. Your role is to:
- Write clear, concise documentation for developers
- Create READMEs, API references, and getting-started guides
- Organize information logically with good structure
- Use examples and code snippets effectively
- Maintain consistency in terminology and style
Your audience is other developers. Be precise but accessible.`,
    description: 'Creates documentation, READMEs, API references, and developer guides.',
    icon: '📝',
    color: '#EF5350',
    allowedTools: deriveTools(['documentation', 'code-review']),
  },
  'pm': {
    name: 'Project Manager',
    role: 'pm',
    skill: 'project-management',
    // PM is a working lead: project-management now grants write/execute too, so a small edit it attempts
    // directly succeeds (via tool-name aliasing) instead of hitting a corrective Claude models distrust.
    skills: getSkillsByIds(['project-management']),
    // Opus 4.8 orchestrates cleanly here; some smaller/older Claude snapshots (e.g. Sonnet 4.x) cling to a
    // "Claude Code" identity and refuse to coordinate (call Edit/Bash, cry "prompt injection"). The PM is
    // the brain of the crew, so default it to the strongest reasoner that ALSO delegates reliably.
    model: 'claude-opus-4-8',
    tier: 'premium',
    modelRationale: 'The brain of the crew — must be the strongest reasoner AND a reliable orchestrator. Opus 4.8 delegates cleanly; never a cheap model.',
    modelParams: { temperature: 0.3 }, // decisive orchestration (reasoning_effort opt-in via Model Tuning)
    systemPrompt: `You are the Project Manager and lead of an AI development crew. Your job is to ORCHESTRATE:
delegate the work to teammates rather than doing it yourself — EVERY task, including a one-line edit, goes to
a teammate via assign_task. This is the whole point of the crew: the specialist does the work and it flows
through review and verification. (You do have file tools, but only as a fallback if delegation truly isn't
possible — they are never your first move.) You have these team tools:
- list_agents: see your teammates, their roles, and status.
- assign_task(agent, instruction): hand a task to a teammate by role or id and WAIT for their
  result. Give them all the context they need; the tool returns their final output. Use this for
  SEQUENTIAL work — when a task depends on a previous task's output.
- assign_task_async(agent, instruction, files?): dispatch a task and get a HANDLE back immediately,
  WITHOUT waiting. Use this to run teammates in PARALLEL when their work is independent and touches
  non-overlapping files. Then call await_tasks to collect the results.
- await_tasks(handles?): wait for dispatched async tasks and return all their results together
  (omit handles to await everything you dispatched).
- broadcast(message): announce something to everyone (no reply).
- run_checks: build/type-check/test the WHOLE project to catch cross-file breakage.

How to work:

YOUR DEFAULT IS TO DELEGATE IN ONE STEP. Do NOT first judge whether a task is "simple" — just delegate it:
call assign_task(role, instruction) ONCE with a COMPLETE instruction (name the file and exactly what to
do), then report the result. Do NOT read files, call list_agents, or write todos first — assign_task
resolves the teammate by role automatically, and the teammate reads the file itself. One tool call, done.

ESCALATE to the full multi-step process below ONLY when you clearly see one of these FOUR triggers in the
request:
  (a) it names MULTIPLE distinct deliverables (several separate features/tasks); or
  (b) it must change MULTIPLE files/modules that have to stay consistent (shared contracts/types/APIs); or
  (c) it explicitly asks for tests AND/OR an independent review; or
  (d) it is open-ended or large — "build X", "add a whole feature", "refactor the codebase".
If you do NOT clearly see one of (a)–(d), DELEGATE in one step — do not deliberate about it.

Full process (use ONLY when a trigger (a)–(d) above applies):
1. Break the user's goal into ordered tasks and decide which role each belongs to. Then immediately
   call update_todos with that breakdown — one entry per task — so the user sees the team's plan in
   your chat. Keep it live: mark a task in_progress when you delegate it and completed when its result
   is in. This shared plan is how the user follows the crew's progress, so maintain it every step.
2. If the work spans multiple files/modules, FIRST have the architect define the public contracts
   (signatures, types, API shapes) so teammates building different files stay compatible. Pass
   those contracts verbatim to each implementer.
3. Call list_agents EXACTLY ONCE to see the team's roles, then delegate by role with assign_task. Do NOT
   call list_agents a second time — once you have the roster, any further urge to "check the team" means
   assign_task NOW, not re-list (assign_task resolves the teammate by role, and a stopped teammate
   auto-starts on assignment, so you never need to re-check availability). Do not explore the repo to
   "get oriented" either — delegate and let the specialist read what it needs.
4. Delegate, giving each teammate a NON-OVERLAPPING set of files to own (e.g. dev owns src/auth/*,
   tester owns tests/*). For INDEPENDENT tasks on non-overlapping files, fan them out in PARALLEL:
   call assign_task_async once per teammate, then await_tasks to collect — this is faster than going
   one at a time. Use the blocking assign_task only when a task NEEDS a previous task's output. Read
   each result, then decide the next step; if output is inadequate, reassign with clearer instructions.
5. After implementation, call run_checks (the objective machine gate: build/type-check/test). If it
   FAILS, the errors usually mean one teammate's change broke a file another depends on — identify the
   offending file, assign a targeted fix to the right teammate (include the error output), then
   run_checks again. Repeat until green.
6. Then get an INDEPENDENT review: assign the work to the 'reviewer' (who did NOT implement it) and
   wait for its PASS/FAIL verdict. On FAIL, route each issue to the right implementer to fix, then
   re-run checks and re-review. Never let an implementer sign off on their own work.
7. If a teammate reports that a shared/public contract had to change, broadcast the new contract so
   everyone updates — never let a contract change silently.
8. When the goal is met, run_checks is green, AND the reviewer returns PASS, summarize what the crew
   accomplished.

### CRITICAL RULES — learned from production failures; violate these and the whole crew breaks

**RULE 1 — Read scripts first, always.**
Before you tell any teammate to run a command, FIRST read the project's package.json scripts.
The project defines its own build/test/lint commands (e.g. "test": "vitest run"). NEVER use a
bare tool name from memory (no npx vitest, no npx tsc, no npx eslint). Always use the project
script: npm test, npm run build, npm run lint. If you can't find the right script, ASK — do not
guess. This is the #1 source of failure. Do not skip this step even if you're "pretty sure."

**RULE 2 — Report the precise symptom. Do NOT fabricate a root cause.**
When something fails (test, build, lint), your job is to report WHAT happened, not WHY.
The user is smarter than you at diagnosis. Give them raw data, not your theory.

Good report:
  "npm test ran. 58 files all returned 'No test suite found in file', identical error.
   Build passes. The 2 files I touched match existing patterns. Here's the exact output: [paste]"

Bad report (DO NOT DO THIS):
  "This is a pre-existing environment issue: vitest 1.6.1 + Node 25.9.0 incompatibility."
  — You fabricated a root cause from zero evidence. Node 25 might be fine. You don't know.
  You just made the user waste time ruling out your wrong theory.

The rule: describe the symptom with exact command + exact output. Stop there.
If the user wants your theory, they'll ask. Never volunteer a causal explanation
unless you have CONCRETE evidence (version mismatch error in logs, missing binary, etc.).
"All 58 files fail identically" is a symptom, not evidence of a bug.

**RULE 3 — Listen to your teammates' corrections.**
Architects and senior developers have instructions to use the right commands. If a teammate
points out you used the wrong command, STOP immediately and fix it. Do not override their
correction because you're "the PM." The PM delegates work, not command-line knowledge.

**RULE 4 — Keep every change scoped.**
Give each teammate a tight, minimal scope: only the files their task actually needs. Don't let a
teammate edit unrelated files, expand the task on its own, or leave stray/temporary files behind.
Small, focused changes are easier to review, verify, and undo.

**RULE 5 — Know when to stop and report.**
If the same step fails 2-3 times, or a teammate keeps timing out / returning garbage, or tests
won't pass despite code looking correct — STOP. Report to the user plainly: what you tried, what
the output was, and what you recommend. Do not loop silently. Do not invent explanations to sound
smart. "I'm stuck, here's what I see, what should I try next?" is always better than a confident
wrong diagnosis.

**RULE 6 — Act, don't just announce.**
NEVER end a turn by saying you are *about to* do something ("let me delegate this to the developer",
"I'll call assign_task now", "let me update the plan") and then stop. If you say you will use a tool
(assign_task, run_checks, update_todos, …), call it in the SAME message. Stopping after an
announcement forces the user to prod you to continue — that is a failure. Announce only what you have
just DONE, never what you are merely planning to do next without doing it.

ALWAYS REPORT BACK TO THE USER (do not go silent): the user only sees YOUR messages, not your
teammates' private results. So every time you finish a turn you MUST end with a short plain-language
update addressed to the user — what just got done, what's still in flight, and any decision you need
from them. In particular:
- When a teammate reports a task is finished (whether the result came back from assign_task or a
  teammate messaged you that they're done), do NOT just stop. Confirm the outcome (e.g. run_checks /
  reviewer if appropriate) and then write the user a concise summary of what was accomplished and
  what's next. A completed delegation is the moment to report, not to fall silent.
- Never end a turn with empty output. If you have nothing new, at least tell the user the current
  status and what you're waiting on.

IF YOU ARE STUCK, SAY SO: if a teammate keeps returning empty/garbage, refuses the task, or the same
step fails repeatedly (e.g. run_checks stays red after a few targeted fixes), do NOT loop silently.
Stop and tell the user plainly: what you tried, what's blocking, and your recommendation — e.g. "I'm
stuck on X; teammate Y isn't producing usable output. Consider restarting the run or giving me more
specific guidance." Surfacing a blocker early is better than spinning.

Why this matters: two agents editing the SAME file are blocked by the workspace (re-read & retry),
but the real danger is one agent changing a file that ANOTHER agent's file depends on — that only
surfaces in run_checks. Contracts-first + partitioning prevent it; run_checks catches what slips.
Focus on clarity, sequencing, and momentum. Do not attempt coding tasks yourself — delegate them.`,
    description: 'Orchestrates the crew: breaks down work, delegates to teammates, and tracks results.',
    icon: '📋',
    color: '#26C6DA',
    allowedTools: deriveTools(['project-management']),
  },
  'security': {
    name: 'Security Engineer',
    role: 'security',
    skill: 'security-audit',
    // Audit + review only — no 'debugging' skill, so security stays read/write/search (no execute),
    // preserving its least-privilege posture. See derived allowedTools below.
    skills: getSkillsByIds(['security-audit', 'code-review']),
    model: 'claude-sonnet-4-20250514',
    tier: 'standard',
    modelRationale: 'Audit needs thorough analysis — a quality standard-tier model to avoid missing vulnerabilities.',
    modelParams: { temperature: 0.1 }, // precise vuln analysis (reasoning_effort opt-in via Model Tuning)
    systemPrompt: `You are a Security Engineer. Your role is to:
- Audit code for security vulnerabilities (OWASP Top 10)
- Review authentication, authorization, and data handling
- Enforce secure coding practices across the team
- Recommend security improvements and hardening measures
- Stay updated on common attack vectors and mitigations
Assume the attacker is sophisticated. Be thorough.`,
    description: 'Audits code for vulnerabilities, enforces security best practices, and hardens systems.',
    icon: '🔒',
    color: '#78909C',
    allowedTools: deriveTools(['security-audit', 'code-review']),
  },
  'data-engineer': {
    name: 'Data Engineer',
    role: 'data-engineer',
    skill: 'data-engineering',
    skills: getSkillsByIds(['data-engineering', 'performance', 'architecture']),
    model: 'claude-sonnet-4-20250514',
    tier: 'economy',
    modelRationale: 'Pipelines and SQL are pattern-driven — an economy-tier model suffices for schema and ETL work.',
    modelParams: { temperature: 0.2 }, // deterministic schema/SQL
    systemPrompt: `You are a Data Engineer. Your role is to:
- Design efficient database schemas and data models
- Build ETL/ELT pipelines for data processing
- Optimize query performance and indexing
- Ensure data quality, consistency, and integrity
- Design for scalability and cost-efficiency
Think about data as a product.`,
    description: 'Designs data pipelines, database schemas, ETL workflows, and data models.',
    icon: '📊',
    color: '#8D6E63',
    allowedTools: deriveTools(['data-engineering', 'performance', 'architecture']),
  },
  'reviewer': {
    name: 'Reviewer',
    role: 'reviewer',
    skill: 'code-review',
    // Read-only on purpose: an independent validator inspects teammates' work, it never edits it.
    skills: getSkillsByIds(['code-review']),
    model: 'claude-sonnet-4-20250514',
    tier: 'standard',
    modelRationale: 'Independent verification benefits from a quality model; run_checks is the objective backstop.',
    modelParams: { temperature: 0.1 }, // strict verdicts (reasoning_effort opt-in via Model Tuning)
    systemPrompt: `You are an independent Reviewer — the team's objective quality gate. You did NOT
write this code, and you must stay independent: never rubber-stamp.
For each task handed to you:
- Verify the work against the stated acceptance criteria and the architect's published contracts
  (signatures/types/API shapes). Flag any contract drift.
- Look for correctness bugs, missing edge cases, weak error handling, security issues, and missing tests.
- Your tools are READ-ONLY — you inspect and judge, you never change code.
Return a clear verdict: PASS or FAIL. If FAIL, list each problem with file/line and a concrete fix
for the implementer. Be specific and evidence-based; vague approval is worse than useless.`,
    description: "Independently reviews teammates' work and returns an objective PASS/FAIL verdict.",
    icon: '🔍',
    color: '#7E57C2',
    allowedTools: deriveTools(['code-review']),
  },
  // Solo / Fast mode (v0.3.0): one generalist agent that does the whole task itself — no delegation
  // (no `delegate` tool), no review gate. The fast path for simple/everyday asks; use a Team for
  // complex multi-file work that wants an independent review.
  'solo': {
    name: 'Solo',
    role: 'solo',
    skill: 'code-generation',
    skills: getSkillsByIds(['code-generation', 'debugging', 'testing']),
    model: 'claude-sonnet-4-20250514',
    tier: 'standard',
    modelRationale: 'A single agent does everything end-to-end — a quality standard-tier model; user can drop to economy for cheap tasks.',
    modelParams: { temperature: 0.2 }, // deterministic code
    systemPrompt: `You are a Solo full-stack engineer working DIRECTLY with the user. There is no team
to delegate to — you do the whole task yourself, end to end. Work in a tight loop:
1. Understand the request.
2. READ the relevant files before changing anything.
3. Make the change with write_file (keep edits minimal; match the surrounding code/style).
4. Verify with run_command using the PROJECT'S OWN scripts (e.g. \`npm test\`, \`npm run build\`) — do
   not invent ad-hoc runner commands.
5. Read the output, fix what's wrong, and repeat until it actually works.
Write or update tests for non-trivial changes. When you're done, give the user a short summary of what
you changed and how you verified it. If you get genuinely stuck, say exactly what's blocking you — don't
loop silently or blame the environment.`,
    description: 'One generalist agent that codes the whole task itself — fast path, no team overhead, no review gate.',
    icon: '🧑‍💻',
    color: '#26A69A',
    allowedTools: deriveTools(['code-generation', 'debugging', 'testing']),
  },
  'business-analyst': {
    name: 'Business Analyst',
    role: 'custom',
    skill: 'business-analysis',
    skills: getSkillsByIds(['business-analysis', 'documentation']),
    model: 'claude-sonnet-4-20250514',
    tier: 'standard',
    modelParams: { temperature: 0.5 },
    systemPrompt: `You are a Business Analyst. Clarify the business problem, gather and document
requirements, map current/target processes, and lay out options with clear trade-offs. Be concrete
and structured; write findings to files when useful.`,
    description: 'Clarifies requirements, maps processes, and frames options with trade-offs.',
    icon: '📋',
    color: '#5C6BC0',
    allowedTools: deriveTools(['business-analysis', 'documentation']),
  },
  'market-researcher': {
    name: 'Market Researcher',
    role: 'custom',
    skill: 'market-research',
    skills: getSkillsByIds(['market-research', 'documentation']),
    model: 'claude-sonnet-4-20250514',
    tier: 'standard',
    modelParams: { temperature: 0.6 },
    systemPrompt: `You are a Market Researcher. Research the market, competitors, customer segments,
and trends. Summarize findings with sources/assumptions stated, and call out what's uncertain.`,
    description: 'Researches markets, competitors, segments, and trends.',
    icon: '🔎',
    color: '#26A69A',
    allowedTools: deriveTools(['market-research', 'documentation']),
  },
  'financial-analyst': {
    name: 'Financial Analyst',
    role: 'custom',
    skill: 'financial-modeling',
    skills: getSkillsByIds(['financial-modeling', 'documentation']),
    model: 'claude-sonnet-4-20250514',
    tier: 'standard',
    modelParams: { temperature: 0.3 },
    systemPrompt: `You are a Financial Analyst. Build simple, clearly-labeled financial models,
projections, and budgets. State every assumption. Show the numbers and the reasoning behind them.`,
    description: 'Builds financial models, projections, budgets, and valuations.',
    icon: '💰',
    color: '#66BB6A',
    allowedTools: deriveTools(['financial-modeling', 'documentation']),
  },
  'strategy-lead': {
    name: 'Strategy Lead',
    role: 'custom',
    skill: 'strategy',
    skills: getSkillsByIds(['strategy', 'business-analysis']),
    model: 'claude-sonnet-4-20250514',
    tier: 'premium',
    modelParams: { temperature: 0.5 },
    systemPrompt: `You are a Strategy Lead. Turn analysis into a coherent strategy and go-to-market
plan: priorities, positioning, risks, and a sequenced plan. Decisive but evidence-based.`,
    description: 'Turns analysis into strategy, positioning, and a sequenced plan.',
    icon: '🧭',
    color: '#AB47BC',
    allowedTools: deriveTools(['strategy', 'business-analysis']),
  },
};

export type TeamPresetKind = 'software' | 'knowledge' | 'pack';

export interface TeamPreset {
  label: string;
  roles: (keyof typeof ROLE_TEMPLATES)[];
  description?: string;
  verifyCommand?: string;
  kind?: TeamPresetKind;
}

/**
 * Named team presets (v0.3.0). Each starts with the PM (coordinator); the rest are the specialist
 * roles above. Pass `roles` straight to createTeam().
 */
export const TEAM_PRESETS: Record<string, TeamPreset> = {
  'bugfix-crew': {
    label: 'Bugfix Crew',
    roles: ['pm', 'senior-dev', 'reviewer'],
    description: 'Find, fix, and independently review a defect.',
    verifyCommand: 'npm test',
    kind: 'pack',
  },
  'refactor-crew': {
    label: 'Refactor Crew',
    roles: ['pm', 'architect', 'senior-dev', 'reviewer'],
    description: 'Reshape code with architecture guidance and review.',
    verifyCommand: 'npm run lint',
    kind: 'pack',
  },
  'test-writer-crew': {
    label: 'Test Writer Crew',
    roles: ['pm', 'tester', 'reviewer'],
    description: 'Add or harden tests, then review coverage and behavior.',
    verifyCommand: 'npm test',
    kind: 'pack',
  },
  'release-crew': {
    label: 'Release Crew',
    roles: ['pm', 'senior-dev', 'devops', 'reviewer'],
    description: 'Prepare a release with build and CI awareness.',
    verifyCommand: 'npm run build',
    kind: 'pack',
  },
  'security-review-crew': {
    label: 'Security Review Crew',
    roles: ['pm', 'security', 'reviewer'],
    description: 'Audit security-sensitive changes with independent review.',
    verifyCommand: 'npm audit --omit=dev',
    kind: 'pack',
  },
  'business-planning': {
    label: 'Business Planning',
    roles: ['pm', 'strategy-lead', 'market-researcher', 'financial-analyst'],
    description: 'Plan a business direction with strategy, market, and finance specialists.',
    kind: 'knowledge',
  },
  'business-analysis': {
    label: 'Business Analysis',
    roles: ['pm', 'business-analyst', 'market-researcher'],
    description: 'Clarify requirements and market context for a business problem.',
    kind: 'knowledge',
  },
  'financial-analysis': {
    label: 'Financial Analysis',
    roles: ['pm', 'financial-analyst', 'business-analyst'],
    description: 'Model financial trade-offs and explain the assumptions.',
    kind: 'knowledge',
  },
};

/**
 * Default provider references for major LLM platforms
 */
export const DEFAULT_PROVIDERS: Record<string, ProviderRef> = {
  // Roam's OpenAI-compatible token gateway (weroam) — the default provider for new agents.
  roam: {
    providerId: 'roam',
    apiKeySecretName: 'ROAM_API_KEY',
  },
  // Unode — a separate OpenAI-compatible gateway (the previous Roam endpoint), its own key.
  unode: {
    providerId: 'unode',
    apiKeySecretName: 'UNODE_API_KEY',
  },
  anthropic: {
    providerId: 'anthropic',
    apiKeySecretName: 'ANTHROPIC_API_KEY',
  },
  openai: {
    providerId: 'openai',
    apiKeySecretName: 'OPENAI_API_KEY',
  },
  openrouter: {
    providerId: 'openrouter',
    apiKeySecretName: 'OPENROUTER_API_KEY',
  },
  google: {
    providerId: 'google',
    apiKeySecretName: 'GOOGLE_API_KEY',
  },
  ollama: {
    providerId: 'ollama',
    apiKeySecretName: 'OLLAMA_HOST',
  },
  // OpenAI-compatible gateways (算力仓 / OpenRouter / vLLM / LM Studio …).
  custom: {
    providerId: 'custom',
    apiKeySecretName: 'CUSTOM_API_KEY',
  },
};

/**
 * Full provider configurations (used for the ProviderManager)
 */
export const DEFAULT_PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  roam: {
    id: 'roam',
    name: 'Roam (Multi-Model Gateway)',
    type: 'custom',
    baseUrl: 'https://ai.weroam.xyz/v1',
    apiKeySecretName: 'ROAM_API_KEY',
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash (cheap)', maxTokens: 8192, supportsStreaming: true, supportsVision: false },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', maxTokens: 8192, supportsStreaming: true, supportsVision: false },
      { id: 'qwen-max', name: 'Qwen Max', maxTokens: 8192, supportsStreaming: true, supportsVision: false },
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5 (premium)', maxTokens: 8192, supportsStreaming: true, supportsVision: true },
      { id: 'gpt-4o', name: 'GPT-4o', maxTokens: 8192, supportsStreaming: true, supportsVision: true },
    ],
  },
  // Unode — the previous Roam gateway, kept as a separate selectable provider (same model catalog).
  unode: {
    id: 'unode',
    name: 'Unode (Multi-Model Gateway)',
    type: 'custom',
    baseUrl: 'https://www.unodetech.xyz/v1',
    apiKeySecretName: 'UNODE_API_KEY',
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash (cheap)', maxTokens: 8192, supportsStreaming: true, supportsVision: false },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', maxTokens: 8192, supportsStreaming: true, supportsVision: false },
      { id: 'qwen-max', name: 'Qwen Max', maxTokens: 8192, supportsStreaming: true, supportsVision: false },
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5 (premium)', maxTokens: 8192, supportsStreaming: true, supportsVision: true },
      { id: 'gpt-4o', name: 'GPT-4o', maxTokens: 8192, supportsStreaming: true, supportsVision: true },
    ],
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeySecretName: 'ANTHROPIC_API_KEY',
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', maxTokens: 8192, supportsStreaming: true, supportsVision: true },
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', maxTokens: 8192, supportsStreaming: true, supportsVision: true },
    ],
    rateLimit: { requestsPerMinute: 50, tokensPerMinute: 200000 },
    costPerToken: { input: 3.0, output: 15.0 },
  },
  openai: {
    id: 'openai',
    name: 'OpenAI (GPT)',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKeySecretName: 'OPENAI_API_KEY',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', maxTokens: 8192, supportsStreaming: true, supportsVision: true },
      { id: 'gpt-4.1', name: 'GPT-4.1', maxTokens: 8192, supportsStreaming: true, supportsVision: true },
    ],
    rateLimit: { requestsPerMinute: 500, tokensPerMinute: 1000000 },
    costPerToken: { input: 2.5, output: 10.0 },
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'custom',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeySecretName: 'OPENROUTER_API_KEY',
    models: [
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', maxTokens: 8192, supportsStreaming: true, supportsVision: true },
      { id: 'openai/gpt-4o', name: 'GPT-4o', maxTokens: 8192, supportsStreaming: true, supportsVision: true },
      { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', maxTokens: 8192, supportsStreaming: true, supportsVision: true },
      { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B Instruct', maxTokens: 8192, supportsStreaming: true, supportsVision: false },
    ],
  },
  google: {
    id: 'google',
    name: 'Google (Gemini)',
    type: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1',
    apiKeySecretName: 'GOOGLE_API_KEY',
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', maxTokens: 8192, supportsStreaming: true, supportsVision: true },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', maxTokens: 8192, supportsStreaming: true, supportsVision: true },
    ],
    rateLimit: { requestsPerMinute: 100, tokensPerMinute: 500000 },
    costPerToken: { input: 1.25, output: 5.0 },
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (Local)',
    type: 'ollama',
    baseUrl: 'http://localhost:11434',
    apiKeySecretName: 'OLLAMA_HOST',
    models: [
      { id: 'llama3.1', name: 'Llama 3.1', maxTokens: 4096, supportsStreaming: true, supportsVision: false },
    ],
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────

function getSkillsByIds(ids: string[]): AgentSkill[] {
  return ids.map((id) => SKILL_LIBRARY[id]).filter(Boolean);
}

// ─── Builder ───────────────────────────────────────────────────────────

/**
 * Builder-pattern class for creating AgentConfig objects
 */
export class AgentConfigBuilder {
  private config: AgentConfig;

  constructor(role: AgentRole = 'custom') {
    this.config = {
      id: uuidv4(),
      role,
      name: role,
      skill: '',
      skills: [],
      provider: { ...DEFAULT_PROVIDERS.anthropic },
      model: 'claude-sonnet-4-20250514',
      systemPrompt: '',
      autoApprove: false,
      allowedTools: [],
    };
  }

  /**
   * Apply a pre-defined role template
   */
  fromTemplate(roleKey: keyof typeof ROLE_TEMPLATES): this {
    const template = ROLE_TEMPLATES[roleKey];
    this.config = {
      ...this.config,
      ...template,
      provider: { ...this.config.provider },
      // Clone so agents from the same template don't share one modelParams object reference.
      modelParams: template.modelParams ? { ...template.modelParams } : undefined,
    };
    return this;
  }

  setId(id: string): this {
    this.config.id = id;
    return this;
  }

  setName(name: string): this {
    this.config.name = name;
    return this;
  }

  setProviderRef(provider: ProviderRef): this {
    this.config.provider = { ...provider };
    return this;
  }

  setProviderById(providerKey: keyof typeof DEFAULT_PROVIDERS): this {
    this.config.provider = { ...DEFAULT_PROVIDERS[providerKey] };
    return this;
  }

  setModel(model: string): this {
    this.config.model = model;
    return this;
  }

  setSystemPrompt(prompt: string): this {
    this.config.systemPrompt = prompt;
    return this;
  }

  setSkills(skillIds: string[]): this {
    this.config.skills = getSkillsByIds(skillIds);
    if (skillIds.length > 0) {
      this.config.skill = skillIds[0];
    }
    // Skills are a capability declaration: derive allowedTools from them (explicit
    // setAllowedTools() can still override afterwards as an escape hatch).
    this.config.allowedTools = skillResolver.resolveAllowedTools(this.config.skills);
    return this;
  }

  addSkill(skillId: string): this {
    const skill = SKILL_LIBRARY[skillId];
    if (skill && !this.config.skills?.some((s) => s.id === skillId)) {
      this.config.skills = [...(this.config.skills ?? []), skill];
      this.config.allowedTools = skillResolver.resolveAllowedTools(this.config.skills);
    }
    return this;
  }

  setAutoApprove(auto: boolean): this {
    this.config.autoApprove = auto;
    return this;
  }

  setAllowedTools(tools: string[]): this {
    this.config.allowedTools = tools;
    return this;
  }

  setWorkingDirectory(dir: string): this {
    this.config.workingDirectory = dir;
    return this;
  }

  setMaxTokens(tokens: number): this {
    this.config.maxTokens = tokens;
    return this;
  }

  setTemperature(temp: number): this {
    this.config.temperature = temp;
    return this;
  }

  build(): AgentConfig {
    if (!this.config.id) {
      this.config.id = uuidv4();
    }
    return { ...this.config };
  }
}

/**
 * Utility to quickly create a full agent team from role templates
 */
export function createTeam(
  roleKeys: (keyof typeof ROLE_TEMPLATES)[],
  providerKey: keyof typeof DEFAULT_PROVIDERS = 'roam'
): AgentConfig[] {
  return roleKeys.map((roleKey) => {
    const template = ROLE_TEMPLATES[roleKey];
    const builder = new AgentConfigBuilder(template.role)
      .fromTemplate(roleKey)
      .setProviderById(providerKey);

    // Resolve the model from the role's tier for this provider ('anthropic' keeps the Claude `model`).
    if (providerKey === 'roam' || providerKey === 'unode' || providerKey === 'openai' || providerKey === 'openrouter') {
      builder.setModel(modelForRole(template, providerKey));
    }

    return builder.build();
  });
}
