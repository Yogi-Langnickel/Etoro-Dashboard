import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, lstat, realpath, mkdtemp, readdir, readFile, writeFile, rm, link, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test, { before, after } from 'node:test';
import { createRequestHandler, createReadOnlyProviderCache, validateDashboardRequestBoundary } from '../src/server.mjs';
import { loadBotConfig, saveBotConfig } from '../src/bot-config-store.mjs';
import { installRuntime, verifyRuntime, RUNTIME_MANIFEST } from '../src/money-maker-runtime.mjs';
import { createMoneyMakerAdapter, validateOfflineAction, runBoundedSubprocess, OFFLINE_PYTHON_EXECUTABLE } from '../src/money-maker-adapter.mjs';

const completeDraft = { runMode: 'backtest', strategyId: 'dca-cash-reserve', budgetUsd: 1000, allowedMarkets: ['US_EQUITIES'], allowedInstrumentClasses: ['ETF'], cadence: 'daily', minimumEvaluationIntervalMinutes: 240 };
const producer = process.env.MONEY_MAKER_PRODUCER_CHECKOUT ?? '/Users/yogi/Coding/.worktrees/money-maker-integration';
let root, runtime, producerAvailable = true;
before(async () => {
  root = await mkdtemp(join(await realpath(tmpdir()), 'dashboard-offline-operations-'));
  await chmod(root, 0o700);
  runtime = join(root, 'runtime');
  try { await lstat(join(producer, '.git')); } catch { producerAvailable = false; return; }
  await installRuntime({ producerCheckout: producer, runtimeRoot: runtime });
});
after(async () => {
  async function unseal(path) { const info = await lstat(path); if (info.isDirectory() && !info.isSymbolicLink()) { await chmod(path, 0o700); for (const child of await readdir(path)) await unseal(join(path, child)); } }
  await unseal(root);
  await rm(root, { recursive: true, force: true });
});
function requireProducer(context) { if (!producerAvailable) { context.skip('Pinned producer Git object unavailable; actual integration requires local setup'); return false; } return true; }
async function request(handler, { url = '/api/health', method = 'GET', headers = {}, body = '' } = {}) {
  const response = { status: 0, headers: {}, body: '', writeHead(status, fields) { this.status = status; this.headers = fields; }, end(content) { this.body = String(content ?? ''); } };
  await handler({ url, method, headers: { host: '127.0.0.1:4173', ...headers }, body }, response);
  return { ...response, json: response.body.startsWith('{') ? JSON.parse(response.body) : null };
}

test('Host and supplied Origin reject every read before config, provider, bot state, or static access', async () => {
  let access = 0;
  const forbidden = async () => { access++; throw new Error('Should not access'); };
  const handler = createRequestHandler({ loadConfig: forbidden, loadBotConfig: forbidden, fetchEndpoint: forbidden, moneyMakerAdapter: { status: forbidden, act: forbidden } });
  for (const host of ['attacker.example', 'localhost.attacker.example', 'localhost:4173@attacker.example', '127.0.0.1:0', 'localhost:99999', 'localhost:4173/path', '[::1]:4173@attacker.example', undefined, ['localhost:4173', 'attacker.example']]) {
    for (const url of ['/', '/app.js', '/api/etoro/status', '/api/etoro/bot/config', '/api/etoro/bot/operations']) assert.equal((await request(handler, { url, headers: { host } })).status, 403);
  }
  for (const origin of ['http://attacker.example', 'http://localhost:4173', 'http://127.0.0.1:4174', 'https://127.0.0.1:4173', 'null', 'http://127.0.0.1:4173/path', 'http://user@127.0.0.1:4173']) assert.equal((await request(handler, { headers: { origin } })).status, 403);
  assert.equal((await request(handler, { url: 'http://attacker.example/api/health' })).status, 403);
  assert.equal(access, 0);
  assert.equal(validateDashboardRequestBoundary({ url: '/api/health', headers: { host: '[::1]:4173', origin: 'http://[::1]:4173' } }), true);
  assert.equal(validateDashboardRequestBoundary({ url: '/', headers: { host: 'localhost:4173' }, rawHeaders: ['Host', 'localhost:4173', 'Origin', 'http://localhost:4173', 'Origin', 'http://localhost:4173'] }), false);
});

