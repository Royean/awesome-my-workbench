# Private cloud adaptation

Runtime: Vinext on Cloudflare Workers, D1 (`DB`), R2 (`BUCKET`). Sites owns sign-in.

- Every API request requires a visitor from `getChatGPTUser()`. A Sites service bypass token alone supplies no visitor and cannot access records.
- D1 records, preferences, deletion tombstones, and demo initialization are scoped to the stable Site `userId`; record operations also scope `space`.
- R2 objects use `users/<encoded userId>/<space>/<UUID.ext>` and can be read only through a scoped file record.
- The personal space starts empty. Demo seeds are fictional and initialized atomically once for each user. No local database, uploads, medical records, or credentials are copied.
- `node scripts/sync-domain.mjs` regenerates `app/health-domain.mjs` from the sibling local server. Run after domain validation/demo changes. This does not read its database or uploads.
- Drizzle schema and migrations are committed. Apply migrations through the Sites build/publication workflow; never create schema inside handlers.
- Attachment bytes are held in R2, records in D1. Upload failures remove newly staged objects. File deletions retain bytes to support the 12-second undo contract; data export contains records and attachment metadata, as in the local application.
- Browser localStorage contains only the space selection preference. Records come from authenticated API reads.

Check with `node node_modules/typescript/bin/tsc --noEmit` and regenerate schema with `node node_modules/drizzle-kit/bin.cjs generate`. On this machine use `/opt/homebrew/opt/node@24/bin/node` if npm resolves the broken system Node 25 executable.

Drizzle Kit 0.31.10 incorrectly comma-splits SQLite expression-index terms when generating `dose_schedule_unique`. Migration `0001` was corrected while identified as failed/unapplied, then successfully applied locally; its SQL uses native `json_extract` terms. Preserve its corrected SQL and review future generated index changes.
