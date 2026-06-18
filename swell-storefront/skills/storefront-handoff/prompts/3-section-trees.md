# Stage 3 — Section trees

Two parts:

1. Run the crop script (per-section HTML + screenshots).
2. For every unique section type, decide its structure (blocks + containers + nesting) and write `section-trees.json`.

Layout values (gap, padding, column widths, alignment) are NOT decided here — a later stage extracts them mechanically from the chosen `wrapper_selector`. Your job is only the **structural** decision: which DOM elements become Blocks, which wrappers become Containers, and how they nest.

**Goal: granularity.** Every visually distinct editable piece of content (a text line, a button, an icon, an image) should become its own Block whenever the depth limit allows. Containers exist to compose granular Blocks; they should not swallow up multiple atomic pieces unless forced by SDK constraints. Composite Blocks are a strict last resort.

### HARD RULES — verify each before emitting any node

These rules override any other intuition. If a node would violate them, the output is wrong.

1. **MULTI-TEXT WRAPPER ⇒ CONTAINER.** If a wrapper has ≥ 2 direct element children that each carry their own text content (or are themselves media tags), the wrapper MUST become a Container with that many separate atomic Blocks inside. It is never a Block A — even when the children look small, similar, or sit on a single visual line.

2. **PADDING-ONLY WRAPPER ⇒ PASSTHROUGH.** If a wrapper only adds padding and/or constrains content width (max-width centering) and does not compose its children into a row/column/grid arrangement, it MUST be Passthrough. Do not promote padding-only wrappers to Containers — that wastes a depth level.

3. **GRID WITH ≥ 4 COLUMNS ⇒ SPLIT.** A Container whose wrapper is a grid with 4 or more visible columns in the DOM MUST be split into nested grids of 2 or 3 columns each. The split is mandatory regardless of how many logical entries the Container has after multi-instance collapse — a multi-instance Block covering several columns does NOT exempt the wrapper.

4. **COMPOSITE BLOCK ⇒ ONLY AT FORCED DEPTH 3.** A Composite Block is permitted ONLY when (a) a wrapper would otherwise have to be a Container at level 3 (forbidden by SDK), AND (b) its children are ≥ 3 visually interchangeable items. At levels 1 and 2 you always have Container or Passthrough — never Composite. For 2 children, always flatten.

5. **SIMPLE-ATOM SIBLINGS ⇒ N SEPARATE BLOCKS, NOT MULTI-INSTANCE.** If a wrapper has ≥2 direct children that each are simple atoms (single text, single icon, single image, single small interactive element — no inner multi-part structure), they are NOT kind D. Each becomes its own atomic Block, even if their styling matches. Kind D / multi-instance is reserved for repeating COMPLEX units (each item has multiple semantic parts inside: heading + body, image + caption + price, label + value etc.).

6. **VISIBLE LEAVES WITH NO TEXT/MEDIA ARE STILL BLOCKS.** A leaf element with its own visible paint but no inner content (a divider line, a separator bar, a decorative shape, an `<hr>`) is a Block A. Do not silently drop it because it has no text or media tag.

If any rule fails, fix the structure before moving on.

## Part 1 — Run the crop script

```bash
node <SCRIPTS_DIR>/3-crop-sections.mjs --sprite <SPRITE_PATH>
```

Writes for every unique section type:

- `<SPRITE_PATH>/app/analysis/sections/<type>.html` — cleaned outerHTML.
- `<SPRITE_PATH>/app/analysis/sections/<type>.light.png` — cropped screenshot (light theme).
- `<SPRITE_PATH>/app/analysis/sections/<type>.dark.png` — cropped dark screenshot (not used in this stage).

Verify the light files exist. Surface any `WARN:`.

## Part 2 — Decompose

For every unique section type, work from its HTML and light PNG. Produce a tree of Containers and Blocks that respects SDK constraints. Don't open the dark PNG.

### Inputs (per section)

- `<SPRITE_PATH>/app/analysis/sections/<type>.html`
- `<SPRITE_PATH>/app/analysis/sections/<type>.light.png`

### SDK constraints (must hold)

1. **Max 3 levels from section root** to any leaf:
   - `section → Block`
   - `section → Container → Block`
   - `section → Container → Container → Block`
   No Container at depth ≥ 3.
2. **Container with `mode: grid` has 2 or 3 columns.** 4+ is invalid.
3. **Blocks have no children** in the output. A Block's internal layout is captured by its component, not by the tree.

### How to recognise a Block

Apply these tests in order; the first match wins. Don't recurse into a node once it has matched.

