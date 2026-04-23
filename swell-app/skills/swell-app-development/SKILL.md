---
name: swell-app-development
description: Understand, design, and modify Swell App end-to-end. Embeds a closed-loop dev cycle with safety gates.
allowed-tools: Read, Grep, Glob
---

# I. System Architecture & Environment

A Swell App is a modular extension package for the Swell headless e-commerce platform, deployed via CLI to inject custom data schemas, admin interfaces, serverless logic and other resources into a store environment.

## The File System Contract

The file system acts as a rigid configuration contract. The existence and naming of a file directly determines its runtime behavior, API endpoint, and whether it creates a new resource or modifies an existing one.

- **App Identity.** The `./swell.json` manifest defines the App ID (referenced as `<app_id>` throughout this document), version, and platform permissions.

- **Assets.** Static resources such as the dashboard icon are stored in `./assets/`.

- **Data.** The `./models/` directory defines the database schema. Files named after standard entities (e.g., `products.json`, `accounts.json`) function as extensions—they merge new fields into the existing platform model, namespaced at runtime as `$app.<app_id>.*`. Files with unique names (e.g., `vendor-profiles.json`) create new app-specific collections. Use strict kebab-case for new collections naming. Reference custom models using their Fully Qualified Name (FQN): `apps/<app_id>/<collection>`. This FQN applies to API endpoints, relationship links, and SDK queries.

- **App Configuration.** The `./settings/` directory defines the app's global configuration schema. These files generate the "App Preferences" UI in the Dashboard, and their values become accessible in functions via `const settings = await req.swell.settings();`. Use this for feature flags and runtime configuration.

- **User Interface.** The `./content/` directory configures Admin Dashboard views: input widgets, list columns, and conditional visibility rules. These files map to standard or custom data model, not strictly a local file: you can create `content/products.json` to customize the standard product editor without re-defining standard `products` data model. Content models define UI logic only (labels, views, help text, layout); data logic (types, events, permissions, formulas) belongs in `./models/`.

- **Notifications.** Transactional emails reside in `./notifications/` using a paired-file convention: a JSON file defines metadata and event triggers (e.g., `review.created`), while a corresponding `.tpl` file contains the Liquid template for the email body.

- **Logic.** Serverless functions reside in `./functions/`. Top-level TypeScript files become API endpoints or event handlers. Shared code—helpers, types, libraries—must be placed in subdirectories (e.g., `./functions/lib/`) to prevent exposure as a standalone function. Functions run on the Edge (Cloudflare Workers), not Node.js.

- **Testing.** The `./test/` directory contains the Vitest suite. It includes `./test/unit/` and `./test/integration/` directories, plus helpers: `mock-request.ts` for mocking function context, `swell-client.ts` for data operations. Its Swell client uses CLI authentication to reach platform resources without client auth configuration.

- **Frontend Integration.** The `./frontend/` directory is an optional app frontend (a separate application) used to render public pages such as storefront routes or embedded admin UIs, which uses Cloudflare Workers as a runtime.

- **Webhooks**. `./webhooks/` directory contains JSON manifests which are configured to call a URL when a particular event occurs, enabling outgoing calls to external services.

# II. CLI Reference

The Swell CLI orchestrates the complete development cycle. Commands follow consistent patterns across resource types, enabling a tight feedback loop: discover → scaffold → validate → deploy → verify.

All commands accept `--help` for detailed usage. Interactive commands accept `-y` to skip prompts.

**Discovery** — `swell inspect {models|content}` lists remote (deployed) resources. Append a path for specifics: `/products` (standard), `/apps/<app_id>/<collection>` (app). Use before extending and after deploying to verify results.

**Schema Reference** — `swell schema {content|function|model|notification|setting|webhook} --format=dts` prints annotated TypeScript declarations with examples. This is the authoritative reference for JSON structure. Always consult before authoring manifests—guessing field names or structure leads to validation failures.

**Scaffolding** — `swell create {content|function|model|notification|setting|webhook|tests} [args] [flags] -y` generates new resources with correct structure. Output passes schema validation and provides a working starting point. See --help for command args and flags.

**Validation** — `swell schema {content|function|model|notification|setting|webhook} ./path/file` validates a manifest against the strict JSON schema. Run after every edit. A clean pass is required before deployment. For functions the command performs its trigger validation and dry-run function bundling.

