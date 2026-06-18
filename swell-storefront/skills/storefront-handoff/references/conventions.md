# Block & section conventions

Authoring policy for the block-construction stages of the storefront-handoff pipeline. Stage prompts that touch blocks/sections/pages MUST read this and follow it. Source-of-truth for granularity rules, settings shape, design tokens, SDK usage, file layout, and pipeline structure.

These conventions were aligned with the user. Don't deviate — if a case isn't covered, ask before improvising.

---

## A. Block granularity

### Decomposition rule

**Split a section into N child blocks** when the children:
- Have independent semantics (heading, paragraph, button, chip, link, image…).
- Can be reordered, added, removed, duplicated independently in the editor.
- May get different layouts at different breakpoints via Container settings (row vs column, gap, alignment, wrap).

**Keep as ONE composite block** when:
- The composition is a branded visual pattern with custom positioning (overlap, rotations, stacking, custom-named layout).
- Splitting would lose design identity.
- Sub-elements are part of the visual statement, not independently meaningful.

### Reading the design

| Pattern | Decomposition |
|---|---|
| Heading + paragraph + 2 buttons + 3 chips, side-by-side or stacked | N primitive blocks inside Containers |
| 3 candy tiles with custom rotations / overlap (pop-piece hero right column) | 1 composite block with hardcoded slots + per-slot settings |
| 4 hardcoded feature chips with emoji + text | 4 `feature_chip` blocks in a Container |
| Product cards driven by API (count = whatever the collection has) | **1 block** (`product_grid` / `product_carousel`) with internal loop. Cards are NOT blocks. |
| Nav links (from Swell menu) | 1 `nav_menu` block with internal loop over `useMenu(slug)` items |
| Social-link strip (icons hardcoded by designer) | N `social_link` blocks in a Container |

### Per-context blocks > universal blocks

Don't try to make a single block reusable across every context. If a button looks slightly different in `hero` vs `newsletter` (padding, radius, label arrangement), prefer **two separate blocks** (`hero_primary_button`, `newsletter_primary_button`) over one block with `style: select` variants.

> *One block does one thing perfectly.* Many similar blocks > one universal block.

A block is reused only when its DOM/style/settings shape are *identical* across uses. Detection happens via fingerprint matching (Stage 4 script).

### Naming

Block names are typically section-scoped: `<section>_<element>` (e.g., `hero_kicker_chip`, `nav_logo`, `footer_menu`). When a block is genuinely shared (header used on every page), the name has no section prefix. Snake_case throughout.

---

## B. Settings vs hardcoded

### What goes into block settings (editable in editor)

| Category | Field type | Notes |
|---|---|---|
| Texts (headings, paragraphs, labels, micro-copy) | `text`, `textarea`, `richtext` | Always settings. Use `richtext` only when the design has actual rich formatting. |
| Images | `image` | Defaults live in `app/frontend/assets/images/` — never `app/handoff/`. Defaults copied in during Stage 5/6. |
| Hrefs | `url` | All `<a href>` and CTA targets. Optional (empty allowed). |
| Decorative colors | `color` | Per-block colors from `decorations.json`. Standard scheme roles flow through tailwind tokens, not block settings. |
| Toggles for composite parts | `boolean` | Only for parts of a composite block (e.g., `show_prices`). NOT for whether a child block exists — the editor handles add/remove. |
| Variant size for typography | `select` | `size: "display" | "headline" | "subhead" | "body"` etc. — see C2. Either as one `style: select` setting OR split into separate dropdowns (`size: select` + `weight: select`), whichever is more natural for the block. |
| Animation params | `boolean`, `number` | Only when meaningful: `autoplay`, `interval`, `speed`. Anim itself stays hardcoded. |
| Product/category lookup | `lookup` (with `collection: 'products'` or `'categories'`) | Empty → block renders placeholder from design. Filled → block fetches via `useProduct/useProducts/useCategory/useCategories` and renders real data. |
| Menu lookup | `menu` | For nav blocks. Empty → placeholder; filled → `useMenu(slug)` items. |

### What stays hardcoded in JSX

