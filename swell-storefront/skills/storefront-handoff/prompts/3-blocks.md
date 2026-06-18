# Stage 3 — Blocks

Two parts: (1) run the crop script to produce per-section HTML + screenshots; (2) for each section, identify its blocks and write `blocks.json`.

## Part 1 — Run the crop script

```bash
node <SCRIPTS_DIR>/3-crop-sections.mjs --sprite <SPRITE_PATH>
```

For every unique section type listed in `<SPRITE_PATH>/app/analysis/sections.json`, this writes:

- `<SPRITE_PATH>/app/analysis/sections/<type>.html` — cleaned outerHTML of the section.
- `<SPRITE_PATH>/app/analysis/sections/<type>.light.png` — cropped light-theme screenshot.
- `<SPRITE_PATH>/app/analysis/sections/<type>.dark.png` — cropped dark-theme screenshot (if dark mode is detected).

Verify these files exist before proceeding. Surface any `WARN:` lines.

## Part 2 — Identify blocks per section

For each unique section type, decide which DOM elements inside it are blocks. A block is a self-contained editor unit — the user adds, removes, or reorders blocks individually inside a section.

### Inputs (per section type)

- `<SPRITE_PATH>/app/analysis/sections/<type>.html` — the section's HTML.
- `<SPRITE_PATH>/app/analysis/sections/<type>.light.png` — its cropped screenshot.

### Decomposition algorithm

A block is **only** one of these four kinds:

- **A. Atomic leaf** — a single semantic element (heading, paragraph, button, link with text, image, icon, divider line, or a self-paint element with text content).
- **B. Branded composition** — a wrapper whose children use custom positioning (absolute / transform / overlapping bboxes) that can't be expressed through a regular grid / flex layout.
- **C. Runtime widget** — an element whose semantics require client-side state (panel toggle, tabs, picker, modal, drawer, stateful carousel).
- **D. Data-driven collection or static homogeneous group** — a wrapper whose direct children all share the SAME inner DOM shape and represent either runtime data or a fixed list of identical items. Emitted as ONE block whose selector matches all siblings (multi-instance).

**Anything else is NOT a block.** Wrappers, rows, columns, panels, layout helpers — regardless of their own paint, padding, or visual prominence — are skipped. You recurse through them to find blocks underneath.

Walk the section's DOM. At every node, decide:

```
For each node, in this order:

  1. Does the node match kind A (atomic leaf)?
     A node matches if EITHER:
       - it has no element children and carries text or is a media tag
         (img, picture, svg, video), OR
       - it has only inline-text children and renders as one piece of
         typographic content.
     → Emit BLOCK { type, selector }. Do not recurse.

  2. Does the node match kind B (branded composition)?
     Match if ANY:
       - ≥2 of its direct children have `position: absolute`
       - ≥1 of its direct children has `transform: rotate / translate / scale`
       - ≥2 of its direct children's bboxes overlap
     → Emit BLOCK { type, selector }. Do not recurse.

  3. Does the node match kind C (runtime widget)?
     Match if its function requires client-side state (the element exists
     to be toggled / interacted with at runtime, not just rendered).
     → Emit BLOCK { type, selector }. Do not recurse.

  4. Does the node match kind D (homogeneous group)?
     Match if it has ≥2 direct children, ALL of which share the same
     inner DOM shape (same tag tree, same descendant roles, same role
     within the design). If even one direct child has a different inner
     shape, the group does NOT match — fall through to step 5.
     → Emit ONE BLOCK whose selector matches all of those siblings.
     Do not recurse into each sibling separately; their inner content is
     captured by the multi-instance selector.

  5. None of A / B / C / D matched. The node is a wrapper — recurse into
     its element children and classify each one. The node itself is not
     emitted, regardless of its paint or layout.
```

The output never contains a selector that points to a wrapper holding other blocks. If you find yourself about to emit a block whose inner DOM contains other independent design units, you matched the wrong rule — back up and recurse.

### Block selectors

Block selectors are **section-scoped** — they resolve as descendants of the section root, not the document root. Downstream tooling combines them as `<section_selector> <your_block_selector>` and queries the document, so your selector must describe the path FROM the section root DOWN to the block. Do not start it with anything that's already in the section's own selector — repeating an ancestor class or tag breaks the combined query.

Use stable selectors. Prefer tag + class combo on the block element itself. Use `:nth-child` only when no class is available. Verify by mentally evaluating `<section_selector> <block_selector>` against the section HTML — it must match exactly the intended element(s) and nothing else.

When one selector inside the section naturally matches N sibling elements with the same inner shape, that is N instances of the same block type — write one entry, not N.

### Block names

`type` is snake_case, descriptive of what the user will recognise in the editor — short and specific to the unit's purpose. Reuse the same name across sections for blocks that look identical.

### Output

Write `<SPRITE_PATH>/app/analysis/blocks.json`:

```json
{
  "<section_type>": [
    { "type": "<block_type>", "selector": "<section-scoped CSS>" }
  ]
}
```

Keys are section types from `sections.json`. Order blocks in visual reading order (top to bottom, left to right within a row).

## Self-check

- [ ] Every section type from `sections.json` has an entry in `blocks.json`.
- [ ] Every block selector resolves within its section root.
- [ ] No block selector starts with a class or tag that is already part of its section's own selector (the combined `<section_selector> <block_selector>` query must match).
- [ ] No wrapper with heterogeneous children was emitted as a single block.

## Report

- Sections processed.
- Total block types per section.
- Anything ambiguous.
