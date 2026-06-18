# Stage 1 — Pages

Find every page in the prototype (HTML files in `app/handoff/`) and register them in `app/swell.json` under `storefront.theme.pages`. Record the page-id → source-HTML mapping in `app/analysis/page-sources.json` for later stages, and wire routing in the frontend so every page resolves at runtime.

The file `app/swell.json` already exists with manifest fields — edit it, don't recreate, don't copy into `frontend/`.

Each entry:
- `id` — short snake_case identifier (e.g. `index`, `product`, `category`).
- `label` — name as the design's navigation calls it (e.g. "Home", "Shop").
- `url` — the route. Home is `/`. Item-by-slug pages: `/<resource>/:slug`. Otherwise `/<id>`.
- `collection` — present ONLY on `:slug` URLs. Names the collection that slug belongs to. Allowed: `products`, `categories`.

## How to decide

Open each HTML file under `app/handoff/` and look at its `<title>`, first `<h1>`, and content. Filename is a hint, not authoritative — `shop.html` is usually the product listing. The handoff `README.md` and `chats/` (when present) often state the user's intent for each page; consult them when filenames are ambiguous.

Currently supported standard ids (use when the page matches semantically):
- `index` — homepage / landing → `url: "/"`
- `products` — product listing / shop / catalog → `url: "/products"`
- `product` — single product detail → `url: "/products/:slug"`, `collection: "products"`

Pages that don't match any standard id are static — pick a snake_case `id` from the page's purpose; `url` is `/<id>`. Future stages will add `category`, `categories`, `cart`, `account`, `search` — until then, treat them as static if they appear.

When uncertain, default to static.

## Final shape of swell.json

Preserve every existing top-level field. The first three entries are required; append every other page found in the prototype after them:

```json
{
  "id": "...",
  "name": "...",
  "type": "...",
  "version": "...",
  "permissions": [...],
  "storefront": {
    "theme": {
      "pages": [
        // required — always include
        { "id": "index",    "label": "Home",    "url": "/" },
        { "id": "products", "label": "Shop",    "url": "/products" },
        { "id": "product",  "label": "Product", "url": "/products/:slug", "collection": "products" },

        // additional pages — one per page found in the prototype
        // static page or list without a slug:
        { "id": "<page-id>", "label": "<Human-readable label>", "url": "/<path>" },
        // page whose URL identifies one item by slug:
        { "id": "<page-id>", "label": "<Human-readable label>", "url": "/<resource>/:slug", "collection": "<collection>" }
      ]
    }
  }
}
```

## Source mapping

Write `app/analysis/page-sources.json` — a flat object mapping each `id` in `swell.json` to the original HTML file the decision was based on. Paths are relative to `app/handoff/`. Create the `analysis/` directory if it does not exist.

```json
{
  "<page_id>": "<relative/path/to/file.html>",
  "<page_id>": "<relative/path/to/file.html>"
}
```

Every `id` in `swell.json` must appear here, and every value must point to an existing file under `app/handoff/`.

## Wire routing for new pages

The template ships with three pre-wired pages: `index` → `HomePage`, `products` → `ProductListPage`, `product` → `ProductPage`. For every page whose `id` is **not** one of these three, add three thin artifacts so the route resolves:

### 1. Empty page template

`app/frontend/theme/templates/pages/<id>.json`:

```json
{ "page": { "title": "", "description": "" }, "sections": [] }
```

A later stage fills `sections`. Skip if the file already exists.

### 2. Page wrapper component

`app/frontend/src/pages/<PascalCase>Page.tsx` — derive `<PascalCase>` from `<id>`:

```tsx
import { TemplatePage } from "@swell/storefront-app-sdk-react";
import json from "@theme/templates/pages/<id>.json";

export default function <PascalCase>Page() {
  return <TemplatePage content={json} />;
}
```

Skip if the file already exists.

### 3. App.tsx route

In `app/frontend/src/App.tsx`, add (idempotent — skip if already present):

- Import alongside the other page imports:
  ```tsx
  import <PascalCase>Page from "@/pages/<PascalCase>Page";
  ```
- Route inside `<Routes>` (place after the standard routes, in the same order as `swell.json` pages):
  ```tsx
  <Route path="<url>" element={<<PascalCase>Page />} />
  ```

## Self-check before finishing

- [ ] `app/swell.json` parses as valid JSON after the edit.
- [ ] No two entries have the same `id`.
- [ ] Every `:slug` URL has a `collection`; every non-`:slug` URL does not.
- [ ] `app/analysis/page-sources.json` exists, lists every `id` from `swell.json`, and each value points to an existing file under `app/handoff/`.
- [ ] For every non-standard page, `theme/templates/pages/<id>.json`, `src/pages/<PascalCase>Page.tsx`, and a matching `<Route>` in `App.tsx` all exist.
- [ ] `cd app/frontend && bun run build` finishes without errors.
