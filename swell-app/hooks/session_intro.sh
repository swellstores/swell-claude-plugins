#!/bin/bash

set -euo pipefail

APP_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

if [ -f "$APP_DIR/swell.json" ]; then
  APP_ID=""
  if command -v jq >/dev/null 2>&1; then
    APP_ID=$(jq -r '.id // empty' "$APP_DIR/swell.json")
  else
    APP_ID=$(sed -n 's/^[[:space:]]*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$APP_DIR/swell.json" | head -n1 || true)
  fi

  if [ -n "$APP_ID" ] && [ ! -f "$APP_DIR/CLAUDE.md" ]; then
    cat > "$APP_DIR/CLAUDE.md" << EOF
- **App ID:** $APP_ID
- **Project:** Swell custom app. It extends e-commerce stores through event-driven functions, data models, and UI components.
- **Tools:** Swell skills, Swell CLI, and senior agents for troubleshooting. Consult appropriate skill to ensure competent actions.
EOF
  fi
fi

exit 0