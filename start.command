#!/bin/zsh
cd "$(dirname "$0")"
if [[ -x /opt/homebrew/opt/node@24/bin/node ]]; then
  /opt/homebrew/opt/node@24/bin/node scripts/build-public.mjs || exit 1
  exec /opt/homebrew/opt/node@24/bin/node server.mjs
else
  node scripts/build-public.mjs || exit 1
  exec node server.mjs
fi
