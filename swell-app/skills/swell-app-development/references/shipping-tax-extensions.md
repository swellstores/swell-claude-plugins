# Shipping And Tax Extensions

Shipping and tax extensions bind integration apps into native order calculation flows. They usually require:

- `swell.json` with `shipping` or `tax` extension entries;
- app settings for provider credentials/options;
- extension hook functions on `order.shipping` or `order.taxes`.

Use `app-integrations.md` first for manifest and binding basics.

## Shipping Manifest

```json
{
  "type": "integration",
  "extensions": [
    {
      "id": "fedex_rates",
      "type": "shipping",
      "carrier": "fedex"
    }
  ]
}
```

Use `carrier` when the extension should bind to or present as a specific carrier. Check the current app schema before adding carrier icon/logo fields.

## Tax Manifest

```json
{
  "type": "integration",
  "extensions": [
    {
      "id": "tax_service",
      "type": "tax"
    }
  ]
}
```

The platform flow decides which tax extension id is applicable for calculation. Verify that selection before assuming the function will run.

## Hook Phases And Result Merging

Shipping and tax extension events are model hooks owned by the platform order calculation flow. Use explicit hook phases in function configs:

| Event | Recommended phase | Purpose |
|-------|-------------------|---------|
| `after:order.shipping` | `after` | Add or replace shipment rating services after the platform initializes `shipment_rating` and any standard rating/webhook work has run. |
| `before:order.shipping` | optional `before` | Prepare data before standard shipping rating; use only when the app must affect inputs before native rating. |
| `before:order.taxes` | common `before` | Calculate taxes when the selected app replaces internal tax calculation. |
| `after:order.taxes` | optional `after` | Post-process calculated taxes or handle flows where taxes should be adjusted after native/webhook work. |

Bare extension events such as `order.shipping` or `order.taxes` default to the platform-defined extension phase (`after` in the current hook mapper). Prefer explicit phases so future readers can tell whether the function is meant to run before or after native calculation.

Hook results are merged into the order calculation event data. Declare `model.fields` for top-level fields the function intentionally returns, such as `shipment_rating`, `items`, or `taxes`. Return only fields the platform should mutate.

## Shipping Function

Shipping extensions use the `order.shipping` hook:

```typescript
export const config: SwellConfig = {
  extension: "fedex_rates",
  description: "Rate shipment",
  model: {
    events: ["after:order.shipping"],
    conditions: {},
    fields: ["shipment_rating"],
  },
};

export default async function (req: SwellRequest) {
  return {
    shipment_rating: {
      services: [
        {
          id: "fedex_ground",
          name: "FedEx Ground",
          price: 10,
          carrier: "fedex",
        },
      ],
    },
  };
}
```

The hook receives order/cart-like data including shipping address, items, currency/locale context, and any existing `shipment_rating.services` produced by standard services, webhooks, or earlier hooks. Return fields are merged into the native flow result.

When a shipping carrier is configured with `extension_app_id`, the platform triggers that app for shipping rating. Standard rating can still run for non-extension services/carriers. In an `after:order.shipping` function, preserve existing `shipment_rating.services` unless the app intentionally replaces them.

This shape is based on current platform tests and sample behavior. Confirm the exact payload in function logs before depending on additional fields.

Returned service objects should use stable ids and include enough display/rating data for checkout/admin:

- `id`;
- `name`;
- `price`;
- optional `description`;
- optional `carrier`;
- optional provider metadata needed later by the app.

## Tax Function

Tax extensions use the `order.taxes` hook:

```typescript
export const config: SwellConfig = {
  extension: "tax_service",
  description: "Calculate taxes",
  model: {
    events: ["before:order.taxes"],
    conditions: {},
    fields: ["items", "taxes"],
  },
};

export default async function (req: SwellRequest) {
  const item = req.data.items?.[0];

  return {
    items: [
      {
        id: item.id,
        taxes: [
          {
            id: "provider_tax",
            amount: 5,
          },
        ],
      },
    ],
    taxes: [
      {
        id: "provider_tax",
        name: "Sales Tax",
        amount: 5,
      },
    ],
  };
}
```

Return both per-item tax assignments and order-level tax totals when the provider supplies them. Keep ids stable so downstream recalculation and display remain deterministic.

When tax settings select an app extension with `extension_app_id`, the platform skips internal tax rule calculation and relies on the extension result. That makes the tax function authoritative for the tax fields it returns.

This shape is based on current platform tests and sample behavior. Confirm the exact payload in function logs before depending on additional fields.

## Hook Semantics