- DOM structure (where elements live inside the block).
- Tailwind classes for layout (flex, grid, padding, spacing).
- SVG icons that are part of the block's identity (chevrons, arrows, plus). User does NOT edit SVG paths through the editor.
- Animations (CSS keyframes / transitions). User may control parameters via settings, not the animation itself.
- Aria/accessibility attributes (or derived from label settings).
- Color tokens (`bg-background`, `text-text`, `bg-button`, `border-border`, `shadow-shadow`, etc.) — these come from the section's color_scheme, not block settings.

### Defaults

- Defaults come from the prototype's HTML — the actual text/image/href value found in the source.
- If a setting can't be inferred (e.g., a placeholder `#` href), leave it empty.
- No universal blocks: each block is tuned for its prototype context. Defaults reflect that context.

---

## C. Design system layer

### C1. Color tokens (scheme-bound)

Closed vocabulary, populated by Stage 3:
- 5 standard: `background`, `text`, `button`, `button_label`, `secondary_button_label`.
- + `secondary_button` (when filled secondary buttons exist in the design).
- + cross-cutting auto-detected: `border`, `shadow`, etc.

All blocks use these via tailwind classes (`bg-background`, `text-text`, …). Any color that doesn't match a scheme role becomes a **per-block `color` setting** with default from `decorations.json`. Inline hex in JSX is forbidden.

### C2. Typography

- **Fonts** in `tailwind.config.js` `theme.extend.fontFamily` (named: `display`, `body`, etc.). Blocks use `font-display`, `font-body`. No `font_picker` global setting — fonts are part of the design.
- **Font sizes**: pixel-perfect copy of design — extract custom sizes into `theme.extend.fontSize` with semantic names (`display`, `headline`, `subhead`, `body`, `caption`).
- **User control**: text-bearing blocks (heading, paragraph) expose a `size: select` setting so the user can swap between named sizes. Default = the size used in the prototype.

### C3. Spacing

Pixel-perfect — extract design's spacing values into `theme.extend.spacing`. Don't rely on Tailwind's default scale. Blocks use named tokens, not arbitrary `[80px]` values.

### C4. Border radius

Same as spacing — pixel-perfect, custom tokens in `theme.extend.borderRadius` (or extending the default scale where overlap exists).

### C5. Shadows

`theme.extend.boxShadow` with semantic tokens (`shadow-card-sm`, `shadow-card-md`, `shadow-card-lg`, `shadow-button`, `shadow-chip`). Color part uses `var(--shadow)` so it's scheme-aware.

Blocks expose `shadow_size: select` setting to let user pick among the size variants where it's meaningful.

### C6. Dark mode

Through CSS custom properties only. Tailwind `darkMode: ["class", '[data-theme="dark"]']` triggers the right CSS-var swap. Blocks DO NOT use `dark:` Tailwind variants — `bg-background` is automatically the right hex in either theme.

### C7. Animations

`theme.extend.keyframes` + `theme.extend.animation` with semantic names (`animate-marquee`, `animate-tile-float`). Blocks use the `animate-*` Tailwind classes. Animation params (autoplay, speed) become block settings when meaningful.

---

## D. SDK data flow

### D1. Where data providers live

- **Standard pages** (`/products`, `/products/:slug`) wrap their template in SDK providers (`ProductListProvider`, `ProductProvider`). This is already in the template's `ProductListPage.tsx` / `ProductPage.tsx`.
- **Other pages** (home, about, custom): blocks fetch their own data via hooks (`useProducts`, `useProduct`, `useCategory`, `useCategories`, `useMenu`).
- **Per-block hooks** are the default for non-standard pages.

### D2. Empty state pattern

Every dynamic block follows the same shape:

```tsx
const { collection_lookup } = settings;
const { products, isLoading } = useProducts({
  filter: { collection_id: collection_lookup },
  enabled: !!collection_lookup,
});
if (!collection_lookup || !products) {
  return <PlaceholderTilesFromDesign />;
}
return products.map(p => <CardJSX product={p} />);
```

`PlaceholderTilesFromDesign` is hardcoded JSX inside the block, mirroring the prototype's static content. It's what the editor renders before the user picks a collection/category/menu.

### D3. Header / footer

- Live as separate JSON files: `theme/templates/layout/header.json` and `footer.json`.
- Both files contain a `sections[]` array. **Multi-section** is normal — pop-piece header has 2 sections (`promo_ticker`, `top_nav`); footer has 1.
- Wired via `<SwellStorefrontApp header={headerJson} footer={footerJson}>`.
- Page JSONs (`theme/templates/pages/*.json`) do NOT include header/footer sections — they're injected globally.

