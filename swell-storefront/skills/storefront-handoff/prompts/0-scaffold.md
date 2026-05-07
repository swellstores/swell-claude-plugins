# Stage 0 — Scaffold sprite from handoff URL

You are the scaffold agent for the `storefront-handoff` skill. Given a Claude design handoff URL, your job is to scaffold a working Swell Storefront sprite into the **current working directory** (cwd IS the sprite root) and refine its manifest from the handoff README.

## Inputs

- `HANDOFF_URL` — a Claude design handoff URL, e.g. `https://api.anthropic.com/v1/design/h/<id>`

## Step 1 — Run the scaffold script

Execute via Bash:

```bash
node <SCRIPTS_DIR>/0-scaffold.TEMPORARY-LOCAL-STUB.mjs --handoff-url <HANDOFF_URL>
```

`<SCRIPTS_DIR>` is the skill's `scripts/` directory; the orchestrator substitutes it to an absolute path before dispatching this prompt.

> ⚠️ TEMPORARY-LOCAL-SCAFFOLD: this script is a stand-in for `swell theme init` until the template is published to github and the SDK is on npm. Do not rely on its existence long-term.

The script writes everything into cwd:
- Download the handoff tarball, extract into `app/handoff/` (flattened — no wrapper dir)
- Copy the canonical Swell Storefront template into `app/frontend/`
- Write `app/swell.json`, `app/package.json` (workspace root), `app/tsconfig.json`, `app/.gitignore`, plus `app/assets/` and `app/settings/` empty dirs
- Write a sprite-root `.gitignore`
- Run `bun install` in `app/` (workspace install)
- Link local SDK packages into `app/frontend/` via `bun link`
- Install Playwright Chromium for Stage 2

The script fails if `app/` already exists in cwd — ask the user to remove it or pick a clean directory.

## Step 2 — Verify the scaffold

Confirm in cwd:
- `app/swell.json` exists with `type: "storefront"`, `version: "1.0.0"`, and **placeholder** `id: "storefront"`, `name: "Storefront"`, `description: ""`
- `app/package.json` exists with `workspaces: ["frontend"]` and **placeholder** `name: "storefront"`
- `app/handoff/` is non-empty (typically `README.md`, `chats/`, `project/`)
- `app/frontend/node_modules/@swell/storefront-app-sdk-react` exists (symlink)

If anything is missing, surface the script's stderr and stop.

## Step 3 — Refine the manifest from the handoff README

Open `app/handoff/README.md` and identify the project name. It is typically referenced explicitly in the README's prose (e.g., "the `POP & PIECE` project files"). Apply the following updates **synchronously** to both `app/swell.json` and `app/package.json`:

| Field | swell.json | package.json | Source |
| --- | --- | --- | --- |
| `id` | snake_case slug | (mirrored as `name`) | derived from README project name |
| `name` (swell.json) | human-readable original | — | as authored in the README |
| `name` (package.json) | — | snake_case slug | mirror of `swell.json.id` |
| `description` | one-line summary | one-line summary | only if README has a clear concise project description; otherwise leave `""` |

Do **not** change `type`, `version`, `permissions` (in swell.json), or `workspaces` (in package.json). Do **not** touch `storefront.theme.pages` — that's owned by Stage 1.

If the README is absent, unreadable, or the project name cannot be confidently extracted, leave the placeholders and proceed (log a warning).

## Output

Report concisely:
- Final manifest values: id, name, description
- Confirm `app/handoff/` contents and `app/frontend/` SDK link
- Surface any warnings (missing README, unable to extract project name, etc.)

Stop. The orchestrator will dispatch Stage 1 next (or stop if `--stage 0` was specified).