Shipping and tax extension events are platform-owned hooks. The native flow determines which extension ids are applicable, then dispatches matching functions.

Important implications:

- `config.extension` should match the manifest extension id.
- A function with `events: ["order.shipping"]` or `events: ["order.taxes"]` is not enough if the flow did not select the app/extension.
- If no `before:` or `after:` prefix is supplied, extension events can default to the platform-defined hook phase. Prefer explicit phases.
- Returned objects are merged into the order calculation payload; return only fields you intend to mutate.
- Keep one handler per app/extension/event/phase unless the platform explicitly supports multiple functions for that combination. If multiple functions from the same app match the same event/extension/phase, only one result is usable and the platform logs a conflict.

## Settings

Read provider credentials and options as normal app settings:

```typescript
const settings = await req.swell.settings();
```

If the app has multiple settings groups and a function needs one explicitly:

```typescript
const settings = await req.swell.settings(`${req.appId}/provider`);
```

Do not assume settings deploy, install, or access differently for shipping/tax extensions.

## Merchant Activation

A successful `swell app push` does not activate a shipping or tax extension. The merchant must perform UI steps in the target store before native dispatch will pick the extension up. Code-only agents cannot perform these steps; when an extension is freshly deployed, surface them to the user as a manual verification step before debugging missing dispatch as a code problem.

### Shipping

1. **Install the app** in the store.
2. **Open Settings → Shipping.** The declared shipping extension appears as a carrier row.
3. *(optional, when the extension exposes its own settings)* Click **Edit settings**, fill in provider credentials, and Save the dialog (this writes the per-extension `appSettings`).
4. **Toggle the carrier `enabled`** on the row and click **Save changes** at the page level. The page form persists `carriers.<extensionId>.enabled = true` together with hidden `carriers.<extensionId>.extension_app_id` and `carriers.<extensionId>.extension_config_id` fields. Without all three (`enabled`, `extension_app_id`, `extension_config_id`), `order.shipping` does NOT dispatch to the extension.

### Tax

Tax extensions are bound at the top level of `/settings/taxes`, not per extension, so only one tax extension can be active per store at a time.

1. **Install the app** in the store.
2. **Open Settings → Taxes.** The declared tax extension appears as a row.
3. *(optional)* Click **Edit settings**, fill in provider credentials, and Save the dialog.
4. **Toggle the extension on** and click **Save changes** at the page level. Toggling another tax extension on later automatically replaces the previous one (the admin form holds a single `enabled` slot). Saving writes top-level `extension_app_id` and `extension_config_id` onto `/settings/taxes`. Without those two fields set, `order.taxes` does NOT dispatch to any extension and the platform falls back to its internal tax rules.

## Verification Checklist

Shipping:

- app deploys and extension is visible in the target store/admin context;
- `swell inspect functions --app=.` shows the shipping function with the expected `extension` and event;
- `swell inspect settings shipments` or the admin shipping settings show the native shipping flow selecting the intended app id and extension id. The carrier record at `/settings/shipments/carriers/<extensionId>` has `enabled = true`, `extension_app_id` set, and `extension_config_id` set. If any of the three is missing, the merchant has not yet completed Merchant Activation (toggle + Save changes on Settings → Shipping);
- changing shipping address or cart contents triggers `order.shipping`;
- returned services appear in `shipment_rating.services`;
- logs show the function invocation and provider response.

Tax:

- app deploys and extension is visible in the target store/admin context;
- `swell inspect functions --app=.` shows the tax function with the expected `extension` and event;
- `swell inspect settings taxes` or the admin tax settings show the native tax flow selecting the intended app id and extension id. `/settings/taxes` has top-level `extension_app_id` and `extension_config_id` matching the deployed extension. Tax has only ONE active extension per store; if a different app is bound, the merchant must toggle this extension on (which auto-disables the other) and Save changes;
- order/cart recalculation triggers `order.taxes`;
- returned `items[].taxes` and `taxes[]` persist on the calculated record;
- logs show the function invocation and provider response.

When behavior is unclear, first add temporary structured logs of `req.data` to the extension functions in a test environment, trigger the native flow, and inspect `swell logs --type function --app=.`. Remove noisy logs before finalizing.

## Common Mistakes

- Treating `order.shipping` or `order.taxes` as ordinary async model events.
- Forgetting `config.extension`.
- Returning a full provider response instead of the narrow fields the platform should merge.
- Returning tax totals without item-level tax details when downstream flows expect item taxes.
- Assuming deploy alone proves the native flow selected the extension.