When a header needs page-specific behaviour (sticky add-to-cart on product pages), the relevant block reads page context (`useProductPage`, `useProductList`, pathname) and adjusts its render. **Don't** create page-specific header.json variants.

### D4. Page metadata

The `PageTemplate` shape includes `page: { title, description }`. The SDK applies these to `<title>` / `<meta name="description">` automatically. Stage 6 fills these from the prototype's `<title>` and `<meta name="description">` tags.

### D5. Routes

`src/App.tsx` routing is set up by Stage 1 (agent) — adds wrappers for non-standard pages. Stage 6 only verifies it matches `swell.json.storefront.theme.pages`. Dynamic routes (e.g., `/collections/:slug`) use `useParams` + the relevant SDK hook.

---

## E. Reuse and detection

### E1. Header / footer detection (script)

For each pair of pages, compare `section_candidates[]` from top and bottom. Sections with identical fingerprint (`tag_hint + classes_hint + colored_elements: tag/role/classes/properties`) across **all** pages form the header (top) or footer (bottom).

Header / footer can each contain multiple sections — pop-piece header has 2 (promo + nav).

Output: `app/analysis/blocks/layout-detection.json`:

```json
{
  "header": { "sections": ["section_0", "section_1"] },
  "footer": { "sections": ["section_-1"] },
  "page_local_sections": {
    "index": ["section_2", "section_3", ...],
    "products": [...],
    ...
  }
}
```

### E2. Array-of-items decomposition

Source determines decomposition:

| Source | Pattern |
|---|---|
| Hardcoded by designer (3 feature_chips, 4 stat_cards, fixed images) | N blocks in a Container |
| Products from API | 1 block, internal loop, `useProducts` |
| Categories from API | 1 block, internal loop, `useCategory(s)` |
| Menu from Swell admin | 1 block, internal loop, `useMenu(slug)` |

**Why**: API-driven counts vary (collection has 0 to N products) — cards can't be individual editor-managed blocks.

### E3. Block fingerprint matching (script)

For block reuse detection: hash each `colored_element` by `(tag, classes, properties)`. Identical fingerprints across pages indicate the same block type. Different fingerprints → different block types (per-context blocks).

### E4. Detection algorithm — hybrid

| Step | Owner | Output |
|---|---|---|
| Header/footer detection (E1) | script | `layout-detection.json` |
| Block fingerprint analysis (E3) | script | `fingerprints.json` |
| Manifest authoring (granularity, names, settings shape, defaults) | agent | `manifest.json` |
| Page composition / file assembly | script | actual storefront files |

---

## F. File layout

```
app/
  swell.json
  package.json
  tsconfig.json
  bun.lock

  handoff/                          # original Claude prototype (input)
    project/...

  analysis/                         # intermediate, debug-only, gitignore-able
    extraction/
      meta.json
      pages/<id>.json
      screenshots/<id>.<theme>.png + sections/<candidate>.<theme>.{clean,annotated}.png
    colors/
      decorations.json
    colors-roles/<id>.json          # agent kind mapping (Stage 3)
    blocks/
      layout-detection.json
      fingerprints.json
      manifest.json

  frontend/                         # storefront-react-ai-template root
    package.json
    tsconfig.json
    tailwind.config.js              # colors + fonts + sizes + spacing + radii + shadows + animations
    index.html
    assets/
      images/                        # default block image assets
      fonts/                         # self-hosted fonts
      icons/                         # standalone SVG icons (rare)
    src/
      App.tsx                        # routes + <SwellStorefrontApp>
      index.css                      # @font-face, reset
      blocks/
        index.ts                     # BLOCKS registry
        <name>.tsx                   # one file per block (papka only when block needs sub-files)
      sections/
        index.ts                     # SECTION_SCHEMAS registry
        <name>.json                  # ComponentSchema (json)
      settings/
        schema.json                  # global settings schema (Stage 3 output)
      pages/
        HomePage.tsx, ProductListPage.tsx, ProductPage.tsx, <Custom>Page.tsx
    theme/
      settings/
        settings.json                # global settings instance (Stage 3 output)
      templates/
        pages/<id>.json              # page composition (Stage 6 output)
        layout/header.json           # multi-section header (Stage 6 output)
        layout/footer.json           # multi-section footer (Stage 6 output)
      locales/en.default.json
```

