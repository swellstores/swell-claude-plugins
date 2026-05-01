# Payment Extensions

Payment extensions provide custom payment methods or card gateway behavior through an integration app. They commonly combine:

- `swell.json` with a `payment` extension;
- app settings for provider credentials;
- optional `components/*.tsx` checkout UI;
- extension hook functions for intent, charge, and refund.

Use `app-integrations.md` first for manifest and binding basics.

## Manifest

Alternative payment method:

```json
{
  "type": "integration",
  "extensions": [
    {
      "id": "revolut",
      "type": "payment"
    }
  ]
}
```

Card gateway integration uses the `card` payment method slot:

```json
{
  "extensions": [
    {
      "id": "card",
      "type": "payment",
      "method": "card"
    }
  ]
}
```

Use a custom id for an alternative payment method. Use `card` only when the app is intended to handle card processing.

Set `"subscriptions": true` on the payment extension entry when the method must be selectable for subscription carts. The BFF filters payment methods on carts with `subscription_delivery: true` and only retains app-extension methods whose deployed `swell.json` extension entry sets this flag. Without it, the method is silently absent from the storefront for any subscription cart even though the extension is otherwise installed and configured. Omit it for one-time-only methods.

Other optional payment extension fields such as `gateway`, icon/logo sources, or further untyped flags are platform-schema dependent. Check the current app schema/model before using typed fields. Preserve untyped fields found in an existing known-good app, but do not add or rely on them in new apps unless the target branch/runtime has a verified consumer.

## Native Payment Binding

Deploying a payment extension does not make checkout use it automatically. The native payment settings must select the app and extension, and checkout must submit the matching payment method.

The binding shape depends on whether the extension is a card gateway or an alternative method, controlled by `extension.method`:

- `extension.method === 'card'` (or `extension.id === 'card'` when `method` is unset) → card gateway. Native record is `/settings/payments/methods/card`. When the merchant saves the extension settings dialog, admin creates a gateway record at `/settings/payments/gateways/app_<appId>_<extensionId>` and writes `methods.card.gateway = "app_<appId>_<extensionId>"` along with `methods.card.extension_app_id` / `methods.card.extension_config_id`.
- any other `extension.method` value, or unset → alternative method. Native record is `/settings/payments/methods/<extension.id>` (the extension's manifest id IS the method key — not `app_<appId>_<extensionId>`). When the merchant saves the extension settings dialog, admin writes `methods.<extension.id>.gateway = "app_<appId>_<extensionId>"` along with `extension_app_id` / `extension_config_id`.

These admin writes do NOT happen on app install. They happen the first time the merchant opens the extension's settings dialog under Settings → Payments and clicks Save. Until then, the method record has no `gateway` or `extension_app_id`, and checkout silently skips it: `swell-checkout/src/utils/payment.js` filters app extension methods with `Boolean(method.extension_app_id) && Boolean(method.gateway)`, and `Payment.js` only instantiates checkout components for the methods that pass that filter. A successful `swell app push` followed by "my method does not appear in checkout" almost always means this merchant save step is missing.

For a Revolut-style alternative method with `{ "id": "revolut", "type": "payment" }`, the method id is `revolut`. Native settings must include:

```text
/settings/payments/methods/revolut.extension_app_id = <app_id>
/settings/payments/methods/revolut.extension_config_id = revolut
/settings/payments/methods/revolut.gateway          = app_<app_id>_revolut
```

Checkout must persist:

```typescript
await updateCart({
  billing: {
    method: "revolut",
    revolut: {
      token: providerPaymentMethodId,
    },
  },
});
```

For a card gateway replacement, the method id is `card`, so native selection lives under `/settings/payments/methods/card`. The extension id still comes from the manifest entry and must match `methods.card.extension_config_id` and `config.extension`. The gateway record at `/settings/payments/gateways/app_<appId>_<extensionId>` is the metadata target and is created when the merchant saves the extension settings.

Verify payment binding before debugging function code:

```bash
swell inspect functions --app=.
# Alt method: key is the extension id (e.g. "revolut")
swell api get '/settings/payments/methods/<extension.id>'
# Card gateway: method key is fixed; gateway key is app_<appId>_<extensionId>
swell api get '/settings/payments/methods/card'
swell api get '/settings/payments/gateways/app_<appId>_<extensionId>'
swell logs --type function --app=.
```

Look for the deployed function's `extension`, the native method's `extension_app_id` and `extension_config_id` (BOTH must be set — `extension_app_id` alone is not enough; `gateway` must also equal `app_<appId>_<extensionId>` or checkout's filter will drop the method), and function logs after exercising the real checkout/payment flow. Direct function calls do not prove that the native payment flow selected the extension. If `extension_app_id` or `gateway` is missing, the cause is almost always that the merchant has not yet saved the extension settings dialog — direct the merchant to Settings → Payments, open the extension entry, configure required fields, and Save.

## Checkout Component

Payment methods that need custom browser UI can add a top-level component file:

```text
components/RevolutPay.tsx
```

The file must provide BOTH a named `config` export and a `default` export of the component function. The bundler validates only `config`; if the default export is missing, the bundle deploys successfully and the runtime renders nothing. Wrap the default export with `memo()` from `preact/compat` to avoid redundant re-renders when checkout pushes new props.

```typescript
import { memo } from "preact/compat";

export const config: SwellConfig = {
  extension: "revolut",
  description: "Revolut Pay via Stripe",
};

function RevolutPay(props: SwellData) {
  // ...
}

export default memo(RevolutPay);
```

The component is bundled for the browser with Preact. Keep Node-only APIs, server-side provider SDKs, and secret-bearing modules out of component code. Browser-safe helpers placed under `components/lib/` may be imported from `functions/` — the `revolut_pay` sample shares pure currency math from `components/lib/stripe.ts` into `functions/revolut-charge.ts` this way. Never import the other direction: `functions/` modules may carry secrets, Node-only dependencies, or platform-only APIs and must not reach the browser bundle.

### TypeScript Configuration

Component-bearing apps need Preact JSX and the Swell app type declarations. Minimum compiler options:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "types": ["@swell/app-types"]
  }
}
```

Without `jsxImportSource: "preact"`, JSX in `components/*.tsx` resolves to React types and rejects Preact-only hooks/props. Without `types: ["@swell/app-types"]`, ambient types such as `SwellConfig` and `SwellData` are unresolved.

Observed injected props from the Revolut payment component:

| Prop | Purpose |
|------|---------|
| `settings` | Public/browser-safe app settings for the extension UI |
| `loadLib(id, url)` | Load a third-party browser SDK once |
| `registerHandlers({ onSubmit, handleRedirect })` | Register checkout lifecycle handlers |
| `createIntent(data)` | Ask the platform to invoke the payment intent flow |
| `updateCart(data)` | Persist billing method/token/intent data on the cart |
| `onReady()` | Resolve the platform's mount promise. Submit stays disabled until this is called — see Lifecycle Recipe step 6. |
| `cart` | Current cart data such as totals and currency |

Do not invent additional component props. If a component needs more data, first confirm the checkout runtime exposes it or pass it through cart/settings-supported paths.

### Lifecycle Recipe

Use this lifecycle for a custom payment method component:

1. Export `config.extension` matching the manifest extension id, and `export default` the component function (wrap with `memo()` from `preact/compat` to avoid redundant re-renders when checkout pushes new props).
2. Render only component-owned DOM and target it via `useRef`. The platform wraps the component in a managed container with id `${component.name}-${component.id}-app-extension-component` and renders the default-exported component into it via Preact; the id is dynamic, so mount third-party SDK widgets (Stripe Elements, etc.) into a ref attached to your own returned element rather than looking up the platform container by id.
3. Register checkout lifecycle handlers with `registerHandlers({ onSubmit, handleRedirect })`.
4. Load third-party browser SDKs with `loadLib(id, url)` rather than injecting duplicate script tags.
5. Initialize/mount provider UI using public settings and current cart totals/currency.
6. Call `onReady()` exactly once when the component is interactive. The `onReady` prop is the resolver for the platform's mount promise; the component status stays `MOUNTED` until it is called, and `swell-checkout`'s `isSubmitDisabled()` keeps the entire payment-step submit button disabled while any component is `MOUNTED`. Forgetting `onReady()` softlocks the whole checkout submit, not just the payment widget. For redirect-return flows that do not remount provider UI, call `onReady()` as soon as the component has enough state to continue.
7. In `onSubmit`, validate/submit provider UI first, then call `createIntent(data)` if provider-side browser intent/session data is required.
8. Persist `billing.method` to the extension payment method id before confirmation when checkout needs the cart to reflect the selected method.
9. Persist provider token/payment method data under `billing.<methodId>`.
10. Persist provider intent/session identifiers under `billing.intent.<providerId>`.

The component owns shopper interaction and browser-only provider authorization. Server-side capture, authorization validation, and refunds belong in extension functions.

### Billing Persistence Contract

The payment method id is the extension `method` value if provided, otherwise the extension `id`. For a Revolut-like method with `id: "revolut"`, checkout should persist:

```typescript
await updateCart({
  billing: {
    method: "revolut",
    revolut: {
      token: providerPaymentMethodId,
    },
    intent: {
      stripe: {
        id: providerIntentId,
      },
    },
  },
});
```

The backend payment hook receives method-specific billing details under `req.data[methodId]`, for example `req.data.revolut`. It also receives existing intent/transaction details such as `req.data.intent` and `req.data.transaction_id`. If the component stores the token under the wrong method id, the charge function will not find it.

Use a stable provider namespace under `billing.intent` (`stripe`, `paypal`, provider id, etc.) so charge/refund functions can retrieve or continue provider-side state. Store only browser-safe identifiers and tokens on the cart; never persist secret keys or raw provider responses.

### Intent Request Contract

`createIntent(data)` inside a checkout component is a checkout-injected helper, not the raw `swell.payment.createIntent` API. In extension components, pass the provider/browser intent payload directly:

```typescript
const { client_secret } = await createIntent({
  amount: toSubunits(cart.capture_total, cart.currency),
  currency: cart.currency,
});
```

Checkout routes that payload to the selected payment extension's `payment.create_intent` hook. The server function receives it under `req.data.intent`. Do not include secret keys, non-public settings, raw provider responses, or full cart/account objects in the intent payload.

When calling the lower-level payment intent API outside the checkout component runtime, first verify the active API contract. Platform/Vault-level calls may require a wrapper shape such as `{ gateway, intent }`, while the checkout component helper intentionally hides that routing detail for the selected extension.

### Redirect Handling

If the provider can redirect away from checkout:

- register `handleRedirect` through `registerHandlers`;
- read provider return params from the callback argument or `window.location.search`;
- verify the provider redirect status before updating the cart;
- retrieve browser-safe provider state if needed;
- persist method-specific token and intent data with `updateCart`;
- throw a shopper-readable error when authorization fails so checkout can surface failure.

Redirect handlers should be idempotent. A shopper may reload the return URL, and the component may initialize more than once. Guard one-time initialization with component state/refs.

Do not hardcode provider secrets in components. Public keys may come from app settings; secret keys must stay in functions.

## Hook Phases And Result Merging

Payment extension events are synchronous extension hooks owned by the platform payment flow, not ordinary async model events. They run inside the native intent, charge, and refund flows and their returned objects are merged back into the platform payload before the flow completes.

Use explicit hook phases in function configs when authoring new apps. Bare extension events such as `payment.charge` are still hook events: current platform code maps them to the `after` phase by default. The platform's own extension test fixtures (`api/com/features/payments/extensions.test.js`) uniformly subscribe with explicit prefixes (`before:payment.charge`, `after:payment.charge`, `before:payment.refund`); treat those tests as the canonical pattern source. The `revolut_pay` sample uses unprefixed events and relies on the implicit `after` default — that works, but is the minimal shape, not the recommended one.

| Event | Phase options | Purpose |
|-------|---------------|---------|
| `after:payment.create_intent` | `after` only — `before:` is rejected at deploy with `EventHookTypeError` | Create provider-side browser intent/session data and return it to checkout. |
| `after:payment.get_intent` | `after` only — `before:` is rejected at deploy with `EventHookTypeError` | Retrieve in-flight provider intent state. Invoked by the platform's `Vault.getIntent` when the native flow needs to refresh provider state (e.g. recovering after a redirect return). The `revolut_pay` sample does not implement this hook; verify the request payload and the calling flow in `swell logs` before relying on it in production. |
| `before:payment.charge` / `after:payment.charge` | `before` or `after` | Authorize or capture payment and return `success`, `error`, and `transaction_id`. |
| `before:payment.refund` / `after:payment.refund` | `before` or `after` | Refund or void provider transactions and return `success`, `error`, and `transaction_id`. |

For `payment.charge` and `payment.refund`, choose `before:` when provider work should happen before any standard/native processing for the method, and choose `after:` when intentionally relying on the extension flow's post-processing/default merge point. When a payment method is configured with `extension_app_id`, the platform skips the native payment handler for that method, so the selected extension function is authoritative for the provider outcome in either phase. Prefer explicit phases so future readers do not have to know the platform's bare-event default.

Payment hooks merge returned object fields into the payment/refund event data. Production app functions should declare `model.fields` for every top-level field the function intentionally returns. Current platform code does not strictly reject undeclared result fields yet, but tests and the function schema support this contract and future enforcement is expected. Return only fields the platform should persist or use downstream.

The `revolut_pay` sample omits `model.fields` in its function configs. Treat that as a minimal sample shape, not the recommended production pattern. When generating or editing customer-authored apps, include:

| Function | Required returned fields to declare |
|----------|-------------------------------------|
| Intent creation | `["result", "error"]` |
| Charge | `["success", "error", "transaction_id"]` |
| Refund | `["success", "error", "transaction_id"]` |

## Payment Intent Function

Use `payment.create_intent` when checkout needs provider-side intent/session data before confirmation:

```typescript
export const config: SwellConfig = {
  extension: "revolut",
  description: "Create payment intent",
  model: {
    events: ["after:payment.create_intent"],
    conditions: {},
    fields: ["result", "error"],
  },
};

export default async function (req: SwellRequest) {
  const { account, intent } = req.data;
  // Create provider intent/session.
  return {
    result: {
      client_secret: "...",
      payment_intent_id: "...",
    },
  };
}
```

Return contract:

- success: `{ result: { ...providerData } }`;
- failure: `{ error: "Merchant-readable message" }`.

The platform passes the returned `result` back to the checkout caller. Keep this payload small and limited to browser-safe data. In the checkout component flow, `req.data.intent` contains the object passed to `createIntent(data)`.

Observed request shape includes `req.data.account` and `req.data.intent`. Account context depends on the checkout/platform caller; handle guest checkout or missing account data defensively, and confirm the current payload in function logs before depending on additional fields.

## Charge Function

Use `payment.charge` to authorize and capture the payment. The example uses an explicit `after:` phase to match the current bare-event default; use `before:` instead when the provider call must run before other payment hook processing.

### Two-Phase Auth/Capture Contract

The default order payment flow invokes `payment.charge` **twice**, not once:

1. First call with `req.data.captured === false`: authorize the provider intent without capturing funds. The order flow creates the payment record with `captured: false` (`api/com/features/orders/payments.js`), which triggers the charge handler.
2. Second call with `req.data.captured === true`: capture the previously authorized intent. The order flow updates the payment to `captured: true`, which triggers the charge handler again via the platform's record/data transition trigger (`api/com/features/payments/index.js` `methods.charge`).

This is the platform default — it is not optional and not specific to redirect flows. The platform's own extension test (`api/com/features/payments/extensions.test.js`) asserts that a single order creation produces exactly two `payment.charge` invocations with `captured: false` then `captured: true`.

A single-shot handler that always calls "create + capture" on the provider will succeed on the authorize call (capturing too early) and then fail or double-charge on the capture call. The canonical handler shape is two-branched and idempotent on the existing provider intent id:

```typescript
export const config: SwellConfig = {
  extension: "revolut",
  description: "Charge payment",
  model: {
    events: ["after:payment.charge"],
    conditions: {},
    fields: ["success", "error", "transaction_id"],
  },
};

export default async function (req: SwellRequest) {
  const { amount, currency, captured, intent, transaction_id } = req.data;

  try {
    const provider = getProviderClient(req);
    const existingIntentId = intent?.<provider>?.id || transaction_id;

    // Resolve or create the provider intent. Idempotent on existing id.
    const providerIntent = existingIntentId
      ? await provider.retrieveIntent(existingIntentId)
      : await provider.createIntent({
          amount,
          currency,
          // Authorize-only on the first call; the second call captures.
          capture_method: captured === false ? "manual" : "automatic",
          // ...method-specific billing from req.data[methodId]
        });

    if (captured === false) {
      // Authorization phase. The intent must be authorized but not yet captured.
      if (providerIntent.status !== "requires_capture") {
        throw new Error(`Payment is not authorized (status: ${providerIntent.status})`);
      }
    } else {
      // Capture phase. Capture if still in requires_capture; tolerate already-succeeded.
      if (providerIntent.status === "requires_capture") {
        await provider.captureIntent(providerIntent.id, { amount });
      } else if (providerIntent.status !== "succeeded") {
        throw new Error(`Payment is not capturable (status: ${providerIntent.status})`);
      }
    }

    return {
      success: true,
      transaction_id: providerIntent.id,
    };
  } catch (error) {
    return {
      success: false,
      error: { message: error instanceof Error ? error.message : String(error) },
    };
  }
}
```

Key invariants the handler must preserve:

- Treat `captured === false` as authorize-only. Any other value (including `undefined`, which the platform sets to `true` in many flows) is a capture request.
- Always look up the existing provider intent (`req.data.intent.<provider>.id` or `req.data.transaction_id`) before creating a new one. Creating a fresh intent on the second call double-charges.
- Return the same `transaction_id` on the second call as on the first when continuing the same provider intent. The platform persists this as the payment's authoritative transaction id.

### Return Contract

- success: `{ success: true, transaction_id: "..." }`;
- failure: `{ success: false, error: { message: "..." } }`.

### Request Data

The request data can include the payment method-specific billing details under the method id, for example `req.data.revolut`. Observed request shape includes payment ids, account id, amount, currency, capture state, existing intent/transaction ids, and method-specific billing details. Confirm the current payload in logs before depending on provider-specific or optional fields.

## Refund Function

Use `payment.refund` to refund a prior transaction. The same phase-selection rule applies: prefer an explicit `after:` or `before:` phase over a bare event.

```typescript
export const config: SwellConfig = {
  extension: "revolut",
  description: "Refund payment",
  model: {
    events: ["after:payment.refund"],
    conditions: {},
    fields: ["success", "error", "transaction_id"],
  },
};

export default async function (req: SwellRequest) {
  const { amount, currency, transaction_id } = req.data;
  // Refund with the provider.
  return {
    success: true,
    transaction_id: "provider_refund_id",
  };
}
```

Return contract:

- success: `{ success: true, transaction_id: "..." }`;
- failure: `{ success: false, error: { message: "..." } }`.

Observed request shape includes `amount`, `currency`, and the original `transaction_id`. Confirm the current payload in logs before depending on additional fields.

## Hook Semantics

Payment extension events are platform-owned hooks, not ordinary app model events. The platform flow selects an app id and extension id, then invokes matching functions.

Important implications:

- `config.extension` should match the manifest extension id.
- A function with a matching `model.events` value is not enough if the flow did not select the app/extension.
- If no `before:` or `after:` prefix is supplied, extension events can default to the platform-defined hook phase. For payment processing, prefer explicit phases.
- Keep one handler per app/extension/event/phase unless the platform explicitly supports multiple functions for that combination. If multiple functions from the same app match the same event/extension/phase, only one result is usable and the platform logs a conflict.

## Settings

Read provider credentials as normal app settings:

```typescript
const settings = await req.swell.settings(`${req.appId}/revolut`);
```

Use public fields only for browser-safe values such as publishable keys. Secret keys must be non-public and used only in functions.

## Merchant Activation

A successful `swell app push` does not activate the extension method. The merchant must perform these UI steps in the target store before checkout will dispatch the extension:

1. **Install the app** in the store (test or live).
2. **Open Settings → Payments.** The declared payment extension appears as a row under the alt-method or card-gateway list.
3. **Open the extension's settings dialog** (or, for a card gateway, select the app from the gateway dropdown for the `card` method) and click **Save**. This is the step that writes `methods.<methodId>.gateway = "app_<appId>_<methodId>"` plus `extension_app_id` / `extension_config_id` / `activated = true` (and, for card gateways, creates the `/settings/payments/gateways/app_<appId>_<extensionId>` record). Until this Save, those fields are unset and `getAppExtensionPaymentMethods` in `swell-checkout` silently filters the method out — the function will never dispatch from a real checkout.
4. **Toggle the method `enabled`** and Save the page so the method renders in checkout.

Code-only agents cannot perform these steps. When a payment extension is freshly deployed, surface the four steps to the user as a manual verification step and ask them to confirm before debugging missing dispatch as a code problem.

## Verification Checklist

1. `npm run typecheck` or the repo's equivalent passes, including component files when configured.
2. `swell app push` succeeds.
3. `swell inspect functions --app=.` shows the payment functions with the expected `extension` and events.
4. `swell inspect settings payments` or the admin payment settings show the native payment flow selecting the intended app id and extension id at the correct path: `/settings/payments/methods/<extension.id>` for an alt method, or `/settings/payments/methods/card` plus `/settings/payments/gateways/app_<appId>_<extensionId>` for a card gateway. The method record has BOTH `extension_app_id` set AND `gateway = "app_<appId>_<extensionId>"`. If either is missing, the merchant has not yet saved the extension settings dialog (Settings → Payments → open extension → Save) — checkout's `getAppExtensionPaymentMethods` filter drops the method silently when either field is empty.
4a. If the method must be selectable for subscription carts, the deployed `swell.json` extension entry has `"subscriptions": true`. Without this flag, the storefront silently filters the method out of any cart containing a subscription product.
5. The checkout component loads and calls `onReady()`.
6. Creating an intent returns browser-safe provider data.
7. Checkout stores `billing.method` as the extension method id and stores provider token/intent details under method-specific billing fields.
8. Creating an order/payment invokes `payment.charge` and persists `success` plus `transaction_id`.
9. Refunding invokes `payment.refund` and persists refund `success` plus refund `transaction_id`.
10. `swell logs --type function --app=.` shows the expected function invocations and no hidden provider errors.

When behavior is unclear, first add temporary structured logs of `req.data` to the extension functions in a test environment, trigger the native flow, and inspect `swell logs --type function --app=.`. Remove noisy logs before finalizing.

## Common Mistakes

- Treating `payment.charge` as an async notification instead of a synchronous platform hook.
- Forgetting `config.extension`, causing the function to miss extension-scoped dispatch.
- Returning raw provider errors or large provider objects instead of the platform return contract.
- Reading secret settings in the checkout component.
- Assuming deploy alone proves the native payment flow selected the extension.
