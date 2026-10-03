import { spawn } from 'node:child_process';
import { lstat, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RUNTIME_ROOT, DEFAULT_SIMULATION_ROOT, PRODUCER_COMMIT, RUNTIME_MANIFEST, assertOutsideRepositories, verifyRuntime } from './money-maker-runtime.mjs';

export const OPERATIONS_DTO_VERSION = 'dashboard-offline-operations.v1';
export const BOT_CAPABILITY_REGISTRY = Object.freeze({
  version: 'dashboard-bot-capabilities.v1', adapters: Object.freeze([
    Object.freeze({ id: 'money-maker-3000', version: 1, capabilities: Object.freeze(['operations-status', 'lease-report', 'ledger-report', 'run-once', 'block', 'reenable']) }),
  ]), unsupportedCapabilities: 'unavailable',
});
const BRIDGE = fileURLToPath(new URL('../scripts/money-maker-bridge.py', import.meta.url));
export const OFFLINE_PYTHON_EXECUTABLE = process.platform === 'darwin' ? '/usr/local/bin/python3.13' : '/usr/bin/python3';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_FILES = new Set(['lease.json', '.lease.json.lock', 'ledger.jsonl', '.ledger.jsonl.lock', 'operations.json', '.operations.lock']);
const SAFETY = Object.freeze({ providerCalls: 'blocked', credentials: 'absent', accountData: 'absent', executionRoutes: 'absent', performanceClaims: 'synthetic-diagnostics-no-investment-profit-evidence', blockBehavior: 'fences-completion-does-not-terminate-process' });
const PARAMETERS = Object.freeze({ producerCommit: PRODUCER_COMMIT, manifestId: 'approved-slow-trend-fixture-diagnostics', fixture: 'SPY synthetic daily', strategyId: 'slow-trend-allocation', budgetUsd: 1000, botAllocationUsd: 1000, reservedUsd: 100, maxOrderUsd: 250 });

export class OfflineOperationError extends Error {
  constructor(code) { super('Isolated offline diagnostic operation is unavailable.'); this.code = code; }
}
export function validateOfflineAction(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'action,operationId' || !['run-once', 'block', 'reenable'].includes(input.action) || typeof input.operationId !== 'string' || !UUID.test(input.operationId)) throw new OfflineOperationError('OFFLINE_ACTION_INVALID');
  return input;
}

export async function verifyPrivateState(stateRoot) {
  const root = await assertOutsideRepositories(stateRoot);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077)) throw new OfflineOperationError('OFFLINE_STATE_UNSAFE');
  for (const name of await readdir(root)) {
    const file = await lstat(join(root, name));
    if (!SAFE_FILES.has(name) || !file.isFile() || file.nlink !== 1 || file.uid !== process.getuid() || (file.mode & 0o077) || file.size > 16_000_000) throw new OfflineOperationError('OFFLINE_STATE_UNSAFE');
  }
  return root;
}

