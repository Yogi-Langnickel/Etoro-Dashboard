"""Fixed, credential-free consumer bridge. No producer source is modified."""
import contextlib
import fcntl
import io
import hashlib
import tempfile
import json
import os
from pathlib import Path
import re
import stat
import sys
from datetime import datetime, timezone


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate field')
        result[key] = value
    return result


def strict(raw):
    return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite value')))


def private_file(path, missing=False):
    try:
        info = path.lstat()
    except FileNotFoundError:
        if missing:
            return
        raise
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_size > 16_000_000:
        raise ValueError('Unsafe private file')


def validate_journal(value):
    if not isinstance(value, dict) or set(value) != {'version', 'operations'} or value['version'] != 1 or isinstance(value['version'], bool) or not isinstance(value['operations'], list) or len(value['operations']) > 256:
        raise ValueError('Invalid operation journal')
    identities = set()
    for item in value['operations']:
        if not isinstance(item, dict) or set(item) != {'id', 'action', 'startedAt', 'status', 'result'} or not isinstance(item['id'], str) or not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', item['id']) or item['id'] in identities or item['action'] not in {'run-once', 'block', 'reenable'} or item['status'] not in {'pending', 'completed', 'already-completed', 'preflight-blocked', 'lease-blocked', 'completion-blocked'}:
            raise ValueError('Invalid operation journal item')
        identities.add(item['id'])
        if not isinstance(item['startedAt'], str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z', item['startedAt']):
            raise ValueError('Invalid original start time')
        datetime.fromisoformat(item['startedAt'].replace('Z', '+00:00'))
        result = item['result']
        if item['status'] == 'pending':
            if result is not None:
                raise ValueError('Invalid pending result')
        elif item['action'] != 'run-once':
            if result != {'status': 'completed'} or item['status'] != 'completed':
                raise ValueError('Invalid control result')
        else:
            fields = {'dtoVersion', 'status', 'mode', 'manifest', 'preflight', 'lease', 'diagnostics', 'ledger', 'providerCalls', 'credentials', 'accountData', 'executionRoutes', 'demoExecution', 'liveExecution'}
            if not isinstance(result, dict) or set(result) != fields or result['dtoVersion'] != 'deterministic-offline-simulation-runner.v1' or result['status'] != item['status'] or result['mode'] != 'offline-simulation-only' or result['manifest'] != {'schemaVersion': 'deterministic-offline-simulation-runner.v1', 'manifestId': 'approved-slow-trend-fixture-diagnostics'} or any(result[key] != expected for key, expected in {'providerCalls': 'blocked', 'credentials': 'absent', 'accountData': 'absent', 'executionRoutes': 'absent', 'demoExecution': 'blocked', 'liveExecution': 'blocked'}.items()):
                raise ValueError('Invalid retained producer result')
            preflight = result['preflight']
            fixture_fields = {'structurallyValid', 'strategyHistoryState', 'walkForwardState', 'samplingState'}
            if not isinstance(preflight, dict) or set(preflight) != {'structurallyValid', 'strategyAnalysisSufficient', 'contractManifest', 'fixtureProvenance', 'fixture'} or type(preflight['structurallyValid']) is not bool or type(preflight['strategyAnalysisSufficient']) is not bool or preflight['contractManifest'] not in {'pinned-and-current', 'drifted-or-invalid'} or preflight['fixtureProvenance'] not in {'pinned-and-current', 'drifted-or-invalid'} or not isinstance(preflight['fixture'], dict) or set(preflight['fixture']) != fixture_fields or type(preflight['fixture']['structurallyValid']) is not bool:
                raise ValueError('Invalid retained preflight')
            states = {None, 'insufficient-history', 'invalid-history', 'trend-confirmed', 'trend-not-confirmed', 'available', 'not-applicable', 'weekday-grid-covered', 'mixed-irregular-sampling', 'potential-weekday-gaps', 'non-weekday-observations'}
            if any(preflight['fixture'][key] not in states for key in ['strategyHistoryState', 'walkForwardState', 'samplingState']):
                raise ValueError('Invalid retained fixture state')
            if not isinstance(result['lease'], dict) or set(result['lease']) != {'status', 'identity'} or result['lease']['identity'] != 'redacted' or result['lease']['status'] not in {'not-attempted', 'acquired', 'held', 'already-completed', 'completed', 'initialized-and-completed', 'kill-switch-blocked', 'completion-capacity-exhausted', 'lease-active', 'busy', 'not-held', 'stale-or-unauthorized', 'expired', 'identity-mismatch', 'fence-mismatch', 'epoch-mismatch', 'lease-missing', 'completion-capacity-exhausted'}:
                raise ValueError('Invalid retained lease result')
            if not isinstance(result['ledger'], dict) or set(result['ledger']) != {'status', 'content'} or result['ledger']['content'] != 'redacted' or result['ledger']['status'] not in {'not-attempted', 'appended', 'already-appended', 'confirmed-existing'}:
                raise ValueError('Invalid retained ledger result')
            diagnostic = result['diagnostics']
            if diagnostic != {'status': 'not-run'}:
                if not isinstance(diagnostic, dict) or set(diagnostic) != {'status', 'fixtureRows', 'strategyHistoryState', 'walkForwardState', 'samplingState', 'eventCount', 'blockedEventCount', 'performanceClaims'} or diagnostic['status'] != 'completed' or diagnostic['performanceClaims'] != 'diagnostics-only-no-pnl-or-profitability-claim' or any(type(diagnostic[key]) is not int or not 0 <= diagnostic[key] <= 10000 for key in ['fixtureRows', 'eventCount', 'blockedEventCount']) or diagnostic['blockedEventCount'] > diagnostic['eventCount']:
                    raise ValueError('Invalid retained diagnostic')
                if any(diagnostic[key] not in states for key in ['strategyHistoryState', 'walkForwardState', 'samplingState']):
                    raise ValueError('Invalid retained diagnostic states')


def write_journal(path, value):
    validate_journal(value)
    fd, temporary_name = tempfile.mkstemp(prefix='.operations-', suffix='.tmp', dir=path.parent)
    temporary = Path(temporary_name)
    try:
        payload = (json.dumps(value, allow_nan=False, sort_keys=True) + '\n').encode()
        with os.fdopen(fd, 'wb') as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def journal_update(root, update):
    path = root / 'operations.json'
    lock_path = root / '.operations.lock'
    creating = not path.exists()
    if creating and any(root.iterdir()):
        raise ValueError('Established operation journal is missing')
    private_file(lock_path, missing=creating)
    flags = os.O_RDWR | os.O_NOFOLLOW
    if creating:
        flags |= os.O_CREAT | os.O_EXCL
    fd = os.open(lock_path, flags, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError('Unsafe operation lock')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        private_file(path, missing=creating)
        value = {'version': 1, 'operations': []} if creating else strict(path.read_text())
        validate_journal(value)
        result, changed = update(value)
        if changed or creating:
            write_journal(path, value)
        return result
    finally:
        os.close(fd)


def main():
    os.umask(0o077)
    if len(sys.argv) != 6:
        raise ValueError('Invalid fixed bridge arguments')
    runtime, state, action, identity, observed = sys.argv[1:]
    root = Path(state)
    instant = datetime.fromisoformat(observed.replace('Z', '+00:00'))
    if instant.tzinfo is None or action not in {'status', 'run-once', 'block', 'reenable'}:
        raise ValueError('Invalid operation')
    if action != 'status' and not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', identity):
        raise ValueError('Invalid operation identity')
    # Reverify pinned imports in the child before loading any producer code.
    runtime_root = Path(runtime)
    manifest = strict((Path(__file__).resolve().parents[1] / 'contracts' / 'money-maker-runtime-v1.json').read_text())
    actual = []
    for path in [runtime_root, *runtime_root.rglob('*')]:
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o277:
            raise ValueError('Unsafe immutable runtime')
        if stat.S_ISREG(info.st_mode):
            relative = path.relative_to(runtime_root).as_posix()
            if info.st_nlink != 1 or relative not in manifest['files'] or hashlib.sha256(path.read_bytes()).hexdigest() != manifest['files'][relative]:
                raise ValueError('Runtime drift')
            actual.append(relative)
        elif not stat.S_ISDIR(info.st_mode):
            raise ValueError('Invalid runtime entry')
    if set(actual) != set(manifest['files']):
        raise ValueError('Incomplete runtime')
    if not root.is_dir() or root.is_symlink() or root.stat().st_uid != os.getuid() or root.stat().st_mode & 0o077:
        raise ValueError('Unsafe state root')
    for path in root.iterdir():
        if path.name not in {'lease.json', '.lease.json.lock', 'ledger.jsonl', '.ledger.jsonl.lock', 'operations.json', '.operations.lock'}:
            raise ValueError('Unexpected private state file')
        private_file(path)
    # Establish identity metadata only in a completely pristine private root.
    # A retained lock, lease or ledger without its journal is never a new start.
    journal_update(root, lambda value: (None, False))
    # -I -S prevents ambient PYTHONPATH and site hooks. Add only pinned source.
    sys.path.insert(0, str(Path(runtime) / 'src'))
    from money_maker_3000.cli import main as producer_main
    from money_maker_3000.worker_leases import WorkerLeaseStore
    state_path = root / 'lease.json'
    ledger_path = root / 'ledger.jsonl'

    def guard(value):
        items = value['operations']
        completed = any(item['status'] in {'completed', 'already-completed'} for item in items)
        completed_run = any(item['action'] == 'run-once' and item['status'] in {'completed', 'already-completed'} for item in items)
        state_exists = state_path.exists()
        lease_lock_exists = state_path.with_name('.lease.json.lock').exists()
        ledger_exists = ledger_path.exists()
        if (not items and (state_exists or lease_lock_exists or ledger_exists)) or state_exists != lease_lock_exists:
            raise ValueError('Operation journal and producer state disagree')
        if ((completed or ledger_exists) and not state_exists) or (completed_run and not ledger_exists):
            raise ValueError('Completed operational state is missing')
        return None, False
    journal_update(root, guard)

    def invoke(args):
        output, errors = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            code = producer_main(args)
        if code not in (0, 1) or not output.getvalue():
            raise ValueError('Producer command unavailable')
        return strict(output.getvalue())

    def status():
        nonlocal observed
        journal_update(root, guard)
        observed = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        ops = invoke(['operations-status', '--state-path', str(state_path), '--ledger-path', str(ledger_path), '--observed-at', observed])
        lease = invoke(['lease-report', str(state_path), '--observed-at', observed])
        ledger = invoke(['ledger-report', str(ledger_path)]) if ledger_path.exists() else {
            'dtoVersion': 'simulation-ledger-report.v2', 'providerCalls': 'blocked', 'executionRoutes': 'absent',
            'integrity': {'state': 'missing', 'complete': False}, 'summary': {'recordCount': 0, 'lastRecordedAt': None, 'vetoHistogram': {}}
        }
        def read(value):
            items = value['operations']
            runs = [item for item in items if item['action'] == 'run-once' and item.get('result')]
            return {'operation': items[-1] if items else None, 'lastResult': runs[-1] if runs else None}, False
        journal = journal_update(root, read)
        return {'observedAt': observed, 'operations': ops, 'lease': lease, 'ledger': ledger, 'journal': journal}

    if action == 'status':
        return status()

    def begin(value):
        found = next((item for item in value['operations'] if item['id'] == identity), None)
        if found:
            if found['action'] != action:
                raise ValueError('Operation identity reused for different action')
            return found.copy(), False
        if action == 'run-once' and any(item['startedAt'] == observed and item['action'] == 'run-once' for item in value['operations']):
            raise ValueError('Diagnostic start-time collision; retry with the same identity')
        if len(value['operations']) >= 256:
            raise ValueError('Operation capacity exhausted')
        item = {'id': identity, 'action': action, 'startedAt': observed, 'status': 'pending', 'result': None}
        value['operations'].append(item)
        return item.copy(), True
    operation = journal_update(root, begin)
    journal_update(root, guard)
    if action == 'run-once':
        result = invoke(['run-once', '--manifest', str(Path(runtime) / 'contracts' / 'offline-simulation-runner-v1.json'), '--state-path', str(state_path), '--ledger-path', str(ledger_path), '--holder', 'etoro-dashboard-isolated-diagnostic', '--idempotency-key', identity, '--started-at', operation['startedAt']])
    elif operation['status'] != 'completed':
        store = WorkerLeaseStore(state_path)
        store.initialize()
        result = store.engage_kill_switch(reason='operator-stop') if action == 'block' else store.reenable()
        # Do not retain opaque lease identifiers from mutation responses.
        result = {'status': 'completed'}
    else:
        result = operation['result']
    def finish(value):
        item = next(item for item in value['operations'] if item['id'] == identity)
        item['status'] = result['status']
        item['result'] = result
        return item.copy(), True
    operation = journal_update(root, finish)
    # Readback occurs after the producer action; Node checks authoritative fences.
    return {**status(), 'action': {'type': action, 'status': operation['status']}, 'operationResult': operation}


if __name__ == '__main__':
    try:
        print(json.dumps(main(), allow_nan=False, sort_keys=True))
    except Exception:
        print(json.dumps({'error': 'OFFLINE_OPERATION_UNAVAILABLE'}))
        raise SystemExit(1)
