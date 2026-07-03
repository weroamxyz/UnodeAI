/* End-to-end probe: SessionManager + MessageBus + real ClaudeHeadlessBackend.
 * Proves (1) the first turn is delivered without a ready-deadlock, (2) the same claude process
 * handles a SECOND turn, (3) context carries across turns. Logs synchronously to a file so output
 * survives even if the process is killed. */
const fs = require('fs');
const path = require('path');
const { SessionManager } = require('../out/session/SessionManager.js');
const { MessageBus } = require('../out/bus/MessageBus.js');
const { ClaudeHeadlessBackend } = require('../out/backend/ClaudeHeadlessBackend.js');

const LOG = path.join(__dirname, 'probe-claude-e2e.log');
fs.writeFileSync(LOG, '');
const log = (...a) => fs.appendFileSync(LOG, a.join(' ') + '\n');

const config = {
  id: 'dev', name: 'Dev', role: 'senior-dev', skill: '',
  provider: { providerId: 'anthropic', apiKeySecretName: 'ANTHROPIC_API_KEY' },
  model: 'claude-haiku-4-5', systemPrompt: 'You are terse. Answer in as few words as possible.',
  autoApprove: true, allowedTools: [], workingDirectory: process.cwd(),
};

const bus = new MessageBus();
const mgr = new SessionManager(5, bus, {
  createBackend: (c) => new ClaudeHeadlessBackend(c),
  resolveEnv: async () => process.env,
});

function assignAndWait(instruction, ms) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); off(); resolve(r); } };
    const timer = setTimeout(() => finish({ timedOut: true, text: '' }), ms);
    const off = bus.onType('task.complete', (m) => {
      if (m.to === 'pm') { finish({ timedOut: false, text: m.payload.instruction || '' }); }
    });
    bus.send('pm', 'dev', 'task.assign', { instruction });
  });
}

(async () => {
  mgr.create(config);
  log('STEP start');
  await mgr.start('dev');
  log('STEP started, pid=', mgr.get('dev').pid);

  const t1 = await assignAndWait('Remember the number 42. Just say: noted.', 60000);
  log('TURN1 timedOut=', t1.timedOut, 'text=', JSON.stringify(t1.text), 'status=', mgr.get('dev').status);

  const t2 = await assignAndWait('What number did I ask you to remember? Reply with only the number.', 60000);
  log('TURN2 timedOut=', t2.timedOut, 'text=', JSON.stringify(t2.text));

  const ok = !t1.timedOut && !t2.timedOut && t2.text.includes('42');
  log('MULTI_TURN_CONTEXT_OK=', ok);
  log('COST_USD=', mgr.get('dev').usage.costUsd, 'TURNS=', mgr.get('dev').usage.turns);

  await mgr.stop('dev');
  log('STEP stopped, status=', mgr.get('dev').status);
  log('DONE');
  process.exit(0);
})().catch((e) => { log('FAIL', e.message); process.exit(1); });
