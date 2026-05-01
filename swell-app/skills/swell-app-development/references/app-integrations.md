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

Do not assume that deploying a function with a matching event makes it run in every native flow. Extension hook dispatch is filtered by platform flow and extension identity:

- the native flow determines an app id and an extension id;
- the function must subscribe to the relevant platform event;
- the function's `config.extension`, when present, must match the selected extension id.

Native settings are the source of that selection. Verify the exact selection path before debugging function code.

| Extension type | Native settings path | Settings key | Multi-instance? |
|----------------|----------------------|--------------|-----------------|
| Payment, alternative method | `/settings/payments/methods/<extension.id>` | `extension.id` (e.g. `revolut`). NOT `app_<appId>_<extensionId>`. | yes — one method record per extension `id` |
| Payment, card gateway | `/settings/payments/methods/card` | `card` (fixed). Admin auto-creates a separate gateway record at `/settings/payments/gateways/app_<appId>_<extensionId>`. | one card gateway active at a time |
| Shipping | `/settings/shipments/carriers/app_<appId>_<extensionId>` | the carrier `id` IS `app_<appId>_<extensionId>` (canonical, not "commonly") | yes — multiple enabled carriers |
| Tax | `/settings/taxes` (top-level — NOT nested under any sub-collection) | n/a — `extension_app_id` / `extension_config_id` are stored directly on the taxes settings record | exactly one tax extension active |

Asymmetry warning: payment alt methods key on `extension.id`, shipping carriers key on `app_<appId>_<extensionId>`, taxes use top-level fields with no key at all. Build the inspection path from this table — do not reuse the same shape across extension types.

How `extension.method` selects the binding for payment extensions:

- `extension.method === 'card'` (or `extension.id === 'card'` when `method` is unset) → the extension is a card gateway, bound at `/settings/payments/methods/card`.
- any other `extension.method` value, or unset → the extension is an alternative method, bound at `/settings/payments/methods/<extension.id>`.

`extension_config_id` is normally the manifest extension `id`. If it is absent/null, the platform can dispatch app-level functions that do not set `config.extension`; do not rely on this fallback for ordinary extension apps. For app-extension work, keep `swell.json` extension `id`, native `extension_config_id`, function `config.extension`, and component `config.extension` identical.

This means extension verification always needs three checks:

1. The app resources deployed successfully.
2. The native settings select the intended app id and extension id.
3. The function/component config uses the same extension id.

Concrete verification probes:

```bash
swell inspect functions --app=.
swell inspect settings payments
swell inspect settings shipments
swell inspect settings taxes
swell logs --type function --app=.
```

Use the settings probes that match the extension type. Look for `extension_app_id` and `extension_config_id` in native settings or calculated records, then confirm function logs for the expected event.

When direct API probing is easier than reading the full settings record, use the native setting paths corresponding to the extension type:

```bash
# Payment alt method: <extension.id> is the key (e.g. "revolut")
swell api get '/settings/payments/methods/<extension.id>'

# Payment card gateway: method record is fixed to "card"; gateway record uses the app_<appId>_<extensionId> key
swell api get '/settings/payments/methods/card'
swell api get '/settings/payments/gateways/app_<appId>_<extensionId>'

# Shipping: carrier id IS app_<appId>_<extensionId>
swell api get '/settings/shipments/carriers/app_<appId>_<extensionId>'

# Tax: top-level — extension fields live on the taxes settings record itself
swell api get '/settings/taxes'
```

If a function never runs, debug selection in this order:

1. The app is installed in the target environment.
2. The relevant native settings contain the app id in `extension_app_id`.
3. The native settings contain the intended extension id in `extension_config_id`.
4. The app function has the matching `config.extension` and event/hook phase.
5. The platform flow is actually exercising the method/carrier/tax setting under test.

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
