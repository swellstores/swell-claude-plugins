# Stage 2 — Sections

Two parts: (1) run the snapshot script to render the prototype and dump HTML + screenshots; (2) identify sections from those outputs and write `sections.json`.

## Part 1 — Run the snapshot script

```bash
node <SCRIPTS_DIR>/2-snapshot.mjs --sprite <SPRITE_PATH>
```

This renders every page declared in `app/swell.json.storefront.theme.pages` at lg (1280×900) and dumps:

- `<SPRITE_PATH>/app/analysis/meta.json`
- `<SPRITE_PATH>/app/analysis/pages/<id>.html` — cleaned full-page HTML.
- `<SPRITE_PATH>/app/analysis/screenshots/<id>.light.png` (and `.dark.png` if a dark-mode toggle is detected).

Verify these files exist before proceeding. Surface any `WARN:` lines from the script.

## Part 2 — Identify sections

For every page, identify the sections — visually distinct horizontal regions, each with its own identity. Do NOT decompose into blocks; that's the next stage.

### Inputs (per page)

- `<SPRITE_PATH>/app/analysis/pages/<id>.html` — cleaned full-page HTML.
- `<SPRITE_PATH>/app/analysis/screenshots/<id>.light.png` — full-page screenshot.
- `<SPRITE_PATH>/app/analysis/meta.json` — page list.

### What counts as a section

A section is a top-level horizontal region with its own visual identity. Any one of these signals is enough on its own:

- An HTML5 landmark element: `<header>`, `<footer>`, `<main>`, `<nav>`, `<section>`, `<article>`.
- An element with its own paint (background-color, background-image, distinct top/bottom border, or strong drop shadow that separates it from neighbours) AND full-width footprint.
- A clear visual break (separator line, change in background, change in vertical rhythm) from the region above and below.

Sections do not nest. If a wrapper element groups several visually distinct regions (e.g. one `<div>` contains a promo strip + a navigation strip with different backgrounds), each visual region is its own section — don't roll them up to the wrapper.

### Naming

`type` is snake_case. Pick a name that describes what the user will recognise in the editor — short and specific to the section's purpose. Use the design's vocabulary, not generic tokens like `section_1`.

The same section reused across pages keeps the same name (so it can be recognised as a single layout section).

### Header / footer detection

After identifying sections on every page, find sections that appear on **all** pages with the same selector and the same inner DOM. List their `type`s under `header_sections` (top-of-every-page) or `footer_sections` (bottom-of-every-page). A page's header may consist of multiple sections; same for footer.

### Output

Write `<SPRITE_PATH>/app/analysis/sections.json`:

```json
{
  "pages": {
    "<page_id>": {
      "sections": [
        { "type": "<section_type>", "selector": "<page-scoped CSS>" }
      ]
    }
  },
  "header_sections": ["<section_type>", ...],
  "footer_sections": ["<section_type>", ...]
}
```

Sections are listed in visual reading order, top to bottom. Selectors are page-scoped (resolve against `document`).

## Self-check

- [ ] Snapshot script ran successfully and `meta.json` + per-page `.html` + screenshots all exist.
- [ ] Every page in `meta.pages` has an entry in `sections.json.pages`.
- [ ] Every section selector resolves to exactly one element on its page.
- [ ] No section is nested inside another section's selector.
- [ ] Sections with different backgrounds / clear visual breaks are separate entries (not collapsed under a shared wrapper).
- [ ] `header_sections` / `footer_sections` reference types present on every page.

## Report

- Pages snapshot'd + dark-mode probe.
- Sections per page (count + type list).
- Header / footer composition.