test('Offline operations and draft config avoid provider credential configuration; mutations require same Origin, JSON and token', async () => {
  let providerAccess = 0, mutations = 0;
  const handler = createRequestHandler({ botConfigFile: join(root, 'draft.json'), loadConfig: async () => { providerAccess++; throw new Error('Credentials denied'); }, moneyMakerAdapter: { status: async () => ({ ok: true }), act: async (input) => { validateOfflineAction(input); mutations++; return { ok: true }; } } });
  const status = await request(handler, { url: '/api/etoro/bot/operations' });
  assert.equal(status.status, 200);
  assert.equal((await request(handler, { url: '/api/etoro/bot/config' })).status, 200);
  const body = JSON.stringify({ action: 'run-once', operationId: randomUUID() });
  for (const headers of [{}, { origin: 'http://127.0.0.1:4173', 'content-type': 'text/plain' }, { origin: 'http://127.0.0.1:4173', 'content-type': 'application/json' }, { origin: 'http://127.0.0.1:4174', 'content-type': 'application/json', 'x-etoro-dashboard-csrf': status.headers['x-etoro-dashboard-config-token'] }]) assert.ok((await request(handler, { url: '/api/etoro/bot/operations', method: 'POST', headers, body })).status >= 400);
  const headers = { origin: 'http://127.0.0.1:4173', 'content-type': 'application/json', 'x-etoro-dashboard-csrf': status.headers['x-etoro-dashboard-config-token'] };
  assert.equal((await request(handler, { url: '/api/etoro/bot/operations', method: 'POST', headers, body })).status, 200);
  assert.equal(mutations, 1);
  assert.equal(providerAccess, 0);
});

test('Last-good data ages independently of failure and repeated backoff, then recovery resets age', async () => {
  let clock = 100000, calls = 0, failing = false;
  const cache = createReadOnlyProviderCache({ now: () => clock, ttlMs: 1000, failureBackoffMs: 500 });
  const fetcher = async () => { calls++; if (failing) throw Object.assign(new Error('Private provider payload'), { code: 'ETORO_PROVIDER_ERROR', status: 503 }); return { data: { validZero: 0, negativePnl: -5 } }; };
  const first = await cache.fetch('portfolio:real', {}, fetcher);
  clock += 1001; failing = true;
  const failed = await cache.fetch('portfolio:real', {}, fetcher);
  assert.equal(failed.cache.state, 'stale');
  for (const field of ['cachedAt', 'expiresAt', 'ttlMs']) assert.equal(failed.cache[field], first.cache[field]);
  assert.equal(failed.cache.failureAt, new Date(clock).toISOString());
  clock += 200;
  const backoff = await cache.fetch('portfolio:real', {}, fetcher);
  assert.deepEqual(backoff.cache, failed.cache);
  assert.equal(calls, 2);
  clock += 301;
  const failedAgain = await cache.fetch('portfolio:real', {}, fetcher);
  assert.equal(failedAgain.cache.cachedAt, first.cache.cachedAt);
  assert.ok(failedAgain.cache.failureAt > failed.cache.failureAt);
  clock += 501; failing = false;
  const recovered = await cache.fetch('portfolio:real', {}, fetcher);
  assert.equal(recovered.cache.cachedAt, new Date(clock).toISOString());
  assert.equal(recovered.cache.retryAt, undefined);
  assert.deepEqual(recovered.data, first.data);
});

