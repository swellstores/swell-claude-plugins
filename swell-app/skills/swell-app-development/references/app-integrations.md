# Integration Apps

Integration apps declare platform extension slots in `swell.json`. They are still normal Swell apps: settings deploy from `./settings/`, functions deploy from `./functions/`, assets deploy from `./assets/`, and app settings are read with `req.swell.settings()` like any other app.

The difference is architectural: extension slots allow native platform flows to find app-provided behavior for payment, shipping, or tax.

## Manifest Shape

Use the CLI where possible:

```bash
swell create app my_payment --type integration --integration-type payment --integration-id my_method -y
```

Minimal extension manifest:

```json
{
  "id": "my_payment",
  "name": "My Payment",
  "type": "integration",
  "version": "1.0.0",
  "permissions": [],
  "extensions": [
    {
      "id": "my_method",
      "type": "payment"
    }
  ]
}
```

Extension field support is platform-branch dependent. Before using optional fields, inspect the current app model/schema or an existing known-good app on the target branch. The current platform branch exposes these extension fields:

| Field | Applies to | Purpose |
|-------|------------|---------|
| `id` | all extension types | Required stable extension config id. Must be unique within the app. |
| `type` | all extension types | Required extension category: `payment`, `shipping`, or `tax`. |
| `name` | all extension types | Display name in Admin settings. Falls back to app name. |
| `description` | all extension types | Display text in Admin settings. Falls back to app description. |
| `setting` | all extension types | Optional settings config name to render for this extension. If absent, Admin looks for a settings config whose name matches the extension `id`. |
| `method` | payment | Payment method id. Defaults to the extension `id`; use `"card"` for card gateway replacement. |
| `gateway` | payment | Payment gateway identifier/display metadata for card gateway style integrations. |
| `method_logo_src`, `method_icon_src` | payment | Extension method display assets by source path/URL when supported by the deployed app installer. |
| `gateway_logo_src`, `gateway_icon_src` | payment | Extension gateway display assets by source path/URL when supported by the deployed app installer. |
| `carrier` | shipping | Shipping carrier id. Defaults to the extension `id`. |
| `carrier_logo_src`, `carrier_icon_src` | shipping | Shipping carrier display assets by source path/URL when supported by the deployed app installer. |

Apps can also deploy `extension_assets[]` with image file fields keyed by extension asset `id` (`method_*`, `gateway_*`, and `carrier_*` images). Use this for Admin-rendered icons/logos when the platform installer supports asset upload.

Payment extensions may contain untyped fields that are not present in the typed extension schema but are still consumed by Admin/checkout. The most important is `subscriptions` on `payment` extensions:

- `"subscriptions": true` on a payment extension entry tells the storefront that the alt method is selectable for carts containing subscription products. The BFF (swell-admin/server/api/checkout/index.js) reads the deployed `swell.json` and filters the method out of the storefront payment list whenever the cart has `subscription_delivery: true` and the extension does not set `subscriptions: true`.
- Without the flag, the method is silently absent from the storefront for subscription carts even though the extension is installed and configured.
- Set it on payment extensions whose provider supports recurring or subscription billing; omit it for one-time-only methods.

Other untyped extension fields should be treated as branch/runtime-specific product contracts: preserve them when editing a known-good app, but do not add new ones unless you have verified the current platform branch consumes them. Before adding or depending on an untyped extension field:

- inspect the current app model/schema;
- search platform/admin/checkout code for the exact field;
- confirm behavior in a deployed test store.

Extension ids are the stable join key between:

- `swell.json` extension entry: `"id": "my_method"`;
- functions: `config.extension = "my_method"`;
- components: `config.extension = "my_method"`;
- the platform flow that selects an app id and extension id.

## Extension Types

Supported extension categories:

| Type | Native flow | Common app resources |
|------|-------------|----------------------|
| `payment` | payment method, gateway, intent, charge, refund | `settings/`, `functions/`, optional `components/` |
| `shipping` | shipment rating | `settings/`, `functions/` |
| `tax` | tax calculation | `settings/`, `functions/` |

