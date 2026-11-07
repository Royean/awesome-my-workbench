import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const VERSION = '1.0.0';
export function atomicJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  const dir = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}

export function readConfig(file, overrides = {}) {
  const config = { ...JSON.parse(fs.readFileSync(file, 'utf8')), ...overrides };
  const url = new URL(config.serverUrl);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Server URL requires HTTPS (localhost HTTP is allowed).');
  config.serverUrl = url.href.replace(/\/$/, '');
  config.stateDir = path.resolve(config.stateDir || path.join(path.dirname(path.resolve(file)), 'state'));
  fs.mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
  config.stateDir = fs.realpathSync(config.stateDir);
  if (!Array.isArray(config.projects) || config.projects.length > 50) throw new Error('Projects must be a local allowlist.');
  const ids = new Set();
  config.projects = config.projects.map(project => {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(project.id) || ids.has(project.id) || typeof project.name !== 'string' || !project.name.trim() || project.name.length > 100 || /[/\\]/.test(project.name) || !path.isAbsolute(project.path)) throw new Error('Invalid local project registration.');
    ids.add(project.id);
    const root = fs.realpathSync(project.path);
    if (!fs.statSync(root).isDirectory()) throw new Error('Registered project must be a directory.');
    return { ...project, path: root };
  });
  return config;
}

export class Journal {
  constructor(dir) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.dir = fs.realpathSync(dir); this.file = path.join(this.dir, 'journal.json');
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { version: 1, runs: {} };
    if (this.data.version !== 1 || !this.data.runs || typeof this.data.runs !== 'object') throw new Error('Unsupported or damaged connector journal.');
  }
  save() { atomicJSON(this.file, this.data); }
  claim(job) {
    if (this.data.runs[job.runId]) return null;
    const run = { job, attemptId: randomUUID(), phase: 'claimed', nextSeq: 1, ackSeq: 0, events: [], pending: {}, createdAt: new Date().toISOString() };
    this.data.runs[job.runId] = run; this.save(); return run;
  }
  event(run, kind, data) {
    const event = { seq: run.nextSeq++, kind, data };
    run.events.push(event); this.save(); return event;
  }
  acknowledge(run, ackSeq) {
    if (!Number.isSafeInteger(ackSeq) || ackSeq < run.ackSeq || ackSeq >= run.nextSeq) throw new Error('Invalid event acknowledgement.');
    run.ackSeq = ackSeq; run.events = run.events.filter(event => event.seq > ackSeq); this.save();
  }
  lock() {
    const file = path.join(this.dir, 'bridge.lock');
    try {
      this.lockFd = fs.openSync(file, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      try { process.kill(existing.pid, 0); throw new Error('Connector is already running.'); }
      catch (check) { if (check.code !== 'ESRCH') throw check; }
      fs.unlinkSync(file); this.lockFd = fs.openSync(file, 'wx', 0o600);
    }
    fs.writeFileSync(this.lockFd, JSON.stringify({ pid: process.pid }));
    return () => { try { fs.closeSync(this.lockFd); fs.unlinkSync(file); } catch {} };
  }
}

export class CredentialStore {
  constructor({ helper, testSecretFile }) {
    if (testSecretFile && process.env.NODE_ENV !== 'test') throw new Error('File credentials are only supported in tests.');
    if (!helper && !testSecretFile) throw new Error('A native Keychain helper is required.');
    this.helper = helper; this.testSecretFile = testSecretFile;
  }
  command(command, account, token) {
    if (this.testSecretFile) {
      let values = fs.existsSync(this.testSecretFile) ? JSON.parse(fs.readFileSync(this.testSecretFile, 'utf8')) : {};
      if (command === 'credential-store') { values[account] = token; atomicJSON(this.testSecretFile, values); }
      if (command === 'credential-delete') { delete values[account]; atomicJSON(this.testSecretFile, values); }
      return { token: values[account] };
    }
    try { return JSON.parse(execFileSync(this.helper, [command], { input: JSON.stringify({ account, ...(token ? { token } : {}) }), encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'ignore'] }) || '{}'); }
    catch { throw new Error('Keychain operation failed.'); }
  }
  read(account) { return this.command('credential-read', account).token; }
  store(account, token) { this.command('credential-store', account, token); }
  delete(account) { this.command('credential-delete', account); }
}

export function credentialAccount(config) { return config.deviceId; }

// Only registered project IDs can choose a directory. No server-supplied path is used.
export function workspaceFor(config, job) {
  const project = config.projects.find(item => item.id === job.projectId);
  if (!project) throw new Error('Task project is not registered on this Mac.');
  const root = fs.realpathSync(project.path);
  if (root !== project.path) throw new Error('Registered project path changed.');
  if (project.isolation === 'directory') return root; // Explicit local opt-in for non-Git projects.
  fs.mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
  const stateRoot = fs.realpathSync(config.stateDir);
  const key = createHash('sha256').update(`${project.id}\0${job.workspaceKey || job.runId}`).digest('hex').slice(0, 24);
  const destination = path.join(stateRoot, 'worktrees', project.id, key);
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    const top = fs.realpathSync(git(['rev-parse', '--show-toplevel']));
    if (top !== root) throw new Error('Register the Git repository root.');
    if (!fs.existsSync(destination)) {
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      if (fs.realpathSync(path.dirname(destination)) !== path.dirname(destination)) throw new Error('Worktree parent contains a symlink.');
      git(['worktree', 'add', '--detach', destination, 'HEAD']);
    }
    const entries = git(['worktree', 'list', '--porcelain']).split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice(9));
    if (!entries.includes(destination) || fs.realpathSync(destination) !== destination) throw new Error('Isolated worktree could not be verified.');
    return destination;
  } catch (error) { throw new Error(error.message === 'Register the Git repository root.' ? error.message : 'Cannot prepare isolated Git worktree. Register a Git repository with a commit.'); }
}

export function redact(value, paths = [], secrets = []) {
  const clean = text => {
    let result = text;
    for (const secret of secrets.filter(Boolean)) result = result.split(secret).join('[credential]');
    for (const local of [...paths].filter(Boolean).sort((a, b) => b.length - a.length)) result = result.split(local).join('[local project]');
    result = result.replace(/\/(?:Users|home|private|var|tmp|Volumes|opt|Applications|Library|System)\/[^\s"'`<>\]\[{}(),;]+/g, '[local path]');
    return result.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  };
  if (typeof value === 'string') return clean(value);
  if (Array.isArray(value)) return value.map(item => redact(item, paths, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [clean(key), redact(item, paths, secrets)]));
  return value;
}

export class API {
  constructor(config, token, fetcher = fetch) { this.config = config; this.token = token; this.fetcher = fetcher; }
  async post(route, body, authenticated = true) {
    const response = await this.fetcher(`${this.config.serverUrl}/api/agent-execution/${route}`, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: `Bearer ${this.token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    if (!response.ok) { const error = new Error(`Workbench API returned ${response.status}.`); error.status = response.status; throw error; }
    return response.json();
  }
}

export function defaultConfigFile() { return path.join(os.homedir(), 'Library', 'Application Support', 'Workbench Agent Bridge', 'config.json'); }
