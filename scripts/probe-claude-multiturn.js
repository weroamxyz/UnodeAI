/* Timeout-guarded multi-turn probe for ClaudeHeadlessBackend.
 * Verifies: (1) one claude process accepts a SECOND user turn, (2) context carries across turns.
 * Each turn has a hard deadline so a one-shot `-p` process can't hang the probe. */
const { ClaudeHeadlessBackend } = require('../out/backend/ClaudeHeadlessBackend.js');

const config = {
  id: 'a2', name: 'Dev', role: 'senior-dev', skill: '',
  provider: { providerId: 'anthropic', apiKeySecretName: 'ANTHROPIC_API_KEY' },
  model: 'claude-haiku-4-5', systemPrompt: 'You are terse.', autoApprove: true, allowedTools: [],
  workingDirectory: process.cwd(),
};

const b = new ClaudeHeadlessBackend(config);
let answers = [];
b.onEvent((e) => { if (e.kind === 'assistant') answers.push(e.text); });

function turn(text, ms) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; off(); resolve({ timedOut: true }); } }, ms);
    const off = b.onEvent((e) => {
      if (e.kind === 'turn_complete' && !done) {
        done = true; clearTimeout(timer); off(); resolve({ timedOut: false, result: e.result });
      }
    });
    b.sendUserTurn(text);
  });
}

(async () => {
  await b.start(process.env);
  await new Promise((r) => { const off = b.onEvent((e) => { if (e.kind === 'ready') { off(); r(); } }); });

  answers = [];
  const t1 = await turn('Remember the number 42. Just acknowledge briefly.', 45000);
  console.log('TURN1_TIMEDOUT:', t1.timedOut, '| ANSWER:', JSON.stringify(answers.join(' ')));

  answers = [];
  const t2 = await turn('What number did I ask you to remember? Reply with just the number.', 45000);
  console.log('TURN2_TIMEDOUT:', t2.timedOut, '| ANSWER:', JSON.stringify(answers.join(' ')));

  const ok = !t1.timedOut && !t2.timedOut && answers.join(' ').includes('42');
  console.log('MULTI_TURN_CONTEXT_OK:', ok);

  await b.stop();
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
