import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const EVENT_BYTES = 80000;
export const BATCH_BYTES = 200 * 1024;
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');

// Normalize before journaling so every retry is byte-for-byte identical and fits
// both the backend character bound and the HTTP UTF-8 byte bound.
export function normalizeEventData(kind, original) {
  const data = { ...original };
  for (const key of ['message', 'summary']) if (data[key] !== undefined) data[key] = String(data[key]).slice(0, 12000);
  if (data.code !== undefined) data.code = String(data.code).slice(0, 100);
  if (kind === 'approval') {
    const details = data.details || {};
    if (bytes(details) > 38000) {
      data.details = { method: details.method, truncated: true, notice: 'Approval details are truncated. Review the original request on this Mac before approving.', preview: JSON.stringify(details).slice(0, 12000) };
    }
  }
  if (bytes(data) > EVENT_BYTES) {
    const error = new Error(kind === 'result' && data.plan ? 'Product manager plan exceeds the supported event size. Produce a smaller plan.' : 'Codex output exceeds the supported event size.');
    error.code = 'EVENT_TOO_LARGE'; throw error;
  }
  return data;
}

export function eventBatch(events) {
  const batch = [];
  for (const event of events.slice(0, 30)) {
    const candidate = [...batch, event];
    if (bytes({ events: candidate }) > BATCH_BYTES) break;
    batch.push(event);
  }
  if (!batch.length && events.length) throw new Error('A journaled event exceeds the HTTP delivery budget.');
  return batch;
}

export async function collectArtifacts(cwd) {
  const options = { encoding: 'utf8', timeout: 5000, maxBuffer: 131072 };
  try {
    const results = await Promise.all([
      execFileAsync('git', ['-C', cwd, 'diff', '--name-only', '-z', 'HEAD'], options),
      execFileAsync('git', ['-C', cwd, 'ls-files', '--others', '--exclude-standard', '-z'], options),
    ]);
    return [...new Set(results.flatMap(result => result.stdout.split('\0')).filter(name => name && name.length <= 300 && !path.isAbsolute(name) && !name.startsWith('../') && !/[\u0000-\u001f\u007f]/.test(name)))].sort().slice(0, 30).map(name => ({ name, kind: 'file' }));
  } catch { return []; }
}
