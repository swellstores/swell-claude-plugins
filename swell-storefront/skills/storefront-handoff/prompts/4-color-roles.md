# Stage 4 — Color schemes

Three parts:

1. Run the prep script to crop per-block previews.
2. Tag blocks as primary buttons / secondary buttons / branded, and identify the cart section.
3. Run the derive script.

## Part 1 — Run the prep script

```bash
node <SCRIPTS_DIR>/4-crop-blocks.mjs --sprite <SPRITE_PATH>
```

For every unique block type in `<SPRITE_PATH>/app/analysis/blocks.json`, this writes:

- `<SPRITE_PATH>/app/analysis/blocks/<block_type>.light.png`
- `<SPRITE_PATH>/app/analysis/blocks/<block_type>.dark.png` (if dark mode is detected)

Verify these files exist before proceeding. Surface any `WARN:` lines.

## Part 2 — Tag blocks

### Inputs

- `<SPRITE_PATH>/app/analysis/blocks.json` — every block type with its host section.
- `<SPRITE_PATH>/app/analysis/sections.json` — section list.
- `<SPRITE_PATH>/app/analysis/blocks/<block_type>.light.png` — per-block crop (and `.dark.png` if present).
- `<SPRITE_PATH>/app/analysis/sections/<section_type>.light.png` — section context, in case a block needs surrounding context to disambiguate.

### Buckets

For every block type, decide whether it falls into ONE of three buckets. Default is no bucket (omit).

- **Primary button** — the prominent click target on its surface. Filled background, rounded shape, short text, strong contrast. Multiple block types belong here only if they share the SAME paint treatment across the design.

- **Secondary button** — the less prominent action. Outlined, ghost, text-link, or softer filled treatment. Sits next to a primary or appears alone on a surface where the primary is absent.

- **Branded** — a composition whose color treatment is fully bespoke and must NEVER be themed. Mark only when the entire palette of the block is part of a custom illustration / pattern that doesn't belong to the theme system. If even part of the block uses recurring paints (the same shadow as elsewhere, the same border as elsewhere), it is NOT branded.

Anything that doesn't fit any bucket → omit. Default is omit.

### Decision algorithm

For every block type listed in `blocks.json`:

```
1. Open the block's light crop.
2. First match wins:
   a. Composition with a fully bespoke palette unrelated to the rest of the
      design → branded.
   b. Filled, rounded, prominent click target → primary_button.
   c. Outlined / ghost / text-link button-like element → secondary_button.
   d. Otherwise → omit.
3. If a block type appears in multiple sections with different roles, pick the
   most common one. Tie-break toward the conservative choice (secondary over
   primary; unmarked over branded).
```

### Cart section

Identify the section type from `sections.json` whose surface represents the cart drawer / panel — the surface that opens when a user adds something to the cart. If the prototype has no such surface, set to `null`.

### Output

Write `<SPRITE_PATH>/app/analysis/color-roles.json`:

```json
{
  "primary_button_blocks": ["<block_type>", ...],
  "secondary_button_blocks": ["<block_type>", ...],
  "branded_blocks": ["<block_type>", ...],
  "cart_section": "<section_type>" | null
}
```

Names match exactly what's in `blocks.json` / `sections.json`. Order doesn't matter. Empty arrays are allowed.

## Part 3 — Run the derive script

```bash
node <SCRIPTS_DIR>/4-derive-colors.mjs --sprite <SPRITE_PATH>
```

Surface any `WARN:` lines.

## Self-check

- [ ] Every block-type entry exists in `blocks.json`.
- [ ] No block type appears in more than one of the three arrays.
- [ ] All entries in `primary_button_blocks` share the same paint treatment.
- [ ] `cart_section` either matches a section type in `sections.json` or is `null`.
- [ ] After Part 3: `app/frontend/src/settings/schema.json`, `app/frontend/theme/settings/settings.json`, `app/frontend/src/index.css` (with `COLOR_SCHEMES_START` block), and `app/frontend/tailwind.config.js` (with cross-cutting role mappings) all exist.

## Report

- Counts: primary / secondary / branded.
- Cart section (or "none").
- Any borderline calls and how you resolved them.
