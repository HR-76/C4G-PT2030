const test = require('node:test');
const assert = require('node:assert/strict');
const { createScheduledRefresh, loadScheduleConfiguration, requestIdFor } = require('../src/fundingTenders/scheduledRefresh');

const USER = '11111111-1111-4111-8111-111111111111';
const EU = 'EU_FUNDING_TENDERS';
const code = value => Object.assign(new Error(value), { code: value });

function harness({ now = '2026-11-12T04:05:00Z', outcomes = {}, sources = [EU] } = {}) {
  const clock = { now: new Date(now) };
  const calls = [];
  const logs = [];
  const repository = { async enqueue(userId, requestId, source) {
    calls.push({ userId, requestId, source });
    const outcome = (outcomes[source] || []).shift();
    if (outcome instanceof Error) throw outcome;
    return outcome || { runId: `run-${calls.length}`, status: 'QUEUED', source };
  } };
  const scheduled = createScheduledRefresh({ repository, userId: USER, sources, clock: () => clock.now, log: entry => logs.push(entry), retryMs: 10 * 60 * 1000, maxAttempts: 3 });
  return { scheduled, calls, logs, clock };
}

test('antes das 04:00 de Lisboa não pede nada; a partir daí pede uma vez por dia e fonte', async () => {
  const { scheduled, calls, clock } = harness({ now: '2026-11-12T03:59:00Z' });
  await scheduled.tick();
  assert.equal(calls.length, 0);
  clock.now = new Date('2026-11-12T04:00:00Z');
  await scheduled.tick();
  await scheduled.tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { userId: USER, requestId: requestIdFor('2026-11-12', EU), source: EU });
});

test('o fuso de Lisboa respeita o horário de verão', async () => {
  const early = harness({ now: '2026-07-01T02:30:00Z' }); // 03:30 em Lisboa
  await early.scheduled.tick();
  assert.equal(early.calls.length, 0);
  const due = harness({ now: '2026-07-01T03:00:00Z' }); // 04:00 em Lisboa
  await due.scheduled.tick();
  assert.equal(due.calls.length, 1);
});