**Deployment** — `swell app push` deploys all app resources. The platform runs additional validation; errors here indicate issues local validation cannot catch (e.g., references to non-existent collections). Use `--force` to re-deploy unchanged files.

**Local Development** — `swell app dev` starts a local tunnel in watch mode, connecting to the platform's test environment. Functions execute locally, fired by triggers at the platform side. Console output appears in your terminal. Note: direct localhost calls to route functions skip context initialization (settings, session etc). Use collections and functions calls over the `swell api` commands or integration tests for firing local functions through the platform for a full context initialization.

**Observability** — `swell logs [-f] [--type function] [--app <id>] [-s <kw>] [--env <id>]` queries or follows (`-f`) remote logs for functions, webhooks, and API calls. Default env is `test`; pass `--env live` for production. Function entries include status, response, errors, and `console.log/warn/error` output captured automatically from each invocation. Complements `swell app dev`, which only streams local execution.

**Data Operations** — `swell api {get|post|put|delete} /<path>` performs CRUD against the platform. Standard collections: `swell api get '/products?limit=1'`. App collections: `swell api get '/apps/<app_id>/<collection>'`. App collections, declared as children in the standard collection: `swell api get '/products:apps.<app_id>.<collection>'`. App functions `swell api get '/functions/<app_id>/<name>'`. Use `--body` for payloads: `--body '{"name":"Test"}'` or `--body ./fixture.json`.

# III. Development Cycle

Main Swell App resource types share the similar Development Cycle formalized in five gates. IMPORTANT: Pass all five gates for each modified or created resource.

## Gate 1 — Explore

Identify resources your are going to create or modify. Identify prerequisites your resource depends on: e.g. model events for functions/webhooks/notifications, data fields for content views, relationship targets for links etc. Swell App naturally extends standard platform resources in its own scope. To avoid duplication of standard resources, or to find a proper alignment to standard resources, you may need to list existing remote models with `swell inspect models` and explore them with the same command.
Pass: You know (a) which resources you will create or extend, (b) which prerequisites must exist, and (c) that prerequisites are present or will be created first.

## Gate 2 — Schema

Obtain the authoritative structural rules of the target resource type before authoring. Execute `swell schema {content|function|model|notification|setting|webhook} --format=dts`. The schema is the single source of truth. Guessing field names or structure guarantees app failures.
Pass: You have the schema output and understand the structural requirements for your resource type.

## Gate 3 — Author & Validate

For new resources, scaffold with `swell create {content|function|model|notification|setting|webhook} [name] [flags] -y`. IMPORTANT: Never create new resource without scaffolding. Use kebab-case for resource naming. Explore `--help` for resource-specific flags. Edit the resource to implement your requirements. Validate resource with `swell schema {type} ./path/file`. For functions also run `npm run typecheck`. Iterate until zero errors.
Pass: Local validation passes with zero errors. TypeScript compiles without errors.

## Gate 4 — Deploy & Verify

Push resources to the platform test environment with `swell app push`. The platform performs additional validation beyond local schema checks: reference integrity (e.g., links to non-existent collections), reserved field conflicts, and event binding validity. Deployment errors indicate issues local validation cannot catch. Verify deployment with `swell inspect <type> <resource>`.
Pass: Deployment completes without errors. Inspection confirms the resource exists remotely with correct configuration.

## Gate 5 — Test

Confirm the resource behaves as designed under realistic conditions. Actions depend on resource type you are going to test:

- Event-driven resources (model-triggered functions, webhooks, notifications): Trigger via `swell api [post|put|delete] /apps/<app_id>/<collection>` with payloads matching event conditions (model events propagate asynchronously).
- Route functions: Call via `swell api [get|post|put|delete] /functions/<app_id>/<function_name>` with appropriate `--body`.
- Data models: Execute create → read → update → delete cycle via `swell api` or integration test. Test relationship expansion with `?expand=`.
  Pass: Resource produces expected behavior. For testable resources, integration tests in `./test/integration/` pass and provide regression coverage.

Note: Consider formalizing your tests in unit and integration tests of the app. Scaffold tests with `swell create tests` if necessary.

# IV. Resources best practices

## Data Models

Data models define the database schema in `./models/*.json`, where filename matches collection (`products.json`). Remote (deployed), models can be inspected with `swell inspect models /products` (standard) or `/apps/<app_id>/<collection>` (app). This section covers dev cycle that extends standard collections or creates new app-specific ones.