export function runBoundedSubprocess(executable, args, { cwd, timeoutMs = 20_000, outputLimitBytes = 2_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, cwd, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = [];
    let bytes = 0, failure = null;
    const stop = (code) => { failure ??= new OfflineOperationError(code); child.kill('SIGKILL'); };
    const timer = setTimeout(() => stop('OFFLINE_TIMEOUT'), timeoutMs);
    const consume = (chunk, retain) => { bytes += chunk.length; if (bytes > outputLimitBytes) stop('OFFLINE_OUTPUT_LIMIT'); else if (retain) output.push(chunk); };
    child.stdout.on('data', (chunk) => consume(chunk, true));
    child.stderr.on('data', (chunk) => consume(chunk, false));
    child.once('error', () => { clearTimeout(timer); reject(new OfflineOperationError('OFFLINE_EXECUTABLE_UNAVAILABLE')); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      if (![0, 1].includes(code)) return reject(new OfflineOperationError('OFFLINE_SUBPROCESS_FAILED'));
      try { const data = JSON.parse(Buffer.concat(output).toString('utf8')); if (!data || data.error) throw new Error(); resolve(data); } catch { reject(new OfflineOperationError('OFFLINE_OUTPUT_INVALID')); }
    });
  });
}
function count(value, nullable = false) {
  if (nullable && value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > 10000) {
    throw new OfflineOperationError('OFFLINE_TELEMETRY_INVALID');
  }
  return value;
}
function enumValue(value, allowed) {
  if (!allowed.includes(value)) throw new OfflineOperationError('OFFLINE_TELEMETRY_INVALID');
  return value;
}
function instant(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new OfflineOperationError('OFFLINE_TELEMETRY_INVALID');
  }
  return value;
}
const RESULT_STATUSES = ['pending', 'completed', 'already-completed', 'preflight-blocked', 'lease-blocked', 'completion-blocked'];
const HISTORY_STATES = ['insufficient-history', 'invalid-history', 'trend-confirmed', 'trend-not-confirmed', 'not-applicable'];
const WALK_FORWARD_STATES = ['available', 'insufficient-history', 'invalid-history', 'not-applicable'];
const SAMPLING_STATES = ['insufficient-history', 'weekday-grid-covered', 'mixed-irregular-sampling', 'potential-weekday-gaps', 'non-weekday-observations'];
const resultStatus = (value) => enumValue(value, RESULT_STATUSES);
function operationView(value) {
  if (value === null) return null;
  if (!value || typeof value.id !== 'string' || !UUID.test(value.id) || !['run-once', 'block', 'reenable'].includes(value.action)) {
    throw new OfflineOperationError('OFFLINE_TELEMETRY_INVALID');
  }
  return { id: value.id, action: value.action, startedAt: instant(value.startedAt), status: resultStatus(value.status) };
}
function assertProducerSafety(ops, lease, ledger) {
  const versionsValid = ops?.dtoVersion === 'offline-simulation-operations.v1' &&
    lease?.dtoVersion === 'simulation-worker-lease-report.v1' && ledger?.dtoVersion === 'simulation-ledger-report.v2';
  if (!versionsValid) throw new OfflineOperationError('OFFLINE_TELEMETRY_INVALID');
  const safe = [ops, lease, ledger].every((value) => value.providerCalls === 'blocked' && value.executionRoutes === 'absent') &&
    ops.accountData === 'absent' && lease.accountData === 'absent' && lease.demoExecution === 'blocked' && lease.liveExecution === 'blocked';
  const safeLedger = ledger.integrity?.state === 'missing' || (ledger.demoExecution === 'blocked' && ledger.liveExecution === 'blocked');
  if (!safe || !safeLedger) throw new OfflineOperationError('OFFLINE_TELEMETRY_INVALID');
}
function diagnosticResult(last, ledger) {
  if (!last) return null;
  operationView(last);
  const result = last.result;
  if (last.action !== 'run-once' || result?.dtoVersion !== 'deterministic-offline-simulation-runner.v1' ||
      result.status !== last.status || result.providerCalls !== 'blocked' || result.credentials !== 'absent' ||
      result.accountData !== 'absent' || result.executionRoutes !== 'absent' || result.demoExecution !== 'blocked' || result.liveExecution !== 'blocked') {
    throw new OfflineOperationError('OFFLINE_TELEMETRY_INVALID');
  }
  const source = result.diagnostics;
  let diagnostics = null;
  if (source?.status !== 'not-run') {
    if (source?.status !== 'completed' || source.performanceClaims !== 'diagnostics-only-no-pnl-or-profitability-claim') {
      throw new OfflineOperationError('OFFLINE_TELEMETRY_INVALID');
    }
    diagnostics = {
      fixtureRows: count(source.fixtureRows), eventCount: count(source.eventCount), blockedEventCount: count(source.blockedEventCount),
      strategyHistoryState: enumValue(source.strategyHistoryState, HISTORY_STATES),
      walkForwardState: enumValue(source.walkForwardState, WALK_FORWARD_STATES),
      samplingState: enumValue(source.samplingState, SAMPLING_STATES),
    };
    if (diagnostics.blockedEventCount > diagnostics.eventCount || diagnostics.fixtureRows !== 202 || diagnostics.eventCount !== 202) {
      throw new OfflineOperationError('OFFLINE_TELEMETRY_INVALID');
    }
  }
  const histogram = ledger.summary.vetoHistogram;
  if (!histogram || typeof histogram !== 'object' || Array.isArray(histogram)) throw new OfflineOperationError('OFFLINE_TELEMETRY_INVALID');
  const vetoReasons = Object.entries(histogram).map(([reason, occurrences]) => {
    count(occurrences);
    return enumValue(reason, RUNTIME_MANIFEST.vetoCodes);
  });
  return { status: resultStatus(result.status), startedAt: instant(last.startedAt), diagnostics, vetoReasons };
}
function dto(raw) {
  const observedAt = instant(raw.observedAt);
  const { operations: ops, lease, ledger, journal } = raw;
  assertProducerSafety(ops, lease, ledger);
  let state = enumValue(ops.status, ['ready', 'stale', 'blocked', 'in-progress', 'unavailable']);
  const leaseIntegrity = enumValue(lease.integrity?.state, ['clean', 'uninitialized', 'unavailable', 'corrupted']);
  const workerState = enumValue(lease.workerGate?.state, ['available', 'busy', 'kill-switch-blocked', 'completion-capacity-blocked', 'blocked']);
  const ledgerIntegrity = enumValue(ledger.integrity?.state, ['clean', 'missing', 'corrupted', 'recovered-with-warnings', 'not-assessed']);
  const recordCount = count(ledger.summary?.recordCount);
  const completionCount = count(lease.workerGate.completionCount, true);
  const operation = operationView(journal?.operation ?? null);
  const lastResult = diagnosticResult(journal?.lastResult, ledger);
  const parity = completionCount === recordCount;
  if (workerState === 'kill-switch-blocked' || leaseIntegrity === 'corrupted') state = 'blocked';
  if (workerState === 'busy') state = 'in-progress';
  if (state === 'ready' && (!parity || ledgerIntegrity !== 'clean' || leaseIntegrity !== 'clean')) state = 'blocked';
  const fresh = leaseIntegrity === 'uninitialized' && recordCount === 0 && !lastResult;
  const ledgerAllowsRun = ledgerIntegrity === 'clean' ||
    (ledgerIntegrity === 'missing' && completionCount === 0 && !['completed', 'already-completed'].includes(lastResult?.status));
  return {
    ok: true, dtoVersion: OPERATIONS_DTO_VERSION, adapterId: 'money-maker-3000', state,
    observedAt, expiresAt: new Date(Date.parse(observedAt) + 30_000).toISOString(), source: 'isolated-synthetic-engine',
    capabilities: {
      runOnce: fresh || (leaseIntegrity === 'clean' && workerState === 'available' && parity && ledgerAllowsRun),
      block: fresh || leaseIntegrity === 'clean', reenable: leaseIntegrity === 'clean' && workerState === 'kill-switch-blocked',
    },
    runtime: { verified: true, ...PARAMETERS },
    lease: { integrity: leaseIntegrity, workerState, completionCount, killSwitchReason: enumValue(lease.workerGate.killSwitchReason, [null, 'operator-stop', 'operator-reenable']) },
    ledger: { integrity: ledgerIntegrity, recordCount, latestRecordedAt: instant(ledger.summary.lastRecordedAt, true) },
    lastResult, operation, safety: SAFETY,
  };
}
function assertActionConfirmed(raw, view, action, operationId) {
  if (raw.operationResult?.id !== operationId || raw.operationResult?.action !== action) throw new OfflineOperationError('OFFLINE_ACTION_UNCONFIRMED');
  if (!raw.action || raw.action.type !== action) throw new OfflineOperationError('OFFLINE_ACTION_UNCONFIRMED');
  const status = resultStatus(raw.action.status);
  const cleanLease = view.lease.integrity === 'clean';
  if (action === 'block' && (!cleanLease || view.lease.workerState !== 'kill-switch-blocked')) throw new OfflineOperationError('OFFLINE_ACTION_UNCONFIRMED');
  if (action === 'reenable' && (!cleanLease || view.lease.workerState !== 'available')) throw new OfflineOperationError('OFFLINE_ACTION_UNCONFIRMED');
  if (action === 'run-once' && ['completed', 'already-completed'].includes(status)) {
    const matchingRecord = Array.isArray(raw.ledger.records) && raw.ledger.records.filter((record) =>
      record.recordedAt === raw.operationResult?.startedAt && record.strategyId === 'slow-trend-allocation').length === 1;
    const complete = cleanLease && view.ledger.integrity === 'clean' && view.ledger.recordCount > 0 &&
      view.lease.completionCount === view.ledger.recordCount && matchingRecord && raw.operationResult?.result?.status === status;
    if (!complete) throw new OfflineOperationError('OFFLINE_ACTION_UNCONFIRMED');
  }
  view.action = { type: action, status };
  view.operation = operationView(raw.operationResult);
}

