import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, mkdir, writeFile, chmod, mkdtemp, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const PRODUCER_COMMIT = 'c17248ce097c3ed03e1e262be972023f48e63636';
const manifestPath = fileURLToPath(new URL('../contracts/money-maker-runtime-v1.json', import.meta.url));
const read = async (path) => { const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { const s = await f.stat(); if (!s.isFile() || s.nlink !== 1 || s.size > 4_000_000) throw new Error('Invalid runtime file'); return await f.readFile(); } finally { await f.close(); } };
const manifest = JSON.parse((await read(manifestPath)).toString('utf8'));
if (manifest.schemaVersion !== 'dashboard-money-maker-runtime.v1' || manifest.producerCommit !== PRODUCER_COMMIT) throw new Error('Invalid pinned runtime manifest');
export const RUNTIME_MANIFEST = Object.freeze(manifest);
export const DEFAULT_RUNTIME_ROOT = join(homedir(), '.local', 'share', 'etoro-dashboard', 'money-maker', PRODUCER_COMMIT);
export const DEFAULT_SIMULATION_ROOT = join(homedir(), '.local', 'share', 'etoro-dashboard', 'offline-diagnostics');
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

export async function assertOutsideRepositories(path) {
  const absolute = resolve(path);
  const parts = absolute.split('/').filter(Boolean);
  let current = '/';
  for (const part of parts) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error('Private paths cannot contain symbolic links');
      try { await lstat(join(current, '.git')); throw new Error('Private runtime/state cannot be inside a repository'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (absolute === resolve(repositoryRoot) || absolute.startsWith(`${resolve(repositoryRoot)}/`)) throw new Error('Private path is inside Dashboard');
  return absolute;
}

async function inventory(root, relative = '') {
  const result = [];
  for (const item of await readdir(join(root, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${item.name}` : item.name;
    const info = await lstat(join(root, name));
    if (info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o277)) throw new Error('Runtime must be immutable and owner-controlled');
    if (info.isDirectory()) result.push(...await inventory(root, name));
    else if (info.isFile() && info.nlink === 1) result.push(name);
    else throw new Error('Invalid runtime inventory');
  }
  return result.sort();
}

export async function verifyRuntime(runtimeRoot = DEFAULT_RUNTIME_ROOT) {
  const root = await assertOutsideRepositories(runtimeRoot);
  const info = await lstat(root);
  if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o277)) throw new Error('Runtime root permissions are invalid');
  const actual = await inventory(root);
  const expected = Object.keys(manifest.files).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Runtime inventory drift');
  for (const path of expected) {
    if (createHash('sha256').update(await read(join(root, path))).digest('hex') !== manifest.files[path]) throw new Error('Runtime content drift');
  }
  return root;
}

export async function installRuntime({ producerCheckout, runtimeRoot = DEFAULT_RUNTIME_ROOT }) {
  const run = promisify(execFile);
  const root = await assertOutsideRepositories(runtimeRoot);
  const { stdout: commit } = await run('/usr/bin/git', ['-C', producerCheckout, 'rev-parse', `${PRODUCER_COMMIT}^{commit}`], { env: { PATH: '/usr/bin:/bin' }, maxBuffer: 1024 });
  if (commit.trim() !== PRODUCER_COMMIT) throw new Error('Pinned producer commit is unavailable');
  try { await lstat(root); return await verifyRuntime(root); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(dirname(root), { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(dirname(root), '.runtime-'));
  async function seal(directory) { for (const item of await readdir(directory, { withFileTypes: true })) if (item.isDirectory()) await seal(join(directory, item.name)); await chmod(directory, 0o500); }
  async function unseal(directory) { await chmod(directory, 0o700); for (const item of await readdir(directory, { withFileTypes: true })) if (item.isDirectory()) await unseal(join(directory, item.name)); }
  try {
    for (const [path, digest] of Object.entries(manifest.files)) {
      const { stdout } = await run('/usr/bin/git', ['-C', producerCheckout, 'show', `${PRODUCER_COMMIT}:${path}`], { encoding: 'buffer', env: { PATH: '/usr/bin:/bin' }, maxBuffer: 4_000_000 });
      if (createHash('sha256').update(stdout).digest('hex') !== digest) throw new Error('Pinned producer artifact mismatch');
      await mkdir(dirname(join(staging, path)), { recursive: true, mode: 0o700 });
      await writeFile(join(staging, path), stdout, { flag: 'wx', mode: 0o400 });
    }
    await seal(staging);
    await verifyRuntime(staging);
    await rename(staging, root);
  } catch (error) {
    await unseal(staging).catch(() => {});
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return verifyRuntime(root);
}