test('Draft config accepts only complete exact typed fields and rejects corrupted retained configuration', async () => {
  const file = join(root, 'strict-draft.json');
  for (const input of [{ budgetUsd: 1000 }, { ...completeDraft, budgetUsd: '1000' }, { ...completeDraft, budgetUsd: true }, { ...completeDraft, cadence: ['daily'] }, { ...completeDraft, allowedMarkets: ['US_EQUITIES', 'US_EQUITIES'] }, { ...completeDraft, allowedMarkets: [123] }, { ...completeDraft, minimumEvaluationIntervalMinutes: 300 }, { ...completeDraft, command: 'execute' }, { ...completeDraft, updatedAt: '2026-10-03T00:00:00.000Z' }]) await assert.rejects(saveBotConfig(input, { configFile: file }), { code: 'BOT_CONFIG_INVALID' });
  await saveBotConfig(completeDraft, { configFile: file });
  assert.equal((await loadBotConfig({ configFile: file })).config.budgetUsd, 1000);
  await writeFile(file, JSON.stringify({ budgetUsd: 1000 }));
  await assert.rejects(loadBotConfig({ configFile: file }), { code: 'BOT_CONFIG_INVALID' });
  for (const input of [{ action: 'run-once', operationId: randomUUID(), path: '/tmp' }, { action: 'execute', operationId: randomUUID() }, { action: 'run-once', operationId: 'x' }, { action: ['run-once'], operationId: randomUUID() }]) assert.throws(() => validateOfflineAction(input), { code: 'OFFLINE_ACTION_INVALID' });
});

test('Immutable runtime verifies complete committed inventory and rejects content, extra import, symlink and hardlink drift', async (context) => {
  if (!requireProducer(context)) return;
  assert.equal(await verifyRuntime(runtime), runtime);
  assert.equal(Object.keys(RUNTIME_MANIFEST.files).filter((file) => file.startsWith('tests/fixtures/')).length, 10);
  const file = join(runtime, 'contracts/offline-simulation-runner-v1.json');
  const original = await readFile(file);
  await chmod(file, 0o600);
  await writeFile(file, `${original}\n`);
  await chmod(file, 0o400);
  await assert.rejects(verifyRuntime(runtime), /drift/);
  await chmod(file, 0o600); await writeFile(file, original); await chmod(file, 0o400);
  await chmod(runtime, 0o700); await writeFile(join(runtime, 'shadow.py'), '', { mode: 0o400 }); await chmod(runtime, 0o500);
  await assert.rejects(verifyRuntime(runtime), /inventory drift/);
  await chmod(runtime, 0o700); await rm(join(runtime, 'shadow.py')); await chmod(runtime, 0o500);
  const hard = join(root, 'runtime-hardlink'); await link(file, hard);
  await assert.rejects(verifyRuntime(runtime), /inventory/); await rm(hard);
  const symbolic = join(root, 'runtime-symlink'); await symlink(runtime, symbolic);
  await assert.rejects(verifyRuntime(symbolic), /symbolic links/); await rm(symbolic);
  assert.equal(await verifyRuntime(runtime), runtime);
});

test('Genuine producer handles non-ready status, one completion, restart retry preserving original startedAt, block and re-enable', async (context) => {
  if (!requireProducer(context)) return;
  const stateRoot = join(root, 'lifecycle-state');
  let adapter = createMoneyMakerAdapter({ runtimeRoot: runtime, stateRoot });
  const initial = await adapter.status();
  assert.equal(initial.state, 'unavailable'); assert.equal(initial.lease.integrity, 'uninitialized'); assert.equal(initial.capabilities.runOnce, true);
  const identity = randomUUID();
  const completed = await adapter.act({ action: 'run-once', operationId: identity });
  assert.equal(completed.action.status, 'completed'); assert.equal(completed.ledger.recordCount, 1); assert.equal(completed.lease.completionCount, 1);
  assert.deepEqual(completed.lastResult.diagnostics, { fixtureRows: 202, eventCount: 202, blockedEventCount: 202, strategyHistoryState: 'trend-confirmed', walkForwardState: 'available', samplingState: 'weekday-grid-covered' });
  assert.ok(completed.lastResult.vetoReasons.includes('execution-route-absent'));
  assert.notEqual(completed.observedAt, '2026-05-15T00:00:00.000Z');
  adapter = createMoneyMakerAdapter({ runtimeRoot: runtime, stateRoot });
  const retried = await adapter.act({ action: 'run-once', operationId: identity });
  assert.equal(retried.action.status, 'already-completed'); assert.equal(retried.operation.startedAt, completed.operation.startedAt); assert.equal(retried.ledger.recordCount, 1);
  assert.equal((await readFile(join(stateRoot, 'ledger.jsonl'), 'utf8')).trim().split('\n').length, 1);
  const blocked = await adapter.act({ action: 'block', operationId: randomUUID() });
  assert.equal(blocked.state, 'blocked'); assert.equal(blocked.lease.killSwitchReason, 'operator-stop'); assert.equal(blocked.capabilities.runOnce, false);
  const vetoed = await adapter.act({ action: 'run-once', operationId: randomUUID() });
  assert.equal(vetoed.action.status, 'lease-blocked'); assert.equal(vetoed.ledger.recordCount, 1);
  const enabled = await adapter.act({ action: 'reenable', operationId: randomUUID() });
  assert.equal(enabled.lease.workerState, 'available'); assert.equal(enabled.capabilities.runOnce, true);
  assert.equal(JSON.stringify(enabled).includes(stateRoot), false);
  assert.equal(JSON.stringify(enabled).includes('configHash'), false);
});

