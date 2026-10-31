#!/bin/zsh
cd "$(dirname "$0")"
if [[ -x /opt/homebrew/opt/node@24/bin/node ]]; then
  exec /opt/homebrew/opt/node@24/bin/node server.mjs
else
  exec node server.mjs
fi
