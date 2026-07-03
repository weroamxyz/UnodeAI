/*---------------------------------------------------------------------------------------------
 *  UnodeAi - ModelParamResolver (v0.1.1 F2)
 *  Resolves an agent's effective model/sampling params from a fallback hierarchy so users can set
 *  org-wide defaults and only override per-agent (or per-task tier) when they need to.
 *
 *  Resolution order (first defined value wins, field by field):
 *    1. agent.modelParams.<field>           — explicit per-agent (team.json members[].modelParams)
 *    2. smartTierParams.<field>             — injected by Smart Mode at dispatch (F3, optional)
 *    3. legacy agent.temperature/maxTokens  — back-compat for old team.json (those two fields only)
 *    4. roam.modelDefaults.<field>          — global VS Code setting
 *    5. HARD_DEFAULTS                        — last-resort built-ins
 *
 *  Pure of vscode: it reads globals through an injected ConfigStore, so it's unit-testable.
 *--------------------------------------------------------------------------------------------*/

import { AgentConfig, AgentModelParams } from '../types';
import { ConfigStore } from '../settings/SettingsBridge';

/** Last-resort defaults when neither the agent nor the global settings specify a value. */
export const HARD_DEFAULTS: AgentModelParams = {
  temperature: 0.7,
  max_tokens: 4096,
  stream: true,
};

type Effort = NonNullable<AgentModelParams['reasoning_effort']>;
type ResponseFormat = NonNullable<AgentModelParams['response_format']>['type'];

export class ModelParamResolver {
  constructor(private config: ConfigStore) {}

  /**
   * Resolve the effective params for an agent's turn. `smartTierParams` (F3) wins over the agent's
   * legacy fields and globals, but never over the agent's explicit `modelParams`.
   */
  resolve(agent: AgentConfig, smartTierParams?: AgentModelParams): AgentModelParams {
    const explicit = agent.modelParams ?? {};
    const tier = smartTierParams ?? {};
    const globals = this.readGlobals();

    const pick = <K extends keyof AgentModelParams>(
      key: K,
      legacy?: AgentModelParams[K]
    ): AgentModelParams[K] | undefined =>
      explicit[key] ?? tier[key] ?? legacy ?? globals[key] ?? HARD_DEFAULTS[key];

    const resolved: AgentModelParams = {
      temperature: pick('temperature', agent.temperature),
      top_p: pick('top_p'),
      presence_penalty: pick('presence_penalty'),
      frequency_penalty: pick('frequency_penalty'),
      thinking: pick('thinking'),
      reasoning_effort: pick('reasoning_effort'),
      max_tokens: pick('max_tokens', agent.maxTokens),
      stop: pick('stop'),
      response_format: pick('response_format'),
      tool_choice: pick('tool_choice'),
      stream: pick('stream'),
    };

    // Drop undefined fields so callers can spread only what was actually resolved.
    for (const k of Object.keys(resolved) as (keyof AgentModelParams)[]) {
      if (resolved[k] === undefined) {
        delete resolved[k];
      }
    }
    return resolved;
  }

  /** Read the global `roam.modelDefaults.*` settings into an AgentModelParams shape. */
  private readGlobals(): AgentModelParams {
    const g: AgentModelParams = {};
    const temperature = this.config.get<number | null>('modelDefaults.temperature', null);
    const topP = this.config.get<number | null>('modelDefaults.topP', null);
    const maxTokens = this.config.get<number | null>('modelDefaults.maxTokens', null);
    const effort = this.config.get<string>('modelDefaults.reasoningEffort', '');
    const stream = this.config.get<boolean | null>('modelDefaults.stream', null);
    const responseFormat = this.config.get<string>('modelDefaults.responseFormat', '');

    if (typeof temperature === 'number') g.temperature = temperature;
    if (typeof topP === 'number') g.top_p = topP;
    if (typeof maxTokens === 'number') g.max_tokens = maxTokens;
    if (effort) g.reasoning_effort = effort as Effort;
    if (typeof stream === 'boolean') g.stream = stream;
    if (responseFormat) g.response_format = { type: responseFormat as ResponseFormat };
    return g;
  }
}