---

## G. Pipeline structure

| Stage | Type | Output |
|---|---|---|
| 0 | script | scaffold sprite |
| 1 | agent | pages discovery → swell.json + page wrappers |
| 2 | script (orchestrator + modules) | Playwright extraction + design-token derives (typography, spacing, radii, shadows, animations) |
| 3 | agent + script | colors classify (agent) + scheme + tokens (script) |
| 4 | agent + script | layout-detection (script) + fingerprints (script) + manifest authoring (agent) |
| 5 | agent (categorized batch) | block JSX components — simple primitives in batch, composite/API-driven sequentially |
| 6 | script | page JSONs, layout JSONs (header/footer), block & section registries, App.tsx verification |
| 7 | script | TypeScript check + dev server smoke test |

### Stage 4 split

- **Script** runs first: `layout-detection.json`, `fingerprints.json`. Surface unambiguous facts.
- **Agent** then authors `manifest.json`:
  - section types (names, descriptions)
  - per-section block decomposition (granularity rule from A applied)
  - per-block settings shape (B applied)
  - per-block defaults from prototype
  - identification of API-driven vs hardcoded array patterns (E2)
  - block reuse decisions (E3)

### Stage 5 categorized batch

- **Simple primitives** (heading, paragraph, button, chip, link, image): one agent prompt writes 5–10 blocks at a time. Lower complexity per block → lower hallucination risk.
- **Composite branded** (candy_tile_stack, marquee, hero_visual): one block per agent invocation. High judgment required for layout / animations.
- **API-driven** (product_grid, product_carousel, nav_menu, category_strip): one block per agent invocation. Precise SDK hook usage required.

### Stage 6 assembly (script)

Mechanical from `manifest.json`:
- Write `theme/templates/pages/<id>.json` (composition with `page.title/description` from prototype `<title>`/`<meta>`).
- Write `theme/templates/layout/header.json`, `footer.json` (multi-section group).
- Write `src/blocks/index.ts` (BLOCKS registry from manifest).
- Write `src/sections/index.ts` (SECTION_SCHEMAS registry).
- Verify `src/App.tsx` matches `swell.json.storefront.theme.pages`.

### Stage 7 verification

- `bunx tsc --noEmit` → must pass.
- `bun run dev` → start dev server, confirm storefront responds 200 on each page route. Surface logs/errors if any.
- (Visual diff vs prototype screenshots is a future stage.)

---

## SDK reference (relevant parts)

### Hierarchy

```
PageTemplate { page?, sections: SectionConfig[] }
SectionConfig { type, settings: { layout, color_scheme, ... }, children: ChildConfig[] }
ChildConfig = ContainerConfig | BlockConfig
ContainerConfig { type: 'container', settings: { layout }, children: ChildConfig[] }
BlockConfig { type, settings: Record<string, BlockSettingValue> }
LayoutTemplate { sections: SectionConfig[] }   // header.json, footer.json
```

Sections do NOT have their own JSX — they render as a generic wrapper that applies `color_scheme` + `layout`. Visual identity comes from blocks.

### Schema field types

`text`, `textarea`, `number`, `color`, `image`, `select`, `boolean`, `url`, `radio`, `richtext`, `color_scheme`, `color_scheme_group`, `layout`, `lookup`, `menu`, `header`.

No array / repeatable field exists. Composite blocks with N items use hardcoded slots + per-slot settings (`tile_1_*`, `tile_2_*`, …) or fully-baked branded structure with shared settings only.

### React adapter exports

Components: `SwellStorefrontApp`, `TemplatePage`, `ProductProvider`, `ProductListProvider`.

Hooks: `useProduct(id)`, `useProducts(filter)`, `useProductPage()`, `useProductList()`, `useCategory(id)`, `useCategories(filter)`, `useCart()`, `useMenu(slug)`, `useLocale()`, `useCurrency()`, `useGlobalSettings()`.

Module-level: `setLocale(code)`, `setCurrency(code)`, `loadCart()`, `swell`, `t`, `formatPrice`.
