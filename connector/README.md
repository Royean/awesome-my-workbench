# Workbench Agent Bridge

A local Node.js connector between Workbench's device API and the official Codex CLI `app-server` stdio protocol. The Mac owns the local Codex login, project paths, skill paths, MCP connections, worktrees, and approval callbacks. Workbench receives registered project IDs/display names, capability names, and redacted task events.

## Local configuration

Requires Node.js 24+, Git, a locally authenticated Codex CLI, and the native Keychain helper bundled with the Mac app. No npm dependencies are needed. Copy `config.example.json` to a local private configuration directory, replace the generic paths, and register committed Git repository roots. The app normally creates this file in its Application Support directory.

```sh
node connector/bridge.mjs --pair --server https://workbench.example.com --code ONE_TIME_PAIRING_CODE --name "My Mac" --config /absolute/path/to/config.json --keychain-helper /absolute/path/to/WorkbenchAgentBridge
node connector/bridge.mjs --config /absolute/path/to/config.json --keychain-helper /absolute/path/to/WorkbenchAgentBridge
```

`--pair` exchanges a short-lived, single-use code and stores the scoped device bearer in macOS Keychain, with `deviceId` as its account. The config contains the device ID, never its bearer. The helper protocol is `credential-store|credential-read|credential-delete` with JSON stdin `{account, token?}` and JSON stdout `{token?}`. `--unpair` removes the local credential; revoke the device in Workbench to invalidate its server access. `--once` claims at most one new run and exits after it finishes, useful for controlled integration checks.

Configuration fields: `serverUrl`, `deviceId` (written by pairing), `projects:[{id,name,path}]`, optional `codexPath`, optional `model`, and optional `stateDir` (defaults to `state` beside the config). `nodePath` may be used by the native launcher; the connector uses the Node process that launched it. HTTPS is required except for a localhost development server. Credentials are never sent to a redirect destination.

Each Git workflow gets a detached worktree below local `state/worktrees/`. The same `workspaceKey` retains the same worktree for subsequent roles, so uncommitted changes pass between workflow steps. Source registrations, config, and state paths are supplied locally; job payloads cannot choose a local directory. Non-Git directories require the explicit local registration option `isolation: "directory"`; this permits direct work in that directory and provides no Git isolation.

## Execution and approvals

The bridge discovers actual local `skills/list` and `mcpServerStatus/list` inventory. A selected skill is resolved by its discovered name and passed as a typed skill input using its local path. MCP availability requires a connected runtime, a known valid authentication status, and no tool discovery error. A read-only ephemeral diagnostic thread connects MCPs without a model turn; selected MCPs are checked again on the actual task thread. Unselected configured MCP servers and their plugin IDs are disabled on the task thread; the selected role definition becomes thread instructions. PM planning receives a read-only sandbox plus the supplied structured plan schema. Execution receives a workspace-write sandbox limited to the isolated directory, with network disabled. The approval policy is `on-request` with the user as reviewer. The bridge never selects full access or automatically approves a request.

Approval callbacks remain pending on the same live app-server connection. The UI receives an opaque callback ID; a decision is mapped back to the original local JSON-RPC ID once. Command/file approvals cover one callback, and permission grants last for the current turn. Oversized details become an explicitly marked preview; review the original request locally before approving. User-input questions accept a response string; multiple questions require a JSON object keyed by question ID. MCP form input requires JSON. Unsupported app-server requests receive a protocol error.

## Delivery and restart behavior

Only one model run executes at a time, enforced by a process lock and the claim loop. The bridge durably journals a returned claim and random attempt ID before starting Codex. It persists the created thread ID and obtains server acknowledgement of the first running event binding that thread and attempt before sending `turn/start`. A lost acknowledgement replays the identical event. A lost claim response may be redelivered only while the server has no bound attempt. Every event has a contiguous per-run sequence. Unacknowledged events persist atomically and retransmit identically after network loss; only an acknowledgement removes them.

A process restart marks unfinished journaled runs unknown and blocks new execution. It never replays a model turn or infers an old process stopped from a missing PID. Finished events replay from the spool. Cancellation waits for a genuine terminal-turn notification plus observed app-server exit and disappearance of its owned process group before reporting cancelled. Cancellation before any model turn uses the setup-failure exception after verified process cleanup. Missing acknowledgement or cleanup evidence leaves the run unknown and blocks the queue. Normal completion also requires verified process cleanup before publishing a result. Revoked device credentials stop new execution and request cancellation of the active run.

Events are bounded before journaling, and batches remain below 200 KiB of UTF-8 JSON. A permanently rejected historical event stays on disk and blocks new execution while heartbeat and cancellation remain available. Oversized plans fail clearly instead of being cut into an invalid partial plan. Successful Git results include up to 30 changed or untracked relative filenames; local directory paths are never artifact URLs.

The journal contains private runtime task instructions and outputs and stays on the Mac with owner-only permissions. Do not distribute local config, Keychain data, state directories, logs, worktrees, or task prompts. This source directory contains generic implementation only. Runtime stdout is limited to concise JSON status messages for the native menu app.

## Tests

```sh
node --test connector/test/*.test.mjs
```

The tests cover durable claims, identical event retries, restart behavior, worktree isolation and stable workflow directories, strict project registration, redaction, approval routing/deduplication, JSON-RPC transport, selected role/skill/MCP binding, and plan validation. They use a fake app-server and temporary projects, without using a model or a production credential.
