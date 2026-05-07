---
name: storefront-handoff
description: Convert a Claude design handoff into a working Swell Storefront App. Trigger when the user provides a Claude design handoff URL (typically https://api.anthropic.com/v1/design/h/<id>) and asks to generate, build, or scaffold a Swell Storefront from it. Also matches natural-language requests like "create a storefront from this handoff", "convert this design to Swell", or "build storefront app from <url>".
allowed-tools: Read, Write, Edit, Bash, Task, Glob, Grep
---

# storefront-handoff

Thin dispatcher for the Claude design handoff → Swell Storefront pipeline. The skill itself knows nothing about sprite layout, scripts, or stage internals — each stage prompt is self-contained.

The sprite is **the user's current working directory**. Stage 0 scaffolds into cwd; subsequent stages run on cwd.

## Inputs

| Form | Behavior |
| --- | --- |
| `<handoff-url>` | Full pipeline (Stage 0 → last implemented stage). Cwd must be empty (no existing `app/`). |
| `<handoff-url> --stage 0` | Stage 0 only |
| `--stage N` (N ≥ 1) | Stage N only. No URL needed — operates on cwd. |

Slash invocation: `/storefront-handoff <input>`. Natural-language invocation works too — extract URL/stage from the user's message.

## Pipeline

**Default pipeline** (runs when invoked with `<handoff-url>` and no `--stage`):

| Stage | Prompt |
| --- | --- |
| 0 | `prompts/0-scaffold.md` |
| 1 | `prompts/1-pages.md` |
| 2 | `prompts/2-sections.md` |
| 3 | `prompts/3-section-trees.md` |
| 4 | `prompts/4-color-roles.md` |
| 5 | `prompts/5-blocks-jsx.md` |

Stages 6+ are pending.

## Dispatch

For each stage in scope:

1. Read `prompts/<stage>-<topic>.md` from this skill's directory.
2. Substitute variables in the prompt:
   - `<SCRIPTS_DIR>` — absolute path to this skill's `scripts/` directory (resolve relative to the skill's location, i.e. the directory containing this SKILL.md → `<that-dir>/scripts`)
   - Stage 0: `<HANDOFF_URL>` (from user input)
   - Stage 1+: `<SPRITE_PATH>` — the user's current working directory; verify `<cwd>/app/swell.json` exists before dispatching
3. Spawn a sub-agent (Agent tool):
   - `subagent_type: "general-purpose"`
   - `model: "sonnet"`
   - `prompt`: the filled prompt
4. After the agent returns, verify it reported successful completion. If it failed or warned, decide whether to abort or continue.
5. Proceed to the next stage (or stop if `--stage` was specified).

Scripts are bundled inside the skill, so `<SCRIPTS_DIR>` works the same whether the skill is loaded from a local marketplace clone or a `/plugin install`-ed plugin under `~/.claude/plugins/...`.