export function createMoneyMakerAdapter({ runtimeRoot = DEFAULT_RUNTIME_ROOT, stateRoot = DEFAULT_SIMULATION_ROOT, now = () => new Date(), subprocess = runBoundedSubprocess } = {}) {
  let activeRun = false, activeControls = 0, statusPromise = null;
  async function invoke(action, operationId = '-') {
    try {
      const runtime = await verifyRuntime(runtimeRoot);
      const state = await verifyPrivateState(stateRoot);
      const observedAt = now().toISOString();
      const raw = await subprocess(OFFLINE_PYTHON_EXECUTABLE, ['-I', '-S', '-B', BRIDGE, runtime, state, action, operationId, observedAt], { cwd: runtime });
      const view = dto(raw);
      if (action !== 'status') assertActionConfirmed(raw, view, action, operationId);
      return view;
    } catch (error) { if (error instanceof OfflineOperationError) throw error; throw new OfflineOperationError('OFFLINE_RUNTIME_UNAVAILABLE'); }
  }
  return {
    status() { if (statusPromise) return statusPromise; statusPromise = invoke('status').finally(() => { statusPromise = null; }); return statusPromise; },
    async act(input) {
      const { action, operationId } = validateOfflineAction(input);
      if ((action === 'run-once' && activeRun) || activeControls >= 1) throw new OfflineOperationError('OFFLINE_BUSY');
      if (action === 'run-once') activeRun = true; else activeControls++;
      try { return await invoke(action, operationId); } finally { if (action === 'run-once') activeRun = false; else activeControls--; }
    },
  };
}