**Decision Guide:**

- [ ] **Extend a standard model** when data logically belongs to an existing entity: review scores on products, loyalty tiers on accounts, fulfillment metadata on orders. Fields merge into the record under `$app.<app_id>.*`. Benefits: seamless admin integration, no new API surface, automatic association with platform workflows.

- [ ] **Create a new app model** when data requires independent lifecycle, dedicated events, distinct public permissions, or has no natural parent. Reviews, wishlists, vendor profiles fit here. The collection lives at `apps/<app_id>/<collection>` and requires explicit relationship links.

- [ ] **Use a child collection** when data is tightly scoped to a parent and should not exist independently. Declare with `"type": "collection"` containing nested `fields`. Children share the parent's API path.

Relationships require two fields: an `objectid` stores the reference; a `link` declares the target and enables expansion.

```json
{
  "product_id": { "type": "objectid", "required": true },
  "product": { "type": "link", "model": "products", "key": "product_id" }
}
```

For app model targets, use FQN: `"model": "apps/<app_id>/vendors"`. For child collections: `"model": "products:variants"` or `"model": "apps/<app_id>/vendors:locations"`.

Events enable function triggers on record changes. Public permissions control frontend API access. Both are declared in the model JSON. Consult `swell schema model --format=dts` for structure, field options, and condition syntax.

## Content Models

Content models configure Admin Dashboard views in `./content/*.json`. They control how merchants interact with data: list columns, form layouts, navigation, and input behavior. As established in Section I, content models map to data model Resource IDs and define UI logic only; data logic belongs in `./models/*.json`. Content field ID must correspond to a data model field.

**Decision Guide:**

- [ ] **Augmenting standard models** applies when adding UI for fields on existing platform entities. For standard model extensions, `admin_zone` places fields within existing editor sections (e.g., `"admin_zone": "details"` on products); invalid zone values cause fields to silently disappear, so verify against `swell schema content --format=dts`. Alternatively, declare `tabs` in the edit view to add custom tab panels alongside native tabs. Extensions merge with existing UI rather than replacing it: `edit.tabs` adds alongside native tabs, `list.fields` appends to existing columns, and `list.tabs` introduces additional filtered views. Merchants can reorder or hide these additions in their dashboard preferences.

- [ ] **Creating app model views** applies to app-defined collections. Include `nav` in the list view to place the collection under a parent section in the sidebar; omitting `nav` positions it at the top level. `nav` possible values are pre-configured and you can not create a new nav section. For app-defined collections, control layout entirely through views—`admin_zone` has no effect.

Content models declare up to three views: `list` (table columns, sort, filters, navigation), `edit` (form layout for existing records), and `new` (creation form). When creation and editing share identical layouts, a single `record` view can replace both.

Fields declared in views inherit properties from matching top-level field definitions by `id`. A view field `{ "id": "rating" }` acquires label, type, and constraints from the top-level `"rating"` entry. Override selectively per view—for instance, a shorter label in list columns versus the full label in edit forms.

Layout uses `field_row` for horizontal arrangement and `field_group` for collapsible sections—both require a `fields` array (omitting it fails validation). Width is controlled via `admin_span` (1–4 on a 4-column grid). Conditions control field visibility using MongoDB-style operators: equality (`"status": "approved"`), negation (`"rewarded": { "$ne": true }`), comparison (`"count": { "$gt": 0 }`), and app settings references (`"$settings.feature.enabled": true`). Multiple conditions are AND-ed.

The `collection` content type creates inline references to other collections without duplicating data. Declare with `"type": "collection"`, target via `"collection": "products"` (or `"products:variants"` for child collections), and define the join with `"link": { "params": { "account_id": "id" } }`. This renders as a filterable list widget in the edit view.

For field types, input widgets, and all property options, consult `swell schema content --format=dts`.

```json
{
  "collection": "products",
  "fields": [
    {
      "id": "seller",
      "type": "lookup",
      "label": "Seller",
      "model": "apps/my_app/sellers",
      "key": "seller_id"
    }
  ],
  "views": [
    {
      "id": "edit",
      "tabs": [
        {
          "id": "seller_info",
          "label": "Seller Info",
          "fields": [
            { "id": "seller" }
          ]
        }
      ]
    }
  ]
}
```
Note that lookup type can be set to the fields, declared with `"type": "link"` at the data model.

