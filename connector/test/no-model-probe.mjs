// Controlled integration probe: creates only a read-only ephemeral thread, never a model turn.
import { AppServer, executionToolConfig } from '../app-server.mjs';

const app = new AppServer({ codexPath: process.argv[2] || 'codex', cwd: process.cwd() });
let ok = false;
try {
  await app.initialize();
  const local = await app.request('config/read', { includeLayers: false, cwd: process.cwd() });
  let cursor = null; const inventory = [];
  do { const page = await app.request('mcpServerStatus/list', { cursor, limit: 100, detail: 'toolsAndAuthOnly' }); inventory.push(...page.data); cursor = page.nextCursor; } while (cursor);
  const scoped = executionToolConfig(local.config, inventory, []);
  const response = await app.request('thread/start', { cwd: process.cwd(), ephemeral: true, sandbox: 'read-only', approvalPolicy: 'on-request', approvalsReviewer: 'user', config: scoped.config });
  ok = Boolean(response.thread?.id);
} catch (error) { process.stderr.write(`${JSON.stringify({ type: 'probe_error', code: error.rpcCode || 'LOCAL_ERROR' })}\n`); }
finally { const proof = await app.close(); process.stdout.write(`${JSON.stringify({ threadStarted: ok, cleanupConfirmed: proof.terminated })}\n`); if (!ok || !proof.terminated) process.exitCode = 1; }