test('First-run block and re-enable support clean missing ledger; deleted completed state and corrupt journal fail closed', async (context) => {
  if (!requireProducer(context)) return;
  const stateRoot = join(root, 'first-block-state');
  const adapter = createMoneyMakerAdapter({ runtimeRoot: runtime, stateRoot });
  const blocked = await adapter.act({ action: 'block', operationId: randomUUID() });
  assert.equal(blocked.lease.workerState, 'kill-switch-blocked'); assert.equal(blocked.ledger.integrity, 'missing');
  const enabled = await adapter.act({ action: 'reenable', operationId: randomUUID() });
  assert.equal(enabled.capabilities.runOnce, true);
  await adapter.act({ action: 'run-once', operationId: randomUUID() });
  await rm(join(stateRoot, 'lease.json'));
  assert.equal((await adapter.status()).capabilities.runOnce, false);
  await assert.rejects(adapter.act({ action: 'run-once', operationId: randomUUID() }));
  const journal = JSON.parse(await readFile(join(stateRoot, 'operations.json'), 'utf8'));
  journal.operations[0].startedAt = 'unsafe';
  await writeFile(join(stateRoot, 'operations.json'), JSON.stringify(journal), { mode: 0o600 });
  await assert.rejects(adapter.status());
});

test('Corrupt ledger and unsafe state sidecars cannot produce successful action or disclose contents', async (context) => {
  if (!requireProducer(context)) return;
  const stateRoot = join(root, 'corrupt-ledger-state');
  const adapter = createMoneyMakerAdapter({ runtimeRoot: runtime, stateRoot });
  await adapter.act({ action: 'run-once', operationId: randomUUID() });
  await writeFile(join(stateRoot, 'ledger.jsonl'), '{ malformed private sentinel }\n', { mode: 0o600 });
  const status = await adapter.status(); assert.equal(status.ledger.integrity, 'corrupted'); assert.equal(status.capabilities.runOnce, false);
  await assert.rejects(adapter.act({ action: 'run-once', operationId: randomUUID() }));
  await link(join(stateRoot, '.lease.json.lock'), join(root, 'sidecar-hardlink'));
  await assert.rejects(adapter.status(), { code: 'OFFLINE_STATE_UNSAFE' });
});