## Functions

Functions implement serverless logic in `./functions/*.ts` and time out after 10 seconds.
Each function exports a `config` object specifying exactly one trigger: `model`, `route`, or `cron`. Run `swell schema function --format=dts` for function available types declaration, including `config`.

**Model Event Triggers** respond to record changes. Standard events (`created`, `updated`, `deleted`) exist on all models by default. Custom events (e.g., `review.approved`) must be declared in the data model first (see `swell schema model --format=dts`).

```typescript
export const config: SwellConfig = {
  description: "Update product ratings when reviews change",
  model: {
    events: ["review.created", "review.updated", "review.deleted"],
    conditions: { status: "approved" }, // filter invocations
  },
};

export default async function (req: SwellRequest) {
  const { swell, data } = req;
  // req.data = full record + $event metadata; see below
}
```

Conditions support MongoDB-style operators and may reference `$record`, `$data`, `$event`, `$settings`, or `$formula` (string expression) for complex cases.

Child collection events use dot notation: `review.comment.created`, `review.reaction.deleted`.

**Model Schedule Triggers** execute at a future date derived from a record field. The field must exist in the data model.

```typescript
export const config: SwellConfig = {
  description: "Capture scheduled payment",
  model: {
    events: ["payment.created", "payment.updated"],
    conditions: { date_scheduled: { $exists: true } },
    schedule: {
      formula: "date_scheduled", // evaluated against record; re-schedules on field change
    },
  },
};

export default async function (req: SwellRequest) {
  /* ... */
}
```

**Cron Triggers** execute on a fixed schedule with no record context. Subject to the same 10s timeout as other functions.

```typescript
export const config: SwellConfig = {
  description: "Recalculate product popularity daily",
  cron: { schedule: "0 0 * * *" },
};

export default async function (req: SwellRequest) {
  /* req.data is empty */
}
```

**HTTP Route Triggers** expose custom API endpoints at the fixed path `/functions/<app_id>/<function_name>` — no URL path params (no `/users/:id`-style routing); pass identifiers via query (`?id=…`) or body. Unlike other triggers, routes dispatch to a handler based on the HTTP method.

```typescript
export const config: SwellConfig = {
  description: "Submit review from storefront",
  route: {
    methods: ["post"],
    public: true, // false requires secret key authentication
    cache: { timeout: 5000 }, // ms, GET only; defaults to 5000 ms when omitted — set 0 to disable
    headers: ["x-custom-token"], // allow-list of incoming header names to forward to the function; omit to forward all
  },
};

export async function post(req: SwellRequest) {
  const { swell, data, session } = req;

  if (!session?.account_id) {
    throw new SwellError("Login required", { status: 401 }); // For errors, throw `SwellError`
  }

  return await swell.post("/reviews", {
    /* ... */
  });
}
```

**Model Event Hooks** — prefix any model event with `before:` or `after:` to run synchronously inside the originating API request (vs. async event triggers, which fire after the mutation persists). Hooks can read the pre-mutation record and mutate what gets saved.

```typescript
export const config: SwellConfig = {
  description: "Validate review rating before save",
  model: { events: ["apps/<app_id>/reviews/before:review.created"] },
};

export default async function (req: SwellRequest) {
  const { $event, $record } = req.data;  // $event.hook === 'before'; $record undefined on create
  if (req.data.rating > 5) throw new SwellError("Out of range", { status: 400 });
  return { rating: Math.round(req.data.rating) }; // merged into record being saved
}
```