Generic integrations use `"type": "integration"` without `extensions[]`. They are useful for apps that connect to third-party services but do not bind into native payment/shipping/tax flows.

## Binding Model

Deploying a function with a matching event does not make it run. Hook dispatch is filtered by platform flow and extension identity: the native flow selects an app id and an extension id, and the function's `config.extension` must match.

Run `swell inspect extensions [--app=.]` for the activation chain — manifest, native bindings (with per-field `field_checks`), bound functions/components, required events, and a labeled `status`. Detail mode (`app.<slug>.<extId>`) emits a JSON envelope followed by a `Next steps:` footer of runnable shell commands per status; merchant-UI steps are prefixed `(merchant)`.

Three structured fields drive routing:

- `status` — labeled outcome of a first-failure-stops algorithm (`activated`, `not activated`, `app id mismatch`, `id mismatch`, `not selected`, `gateway missing`, `not enabled`, `no handler`, `handler mismatch`, `not deployed`). Match on these strings, not the colloquial type-tagged form.
- `action_owner` — `dev` (you), `merchant` (user must perform a UI step), or `null` (no action needed when activated).
- `action` — pre-formatted next-step string. Use verbatim.

Non-obvious invariants the structured output doesn't make self-evident:

- **Shipping is the only type where `enabled: false` blocks dispatch.** Payment-alt and tax dispatch fire whenever `extension_app_id` is set; for payment-alt, `enabled` is a checkout-visibility toggle only.
- **`missing_required_events` is separate from `status`.** Partial event coverage stays `activated`; check the field independently.
- **Identifier shape:** use `app.<slug>.<extId>` from list mode column 1. Hex ids from `bound.functions[].id` or `bound.components[].id` are not accepted — extensions are a synthesized resource with no canonical 24-char id.
- **`local_diff` non-null** means the deployed app record's manifest differs from local `swell.json` — `swell app push` before debugging dispatch.

Extension ids are the stable join key between `swell.json` extension `"id"`, function `config.extension`, component `config.extension`, and platform `extension_config_id`. Keep them identical.

## Settings

Settings behave like ordinary app settings. A setting file such as `settings/revolut.json` deploys as app settings and can be read from functions with:

```typescript
const settings = await req.swell.settings();
```

When a function needs one settings group explicitly, pass the app/config id:

```typescript
const settings = await req.swell.settings(`${req.appId}/revolut`);
```

Use settings for merchant credentials, feature flags, and runtime options. Do not invent extension-specific settings semantics unless the current platform code or product requirement explicitly calls for them.

Admin extension settings panels choose which `settings/*.json` config to render using this order:

1. If the app has exactly one setting config and exactly one extension, render that setting.
2. If the extension has a `setting` value, render the setting config with that name.
3. Otherwise render the setting config whose name matches the extension `id`.

For example, an extension `{ "id": "revolut" }` naturally maps to `settings/revolut.json`. If an app exposes multiple extensions that share one settings group, set each extension's `setting` property to that shared settings config name.

Only settings fields marked `"public": true` are safe to expose to checkout/browser components. Provider secrets must remain non-public and be read only from functions.

## Assets

`assets/icon.*` remains the app icon. Extension manifests can also reference payment/shipping-specific icon or logo asset paths, but asset details are platform-schema dependent. Check the current app model/schema before adding extension asset fields.

## Design Checklist

Before editing an integration app, answer:

- Which extension type is this: payment, shipping, tax, or generic?
- What is the extension id?
- Which native platform flow should select this extension?
- Which functions are required for that flow?
- Does the flow need a checkout/browser component?
- Which settings are credentials/options, and are they ordinary app settings?
- How will you prove the native flow selected this app and extension?

Then read the type-specific reference before implementing:

- `payment-extensions.md`
- `shipping-tax-extensions.md`