test('Subprocess limits, minimal environment and Python isolated imports deny injected credentials and site hooks', async (context) => {
  const previous = { PYTHONPATH: process.env.PYTHONPATH, ETORO_API_KEY: process.env.ETORO_API_KEY };
  process.env.PYTHONPATH = root; process.env.ETORO_API_KEY = 'synthetic-denied';
  try {
    await writeFile(join(root, 'sitecustomize.py'), 'raise RuntimeError("ambient import executed")\n');
    const payload = await runBoundedSubprocess(OFFLINE_PYTHON_EXECUTABLE, ['-I', '-S', '-B', '-c', 'import os,json,sys;print(json.dumps({"credential":os.environ.get("ETORO_API_KEY"),"pythonpath":os.environ.get("PYTHONPATH"),"isolated":sys.flags.isolated,"site":sys.flags.no_site}))'], { cwd: root });
    assert.deepEqual(payload, { credential: null, pythonpath: null, isolated: 1, site: 1 });
    if (producerAvailable) {
      const actual = createMoneyMakerAdapter({ runtimeRoot: runtime, stateRoot: join(root, 'injected-environment-state') });
      const completed = await actual.act({ action: 'run-once', operationId: randomUUID() });
      assert.equal(completed.action.status, 'completed');
      assert.equal(completed.safety.credentials, 'absent');
    }
    await assert.rejects(runBoundedSubprocess(OFFLINE_PYTHON_EXECUTABLE, ['-I', '-S', '-c', 'import time;time.sleep(2)'], { cwd: root, timeoutMs: 50 }), { code: 'OFFLINE_TIMEOUT' });
    await assert.rejects(runBoundedSubprocess(OFFLINE_PYTHON_EXECUTABLE, ['-I', '-S', '-c', 'print("x"*10000)'], { cwd: root, outputLimitBytes: 100 }), { code: 'OFFLINE_OUTPUT_LIMIT' });
    assert.deepEqual(await runBoundedSubprocess(OFFLINE_PYTHON_EXECUTABLE, ['-I', '-S', '-c', 'import sys;print("{\\"nonready\\":true}");sys.exit(1)'], { cwd: root }), { nonready: true });
  } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test('Actual producer busy lease blocks concurrent run; Dashboard block fences an already acquired completion', async (context) => {
  if (!requireProducer(context)) return;
  const stateRoot = join(root, 'fencing-state');
  const adapter = createMoneyMakerAdapter({ runtimeRoot: runtime, stateRoot });
  await adapter.status();
  const marker = join(root, 'fenced-completion-marker');
  const script = `import sys,json\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nfrom money_maker_3000.worker_leases import WorkerLeaseStore\nstore=WorkerLeaseStore(Path(sys.argv[2])/'lease.json')\nstore.initialize()\nlease=store.acquire(holder='test-held-diagnostic',idempotency_key='test-held-occurrence',ttl_seconds=300)\nassert lease['status']=='acquired'\nprint('ready',flush=True)\nsys.stdin.readline()\nresult=store.complete_fenced(holder='test-held-diagnostic',idempotency_key='test-held-occurrence',epoch=lease['epoch'],fence=lease['fence'],operation=lambda:Path(sys.argv[3]).write_text('unsafe-completion'))\nprint(json.dumps({'completed':result['completed'],'status':result['status']}),flush=True)\n`;
  const child = spawn(OFFLINE_PYTHON_EXECUTABLE, ['-I', '-S', '-B', '-c', script, join(runtime, 'src'), stateRoot, marker], { cwd: runtime, env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', stderr = '';
  child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
  const done = new Promise((resolve) => child.once('close', resolve));
  try {
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Held lease did not become ready')), 3000); child.stdout.once('data', () => { clearTimeout(timer); resolve(); }); });
    assert.equal(output.trim(), 'ready');
    const busy = await adapter.status(); assert.equal(busy.state, 'in-progress'); assert.equal(busy.capabilities.runOnce, false);
    const declined = await adapter.act({ action: 'run-once', operationId: randomUUID() });
    assert.equal(declined.action.status, 'lease-blocked'); assert.equal(declined.ledger.recordCount, 0);
    const blocked = await adapter.act({ action: 'block', operationId: randomUUID() });
    assert.equal(blocked.lease.workerState, 'kill-switch-blocked');
    child.stdin.end('continue\n');
    assert.equal(await done, 0, stderr);
    const completion = JSON.parse(output.trim().split('\n').at(-1));
    assert.equal(completion.completed, false);
    await assert.rejects(lstat(marker), { code: 'ENOENT' });
    const final = await adapter.status(); assert.equal(final.ledger.recordCount, 0); assert.equal(final.lease.completionCount, 0);
  } finally { child.kill('SIGKILL'); }
});

test('Adapter bounds concurrent Run requests before launching a second subprocess', async (context) => {
  if (!requireProducer(context)) return;
  let calls = 0, unlock;
  const blocked = new Promise((resolve) => { unlock = resolve; });
  const adapter = createMoneyMakerAdapter({ runtimeRoot: runtime, stateRoot: join(root, 'concurrency-state'), subprocess: async () => { calls++; await blocked; throw new Error('Controlled unavailable result'); } });
  const first = adapter.act({ action: 'run-once', operationId: randomUUID() });
  await assert.rejects(adapter.act({ action: 'run-once', operationId: randomUUID() }), { code: 'OFFLINE_BUSY' });
  unlock(); await assert.rejects(first);
  assert.equal(calls, 1);
});

test('Session audit reflects actual accepted actions and timestamps without credentials or invented history', async () => {
  let credentialLoads = 0;
  const observedAt = new Date().toISOString();
  const handler = createRequestHandler({ loadConfig: async () => { credentialLoads++; throw new Error('Credential load forbidden'); }, moneyMakerAdapter: { status: async () => ({ ok: true }), act: async () => ({ ok: true, observedAt, action: { type: 'block', status: 'completed' } }) } });
  assert.deepEqual((await request(handler, { url: '/api/etoro/bot/audit' })).json.auditEvents, []);
  const read = await request(handler, { url: '/api/etoro/bot/operations' });
  await request(handler, { url: '/api/etoro/bot/operations', method: 'POST', headers: { origin: 'http://127.0.0.1:4173', 'content-type': 'application/json', 'x-etoro-dashboard-csrf': read.headers['x-etoro-dashboard-config-token'] }, body: JSON.stringify({ action: 'block', operationId: randomUUID() }) });
  const audit = await request(handler, { url: '/api/etoro/bot/audit' });
  assert.equal(audit.json.auditEvents.length, 1); assert.equal(audit.json.auditEvents[0].action, 'diagnostic_block'); assert.equal(audit.json.auditEvents[0].createdAt, observedAt); assert.equal(audit.json.auditEvents[0].outcome, 'completed');
  const events = await request(handler, { url: '/api/etoro/bot/events' }); assert.equal(events.json.events.length, 1);
  assert.equal(credentialLoads, 0);
});

test('Consumer rejects contradictory producer safety and telemetry before exposing operational success', async (context) => {
  if (!requireProducer(context)) return;
  const stateRoot = join(root, 'telemetry-validation-state');
  const live = createMoneyMakerAdapter({ runtimeRoot: runtime, stateRoot });
  await live.act({ action: 'run-once', operationId: randomUUID() });
  const bridge = new URL('../scripts/money-maker-bridge.py', import.meta.url).pathname;
  const raw = await runBoundedSubprocess(OFFLINE_PYTHON_EXECUTABLE, ['-I', '-S', '-B', bridge, runtime, stateRoot, 'status', '-', new Date().toISOString()], { cwd: runtime });
  const mutations = [
    (value) => { value.operations.accountData = 'present'; },
    (value) => { value.lease.liveExecution = 'enabled'; },
    (value) => { value.journal.lastResult.result.credentials = 'present'; },
    (value) => { value.ledger.summary.recordCount = '1'; },
    (value) => { value.journal.lastResult.result.diagnostics.blockedEventCount = 203; },
    (value) => { value.ledger.summary.vetoHistogram = { 'untrusted-private-message': 1 }; },
  ];
  for (const mutate of mutations) {
    const altered = structuredClone(raw); mutate(altered);
    const adapter = createMoneyMakerAdapter({ runtimeRoot: runtime, stateRoot, subprocess: async () => altered });
    await assert.rejects(adapter.status(), { code: 'OFFLINE_TELEMETRY_INVALID' });
  }
  const mismatch = structuredClone(raw); mismatch.lease.workerGate.completionCount = 0;
  const adapter = createMoneyMakerAdapter({ runtimeRoot: runtime, stateRoot, subprocess: async () => mismatch });
  const blocked = await adapter.status(); assert.equal(blocked.state, 'blocked'); assert.equal(blocked.capabilities.runOnce, false);
  mismatch.action = { type: 'run-once', status: 'completed' }; mismatch.operationResult = mismatch.journal.lastResult;
  await assert.rejects(adapter.act({ action: 'run-once', operationId: randomUUID() }), { code: 'OFFLINE_ACTION_UNCONFIRMED' });
});
