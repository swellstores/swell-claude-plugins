# Stage 5 — Block JSX

Run the script that generates JSX components for every unique block type.

```bash
node <SCRIPTS_DIR>/5-generate-blocks.mjs --sprite <SPRITE_PATH>
```

This reads `<SPRITE_PATH>/app/analysis/blocks.json` and the cropped section HTMLs, transforms each block's outerHTML to JSX (class → className, void self-close, SVG attrs camelCased, inline styles → object), and writes:

- `<SPRITE_PATH>/app/frontend/src/blocks/<PascalName>.tsx` — one file per unique block type.

Surface any `WARN:` lines.

## Self-check

- [ ] Every block type from `blocks.json` has a corresponding `.tsx` file in `src/blocks/`.

## Report

- Number of files written.
- Any warnings.