test('identificador do pedido é determinístico por dia e fonte, e é um UUID válido', () => {
  const a = requestIdFor('2026-11-12', EU);
  assert.equal(a, requestIdFor('2026-11-12', EU));
  assert.notEqual(a, requestIdFor('2026-11-13', EU));
  assert.notEqual(a, requestIdFor('2026-11-12', 'CORDIS'));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('reiniciar depois das 04:00 retoma o dia sem duplicar: o pedido repete o mesmo identificador', async () => {
  const first = harness({ now: '2026-11-12T09:00:00Z' });
  const second = harness({ now: '2026-11-12T09:30:00Z' });
  await first.scheduled.tick();
  await second.scheduled.tick();
  assert.equal(first.calls[0].requestId, second.calls[0].requestId);
});

test('fonte suspensa ou escritor em falta: salta o dia uma só vez, sem repetir nem alarmar', async () => {
  const { scheduled, calls, logs, clock } = harness({ outcomes: { [EU]: [code('OPPORTUNITY_V2_EU_SUSPENDED')] } });
  await scheduled.tick();
  clock.now = new Date('2026-11-12T05:00:00Z');
  await scheduled.tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(logs.filter(entry => entry.event === 'FUNDING_REFRESH_SKIPPED').map(entry => entry.reason), ['OPPORTUNITY_V2_EU_SUSPENDED']);
  assert.equal(logs.some(entry => entry.event === 'FUNDING_REFRESH_FAILED'), false);
  clock.now = new Date('2026-11-13T04:00:00Z'); // novo dia: tenta de novo
  await scheduled.tick();
  assert.equal(calls.length, 2);
});

test('recolha em curso: repete passados 10 minutos e só até ao limite de tentativas', async () => {
  const { scheduled, calls, logs, clock } = harness({ outcomes: { [EU]: [code('FUNDING_BUSY'), code('FUNDING_BUSY'), code('FUNDING_BUSY')] } });
  await scheduled.tick();
  clock.now = new Date('2026-11-12T04:09:00Z');
  await scheduled.tick();
  assert.equal(calls.length, 1); // ainda cedo
  clock.now = new Date('2026-11-12T04:16:00Z');
  await scheduled.tick();
  clock.now = new Date('2026-11-12T04:30:00Z');
  await scheduled.tick();
  clock.now = new Date('2026-11-12T05:30:00Z');
  await scheduled.tick();
  assert.equal(calls.length, 3);
  assert.equal(logs.filter(entry => entry.event === 'FUNDING_REFRESH_FAILED').length, 1);
  assert.equal(logs.find(entry => entry.event === 'FUNDING_REFRESH_FAILED').reason, 'FUNDING_BUSY');
});

test('erros de configuração não são repetidos e uma fonte com erro não impede a seguinte', async () => {
  const { scheduled, calls, logs } = harness({ sources: [EU, 'CORDIS'], outcomes: { [EU]: [code('FUNDING_FORBIDDEN')] } });
  await scheduled.tick();
  await scheduled.tick();
  assert.deepEqual(calls.map(call => call.source), [EU, 'CORDIS']);
  assert.equal(logs.filter(entry => entry.event === 'FUNDING_REFRESH_FAILED' && entry.reason === 'FUNDING_FORBIDDEN').length, 1);
  assert.equal(logs.filter(entry => entry.event === 'FUNDING_REFRESH_REQUESTED').length, 1);
});

test('registos nunca incluem identificadores de utilizador nem mensagens de erro', async () => {
  const { scheduled, logs } = harness({ outcomes: { [EU]: [Object.assign(new Error('postgres://segredo@db'), { code: 'BOOM' })] } });
  await scheduled.tick();
  assert.ok(!JSON.stringify(logs).includes(USER));
  assert.ok(!JSON.stringify(logs).includes('segredo'));
});

test('start agenda ticks periódicos e shutdown cancela-os', async () => {
  const timers = [];
  const scheduler = { setTimeout: (fn, ms) => { const timer = { fn, ms, cleared: false, unref() {} }; timers.push(timer); return timer; }, clearTimeout: timer => { timer.cleared = true; } };
  const repository = { async enqueue() { return { runId: 'r', status: 'QUEUED' }; } };
  const scheduled = createScheduledRefresh({ repository, userId: USER, sources: [EU], clock: () => new Date('2026-11-12T05:00:00Z'), scheduler, intervalMs: 30000, log: () => {} });
  scheduled.start();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 30000);
  await timers[0].fn();
  assert.equal(timers.length, 2);
  await scheduled.shutdown();
  assert.equal(timers.at(-1).cleared, true);
});

test('configuração: desligada por omissão; validada quando ligada', () => {
  const sources = [EU, 'CORDIS'];
  assert.equal(loadScheduleConfiguration({}, sources), null);
  const on = { FUNDING_TENDERS_SCHEDULE: 'daily-v1', FUNDING_TENDERS_SCHEDULE_USER_ID: USER };
  assert.deepEqual(loadScheduleConfiguration(on, sources), { userId: USER, sources: [EU], at: '04:00' });
  assert.deepEqual(loadScheduleConfiguration({ ...on, FUNDING_TENDERS_SCHEDULE_SOURCES: 'EU_FUNDING_TENDERS,CORDIS', FUNDING_TENDERS_SCHEDULE_AT: '05:30' }, sources), { userId: USER, sources: [EU, 'CORDIS'], at: '05:30' });
  const invalid = overrides => assert.throws(() => loadScheduleConfiguration({ ...on, ...overrides }, sources), { code: 'FUNDING_SCHEDULE_CONFIGURATION_INVALID' });
  invalid({ FUNDING_TENDERS_SCHEDULE: 'hourly' });
  invalid({ FUNDING_TENDERS_SCHEDULE_USER_ID: 'não-é-uuid' });
  invalid({ FUNDING_TENDERS_SCHEDULE_SOURCES: 'OUTRA_FONTE' });
  invalid({ FUNDING_TENDERS_SCHEDULE_SOURCES: 'EU_FUNDING_TENDERS,EU_FUNDING_TENDERS' });
  invalid({ FUNDING_TENDERS_SCHEDULE_AT: '25:00' });
  invalid({ FUNDING_TENDERS_SCHEDULE_AT: '4h' });
  assert.throws(() => loadScheduleConfiguration({ FUNDING_TENDERS_SCHEDULE: 'daily-v1' }, sources), { code: 'FUNDING_SCHEDULE_CONFIGURATION_INVALID' });
});

test('perfil local: a agenda em runtime.json vira variáveis de ambiente, sem chaves indefinidas', () => {
  const { fundingScheduleEnvironment } = require('../scripts/localPlatform/runtime');
  assert.deepEqual(fundingScheduleEnvironment(undefined), {});
  assert.deepEqual(fundingScheduleEnvironment({ userId: USER }), { FUNDING_TENDERS_SCHEDULE: 'daily-v1', FUNDING_TENDERS_SCHEDULE_USER_ID: USER });
  assert.deepEqual(fundingScheduleEnvironment({ userId: USER, sources: [EU, 'CORDIS'], at: '05:00' }),
    { FUNDING_TENDERS_SCHEDULE: 'daily-v1', FUNDING_TENDERS_SCHEDULE_USER_ID: USER, FUNDING_TENDERS_SCHEDULE_SOURCES: 'EU_FUNDING_TENDERS,CORDIS', FUNDING_TENDERS_SCHEDULE_AT: '05:00' });
  // The exported environment must round-trip through the worker configuration loader.
  const env = fundingScheduleEnvironment({ userId: USER, sources: [EU], at: '04:00' });
  assert.deepEqual(loadScheduleConfiguration(env, [EU, 'CORDIS']), { userId: USER, sources: [EU], at: '04:00' });
});