- **Return-value semantics.** `before:created|updated` merges into the record being persisted. `after:created|updated` merges only into the event payload dispatched to async webhooks/notifications — it does NOT affect the stored record or the API response. `after:deleted` is the exception: its return merges into the delete response. `before:deleted` return is ignored.
- **Pre-mutation context.** `req.data.$record` holds the pre-mutation record on `before:updated` / `after:updated` only (absent on create — check with `if (!$record)`; for deletes the record itself is spread into `req.data`). Use it for state-transition checks: `$record.status !== req.data.status`.
- **Rejecting the mutation.** Throw `SwellError` to abort. Abort is only honored for hooks on **app-own models' own events** (defaults to reject; disable with `hook_reject_error: false`). Standard-model hooks (e.g. `before:product.created`) cannot abort — throws are absorbed into the response's `$function_errors` and the mutation proceeds. To block a standard-collection mutation, declare a custom hook event on an app-own model.
- **Re-entrancy.** Writes from inside a hook re-trigger the same hook chain. Guard with `conditions` or a sentinel in `$app[req.appId]` — an unconditional write-back to the same collection stalls the originating request until `hook_timeout` fires.
- **Event syntax.** Format is `<modelPath>/<hook>:<root>.<type>` — the hook prefix sits immediately before the event root, never before the model path (short form `'before:<root>.<type>'` is valid when no model path is given). The event root is the singular of the collection name (`review` for `reviews`, `product` for `products`). Short form works for standard models; use the fully-qualified `'apps/<app_id>/<model>/before:<root>.<type>'` for app-own models to avoid collisions with same-root standard models.
- **Custom hook events** must be declared in the model first: `events.types: [{ id: 'reviewed', hooks: ['before','after'], conditions: {...}, hook_timeout: 5000, hook_reject_error: true }]`. `hook_timeout` ≤ 60000 ms (overrides the function's own `config.timeout`). `hook_retry_attempts` ≤ 3 (triggers on null-status timeouts/network errors). `hook_*` knobs are valid on app-own models only.
- **One handler per app per hook event.** A second function in the same app subscribing to the same hook event (same `app_id + event.type + extension`) is logged as a conflict and silently skipped. Split work across `before`/`after` phases or combine into one handler.
- **Decision guide.** Validate/modify before save → hook. React after the fact → async model trigger. Both honor `conditions` independently.

**Handler export patterns.** The runtime resolves the handler in this order: (1) named export matching the request method, (2) default function export, (3) method on the default-exported object. Three forms work for any trigger type (model, cron, and schedule triggers always arrive as POST):

- **Named exports** — `export async function post(req) {}`, one per method. Note: `delete` is a reserved keyword in strict mode and cannot be used as a function name; use the default-object form for DELETE handlers.
- **Default function** — `export default async function(req) {}` runs for any method. Standard form for model, schedule, and cron triggers.
- **Default object** — `export default { post(req) {}, delete(req) {} }` supports all methods including `delete`.

The `req` object provides authenticated access to platform resources.

- `req.swell` is the authenticated Swell client. App collections are auto-scoped: `req.swell.get('/reviews')` equals `req.swell.get('/apps/<app_id>/reviews')`. Use `expand` to include linked records: `await swell.get('/reviews/{id}', { id, expand: ['account','product'] })`.
- `req.data` — Trigger payload. For model events: the full record fields spread in, plus `$event` metadata (`{ id, type, model, app_id, data }`). `$event.data` narrows by event type: `created`/`deleted` carry the full record snapshot, `updated` carries only the changed fields (check `'field' in req.data.$event.data` to detect what changed), custom events carry the subset declared in the model's event `fields`. Hook invocations also include `req.data.$record` (current record pre-mutation; undefined on create) and `req.data.$event.hook` is `'before'` or `'after'`. For routes: body merged with URL query params (**query keys overwrite body keys** — use `req.body` / `req.query` directly when this matters). For cron: empty.
- `req.body` / `req.query` / `req.rawBody` — Routes only. `body` is the parsed JSON object (or raw string when the body isn't JSON); `query` is URL params as `{[key]: string}`; `rawBody` is the untouched body text for HMAC/webhook signature verification (re-stringifying `body` won't byte-match the original).
- `req.appId` — App identifier. Use instead of hardcoding.
- `req.session` — User session when authenticated (routes).
- `req.store` — Store metadata including `admin_url`.
- `req.context.waitUntil(promise)` — Run work after the response returns. Caller sees the response immediately; the promise continues on the Worker until resolved or CPU time expires. Use for logs, metrics, or non-blocking side effects.
- `await req.swell.settings()` — App settings from `./settings/`.

When writing to standard model extensions, namespace under `$app`. Use `req.appValues(values)` to wrap as `{ $app: { [req.appId]: values } }`; pass `(otherAppId, values)` to target another app:

```typescript
await req.swell.put(`/products/${id}`, req.appValues({ review_count: 42, average_rating: 4.5 }));
```

Extension fields on standard models appear in responses under `$app.<app_id>.*`, not at the top level. This namespacing is automatic; no explicit expand is required to retrieve them. For app-defined collections, write fields directly at the root—you own the schema.

**Return values.** Plain object → JSON 200. String → text/plain 200. For custom status/headers, return `new SwellResponse(data, { status, headers })` or a native `Response`. Throw `SwellError(msg, { status })` for errors. Errors from `req.swell.*` expose `error.status` (HTTP status) and `error.body` (structured payload); don't parse `error.message`. Model/cron handlers typically return nothing.

**Response size.** Function response bodies are silently dropped past 75 KB. JSON larger than that reaches the caller as an unparseable string — the platform does not finalize the truncated document. Paginate rather than returning large collections.

**Auto-disable.** Model-event functions that fail continuously for ~4 days (2 days if timeout >10s; immediately on 404/worker-missing) stop receiving events until redeployed via `swell app push`. Routes and cron are unaffected.

**Local testing.** Run `swell app dev` as a background process (one app per session) to stream function execution to your terminal. Trigger model events via `swell api [post|put|delete] /<collection>`; call routes via `swell api [method] /functions/<app_id>/<function_name> --body '{...}'`. Forward caller headers with repeatable `-H 'Name: value'` (applies to `/functions/*` paths only). Caveat: `req.session` under `swell api` is the CLI admin session, not a storefront customer session — verify customer-scoped auth (e.g. `session?.account_id` gates) via integration tests.

## Settings

Settings define merchant-configurable app behavior in `./settings/*.json`. Values are accessible in functions via `await req.swell.settings()` and in model/content conditions via `$settings`.

Each settings file creates a grouped panel in the App Preferences UI. Structure: `label` (panel heading), `description` (explanatory text), and `fields` (array using content field syntax). Multiple files render as grouped panels. Settings returned by `swell.settings()` are namespaced under the filename (e.g., for `settings/new_section.json`, access values via `new_section.<field>`). `field_group` does not introduce nesting—its child fields are flattened to the parent level.

## Webhooks

Webhooks send model events to external endpoints in `./webhooks/*.json`. Use when event handling logic lives outside Swell; for Swell-hosted logic, prefer functions. Webhooks subscribe to async events only — the `before:`/`after:` hook prefix is rejected at deploy; use a function for synchronous hook semantics.

Payloads include event type, record data, store ID, and environment. Requests timeout after 30 seconds—endpoint must return HTTP 200. Retries use exponential backoff: initial retry within 1 minute, extending to 12-hour intervals after 10 failures. Webhook auto-disables after 7 days of failures; re-enabling retries all pending events.

Embed API secrets directly in the URL query string. Validate the secret server-side when receiving requests.

## Notifications

Notifications are transactional emails triggered by model events, defined in `./notifications/` using a paired-file convention: a JSON manifest (`<name>.json`) and a Liquid template (`<name>.tpl`) must share the same base filename. Consult `swell schema notification --format=dts` for all configuration properties.

**Event binding.** The `event` property must reference either a standard event (`created`, `updated`, `deleted`) or a custom event already declared in the collection's data model. Attempting to bind to an undeclared custom event causes deployment failure.

**Recipient resolution.** Set `contact` to a dot-notation path resolving to an email field (e.g., `"contact": "account.email"`), or set `admin: true` for store administrator delivery. Critical: any relationship in the contact path must appear in `query.expand`—`"contact": "account.email"` requires `"expand": ["account"]`.

**Child collections.** Use colon notation for the collection (`"collection": "reviews:comments"`). In templates, the parent record is accessible via the `parent` variable; expand upward with `"expand": ["parent", "parent.product"]`.

The `.tpl` file uses Liquid syntax. Record fields are accessed directly (`{{ product.name }}`), child collection parents via `{{ parent.field }}`. Three global objects are available in all templates:

`settings` — App settings from `./settings/`, enabling conditional content: `{% if settings.rewards.enabled %}...{% endif %}`.

`store` — Store metadata: `name`, `url`, `logo`, `currency`, `support_email`.

`get(url, data)` — Helper for fetching additional Swell data during rendering.

Admin-editable fields defined in the manifest's `fields` array are accessed via `{{ content.field_id }}`. Standard Liquid filters apply: `{{ date_created | date: '%b %d, %Y' }}`, `{{ amount | currency }}`.

Build templates with MJML for cross-client email compatibility, then convert to HTML.
