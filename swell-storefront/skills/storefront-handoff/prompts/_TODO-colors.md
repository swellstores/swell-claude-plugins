# Stage 3 — Color schemes (classify + derive)

This stage has two parts that you execute in order:

1. **Classify** every colored element of every section candidate by assigning it a snake_case `kind` (visual judgment using the per-candidate annotated screenshots).
2. **Run the derivation script**, which reads your kind mappings + the extraction data and writes the final `schema.json` / `settings.json` / `tailwind.config.js` / `decorations.json`.

You do classification only. The script does all math (scheme grouping, variance analysis, role/token/decoration classification). Don't try to enumerate roles or assign schemes — that's the script's job.

## Inputs (per page)

- `<SPRITE_PATH>/app/analysis/extraction/meta.json` — `{ dark_mode, viewport, tokens, pages }`.
- `<SPRITE_PATH>/app/analysis/extraction/pages/<page_id>.json` — every `section_candidate` with its `colored_elements[]`. Each element has `walk_idx`, `tag`, `role`, `classes`, `text_excerpt`, `bbox`, `properties`.
- `<SPRITE_PATH>/app/analysis/extraction/screenshots/<page_id>/<candidate_id>.<theme>.clean.png` — clean cropped screenshot of the candidate.
- `<SPRITE_PATH>/app/analysis/extraction/screenshots/<page_id>/<candidate_id>.<theme>.annotated.png` — same crop with **green numbered overlays** on each `colored_element`'s bbox. The number `[N]` corresponds to the element at index `N-1` in `colored_elements[]` (so `[1]` → `colored_elements[0]`, `[2]` → `colored_elements[1]`, etc.).

## Reserved kinds

Use these exact names when the matching element is present:

- `section` — the section's own surface (its outer container; carries `background-color`, body text `color`, etc.).
- `text` — body text color when the section has it as a separate element distinct from `section.color`.
- `primary_button` — the prominent (filled) call-to-action button.
- `secondary_button` — the alternate button (outlined / ghost / second filled action).

For every other colored element, invent a short snake_case kind describing what it is visually (`card`, `chip`, `badge`, `tile`, `divider`, `accent_text`, `ribbon_badge`, …). Reuse the same kind name for the same element type across sections — that's how the script links recurring elements together.

If an element is irrelevant noise (decorative wrapper, transient overlay), use `"skip"` or omit it entirely from the output for that candidate.

## Procedure

For every page in `app/swell.json.storefront.theme.pages`:

1. Read `extraction/pages/<page_id>.json`.
2. For each `section_candidate`:
   - Open the **annotated** screenshot to see numbered boxes.
   - Open the **clean** screenshot for visual context.
   - For each `[N]` box visible in the annotated image, decide what that element is and assign a kind.
   - Use reserved kinds where applicable; invent emergent kinds for everything else.
3. Write `<SPRITE_PATH>/app/analysis/colors-roles/<page_id>.json`:

```json
{
  "<candidate_id>": {
    "<N>": "<kind>",
    "<N>": "<kind>",
    ...
  },
  ...
}
```

Numbers are strings, 1-based. Omit entries you're skipping.

## Run the script

After all `colors-roles/<page_id>.json` files are written, run:

```bash
node <SCRIPTS_DIR>/3-derive-colors.mjs --sprite <SPRITE_PATH>
```

The script writes:
- `<SPRITE_PATH>/app/frontend/src/settings/schema.json` — `color_scheme_group` definition (5 standard roles + emergent extras + `_dark` siblings under "Light Theme" / "Dark Theme" headers when dark mode is present).
- `<SPRITE_PATH>/app/frontend/theme/settings/settings.json` — `current.color_schemes.scheme-N`.
- `<SPRITE_PATH>/app/frontend/tailwind.config.js` — additional roles + global tokens as CSS vars.
- `<SPRITE_PATH>/app/analysis/colors/decorations.json` — leftover one-off paints, grouped by section (for future block-schema stages).

If the script reports `WARN:` lines, surface them.

## Self-check

- [ ] One `colors-roles/<page_id>.json` per page in `app/swell.json.storefront.theme.pages`
- [ ] Every section candidate's `<candidate_id>` is keyed in its page's file (omit only when the candidate has zero meaningful elements)
- [ ] Reserved kinds (`section`, `primary_button`, `secondary_button`, `text`) used where applicable
- [ ] Recurring elements share the same kind across sections (don't invent new names each time)
- [ ] Script ran successfully and produced all four output files

## Output (report)

- Pages classified
- Total `(candidate, element)` pairs tagged
- Schemes count + section count per scheme (from script output)
- Counts: standard roles, emergent roles, global tokens, decorations
- Any warnings