**A. Atomic leaf** — a single visual unit, leaf in the DOM. Match if any:
- the element has no element children AND carries text; OR
- the element is a media tag (`img`, `picture`, `svg`, `video`); OR
- the element is a leaf with its own visible paint but no inner content — a divider line, a separator bar, a decorative shape, an `<hr>`; OR
- the element has inline-text descendants used purely for formatting INSIDE one piece of text (e.g. `<p>This <strong>is</strong> bold.</p>`, `<h1>Title with <em>emphasis</em></h1>`).

Hard counter-rule: count the DIRECT element children that themselves carry their own text or media. If that count is ≥ 2, the wrapper is NOT Block A — it is a Container whose children are separate atomic Blocks. This holds even when the children look visually similar, are short, or sit on the same line.

**B. Branded composition** — a wrapper whose children are arranged with custom positioning that doesn't fit a normal grid/flex. Match if any: a direct child has `position: absolute`, a direct child has a non-identity `transform` (rotate/translate/scale), or two direct children's bboxes overlap. Even when the composition contains things you might call sub-blocks, the WHOLE composition is ONE block — its component captures the inner artwork.

**C. Runtime widget** — an element whose function requires client-side state (toggling, opening, switching, navigating between views). HTML cues: `<button>`, `<select>`, `<input>`, ARIA attributes like `role="tab"`, `aria-expanded`. Visually: it responds to clicks/hovers in ways beyond following a link.

**D. Homogeneous collection (multi-instance)** — a wrapper with ≥2 direct element children where:
- the items share the same inner DOM shape (same tag tree, same descendant roles); AND
- each item is itself COMPLEX — it has multiple semantic parts inside (heading + body, image + caption + price, label + value, etc.).

Emit ONE block whose selector matches all sibling instances; do not recurse into individual siblings.

Multi-instance is reserved for repeating complex units that a merchant would manage as a list (data-bound or list-editable). Simple atoms (single text, single icon, single image) sitting as siblings — even if they match each other — are NOT kind D. Each becomes its own Block A.

### How to recognise a Container

If a wrapper does NOT match any Block test, it's a candidate Container or a passthrough. Decide visually:

A wrapper becomes a **Container** if it actively composes its children into a row/column/grid — ANY of:

- Children are arranged in two or more visible columns or rows (visible from the screenshot)
- There's a clear gap between children (more than touching)
- Children align to start/center/end (not the default)

A wrapper is a **Passthrough** if any of:

- It only adds padding and/or constrains content width (max-width centering) — does NOT compose children into rows/columns/grid. Its padding will be absorbed by the nearest enclosing Container (or by the section's own padding) at the next stage; do not waste a Container level on a padding-only wrapper.
- It is a single-child wrapper with no own composition effect.
- It exists only for semantic markup (decorative wrapper, ARIA grouping) with no layout role.

Do not emit Passthroughs to the output — recurse through them straight to whatever they wrap.

### Algorithm

For each section, walk its DOM from the section root. At each element, in this order:

```
1. Run Block tests A, B, C, D in order.
   If one matches → emit { kind: "block", type, selector }, stop here.

2. Otherwise this is a wrapper. Decide:
   - If it is a Passthrough: skip it, recurse into its children at the SAME output level.
   - If it is a Container: track its output level (parent's level + 1).

3. Track output level as you recurse:
   - section's direct children = level 1
   - children of a Container at level 1 = level 2
   - children of a Container at level 2 = level 3 (BLOCKS ONLY — no Container allowed)

4. When you would emit a Container at level 3:
   FORBIDDEN. This is the ONLY situation in which a Composite Block may be created.
   Decide:
   DEFAULT CHOICE IS FLATTEN. Merging is only allowed under a strict bar.

   a. MERGE into a single Composite Block ONLY when ALL hold:
      - ≥3 children. (For 2 children, always flatten.)
      - Children are visually INTERCHANGEABLE — same shape, same paint, same
        size, same role. You could reorder them without changing meaning.
        Different visual treatments (filled vs outlined, primary vs secondary,
        labelled vs unlabelled) FAIL this test.
      - Each child is individually a Block of kind A or C.
      - The wrapper applies a clearly non-default arrangement (own row, own
        stack with explicit gap, etc).
      Selector targets the wrapper. Name describes the cluster's function.
   b. Otherwise → flatten: drop the wrapper, recurse children directly into the
      level-2 Container's children list. Children stay as individual atomic
      Blocks; only the wrapper's own arrangement is lost. Note as visual loss
      in the report.

   Composite Blocks are NEVER created at level 1 or 2. At those levels you
   always have the choice between Container or Passthrough.

5. When a Container is grid with 4+ columns:
   MANDATORY SPLIT. The "column count" is the number of grid tracks the DOM
   wrapper actually has (the visible columns in the screenshot or the
   `grid-template-columns` track count). It is NOT the number of logical
   entries the Container ends up with after multi-instance collapse.

   Before deciding the Container is fine, look at the wrapper's grid in the
   DOM and count visible columns. If that count is ≥ 4, you MUST apply the
   split below — a multi-instance Block covering several visible columns
   does NOT exempt the wrapper from the split.

   a. If all visible columns are homogeneous (filled by the same kind of
      content with the same shape end-to-end) → this should have matched
      Block test D. Re-classify the entire wrapper as one multi-instance Block.
   b. Else split into nested grids ≤3 cols:
      - Pick the "odd column" (the visible column whose content differs from
        the rest — usually first or last).
      - Outer grid: 2 cols [odd_column, rest_group].
      - Rest_group is a synthesized inner Container holding the remaining
        visible columns with equal-width grid (2 or 3 entries). If a multi-
        instance Block covers several of those remaining columns, place that
        Block as the single child of the inner Container — its multi-instance
        selector still expands to N visual cells at render time.
      - If rest still has > 3 visible columns, recurse the same split on the
        inner Container.
      The synthesized inner Container reuses the original wrapper's selector;
      flag in the report.

6. Order children in visual reading order (top-to-bottom, left-to-right within a row).
```

### Selector rules

All selectors are **section-scoped** — they resolve under the section's root, not the document. Downstream tooling combines them as `<section_selector> <your_selector>`.

- Use the most specific stable form on the target element: tag + class combo (preferred), or `:nth-child` only when no class is available.
- Never start a selector with a class or tag that's already part of the section's own selector — the combined query won't match.
- Multi-instance Block (kind D): the selector must match all sibling instances.
- Composite Block (synthesized at depth limit): the selector targets the merged wrapper.
- Container `wrapper_selector`: targets the DOM wrapper element. For synthesized inner containers from column splits, reuse the parent wrapper's selector (mark in report).

### Naming

`type` is snake_case, descriptive of the unit's editor-facing purpose. Keep names short and specific. Reuse the same name across sections for blocks that visually appear identical.

For composite blocks created at the depth boundary, name the cluster by its function.

### Output

Write `<SPRITE_PATH>/app/analysis/section-trees.json`:

```json
{
  "<section_type>": [
    { "kind": "block", "type": "<block_type>", "selector": "<section-scoped CSS>" },
    {
      "kind": "container",
      "wrapper_selector": "<section-scoped CSS>",
      "children": [
        { "kind": "block", "type": "...", "selector": "..." },
        {
          "kind": "container",
          "wrapper_selector": "...",
          "children": [
            { "kind": "block", "type": "...", "selector": "..." }
          ]
        }
      ]
    }
  ]
}
```

Top-level `<section_type>` matches keys in `sections.json.pages.*.sections[].type`. The value is the section's children array (the section root is implicit; you don't emit it).

## Self-check

- [ ] Every section type from `sections.json` has an entry.
- [ ] Tree depth from section to any block ≤ 3 (section → optional Container → optional Container → Block).
- [ ] **No Container has more than 3 columns.** (For every Container, look at the wrapper's actual DOM grid; if visible columns ≥ 4, split was applied.)
- [ ] **No wrapper that only adds padding/max-width is a Container.** Padding-only wrappers were Passthrough.
- [ ] **No Block has ≥ 2 text-bearing direct element children.** Wrappers with multiple text children are Containers, not Blocks.
- [ ] **No Composite Block was emitted at level 1 or 2.** Composites only exist where a level-3 Container would otherwise be required AND ≥ 3 interchangeable children.
- [ ] **No multi-instance Block (kind D) was emitted for simple atomic siblings.** Kind D is only used when each item is itself a complex unit with multiple semantic parts.
- [ ] **Visible leaves with no text/media (dividers, separator bars, decorative shapes) were emitted as Block A**, not silently dropped.
- [ ] Every selector resolves under its section root.
- [ ] No selector starts with a class or tag already in the section's own selector.
- [ ] No Block has children.
- [ ] Children are in visual reading order.

## Report

- Sections processed.
- Blocks per section (count + breakdown by kind A/B/C/D/composite).
- Multi-instance Blocks (with sibling count).
- Composite Blocks created at depth limit (with reason).
- Column splits applied (with original column count).
- Sections with unavoidable layout loss (passthrough at depth ≥ 3 because composite was not appropriate).
