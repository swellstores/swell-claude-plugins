type SwellRequestMethod = 'get' | 'post' | 'put' | 'delete';

// Trigger configuration — exactly one of route, model, or cron must be specified
interface SwellConfig {
  description?: string;
  timeout?: number;                      // ms; 1000–10000 (default 10000). Higher values up to 20000 require platform feature enablement (not author-configurable).
  extension?: string;                    // scope this function to a specific app extension (multi-extension apps only)
  route?: {
    public?: boolean;                    // false requires secret key auth
    methods?: [SwellRequestMethod, ...SwellRequestMethod[]];
    headers?: string[];                  // allow-list of incoming header names to forward; omit to forward all
    cache?: { timeout?: number };        // ms, GET only; defaults to 5000 ms when omitted — set 0 to disable
  };
  model?: {
    events: [string, ...string[]];       // async: 'review.created'; hook: 'before:review.created' or 'apps/<app_id>/reviews/before:review.created' (fully qualified for app-own models)
    conditions?: object;                 // filter which records trigger
    schedule?: { formula: string };      // date field for delayed execution
    fields?: string[];                   // narrows $event.data for custom events to the listed fields (has no effect on standard created/updated/deleted events)
  };
  cron?: {
    schedule: string;                    // cron expression, e.g. '0 0 * * *'
  };
}

// Event metadata attached to req.data for model triggers
interface SwellEvent {
  id: string;
  type: string;                          // e.g. 'review.created'
  model: string;                         // e.g. 'reviews' or 'apps/<app_id>/reviews'
  app_id?: string;
  hook?: 'before' | 'after';             // present only on synchronous hook invocations
  data: { [key: string]: any };          // created/deleted: full record snapshot; updated: changed fields only; custom: subset declared in model event `fields`
}

// Request context available in all function handlers
interface SwellRequest {
  appId: string;                         // current app identifier
  store: {
    id: string;
    url: string;
    admin_url: string;
  };
  session?: { account_id?: string; [key: string]: any };  // authenticated user (routes)

  // Trigger payload. model: record fields + $event. cron: empty. route: body ∪ query, query keys overwrite body keys.
  // Hook invocations also include $record (pre-mutation record on before:updated / after:updated only) and $event.hook = 'before' | 'after'.
  // When body/query precedence matters (e.g. security-sensitive handlers), use req.body and req.query directly.
  data: {
    $event?: SwellEvent;
    $record?: { [key: string]: any };    // pre-mutation record; only on before:updated / after:updated (absent on create/delete — check with `if (!$record)`)
    [key: string]: any;
  };

  // HTTP request layer (routes). On model/cron triggers method is 'POST', headers carry the platform envelope, url/id are populated but not meaningful to author code.
  method: string;                        // uppercase HTTP method (e.g. 'GET', 'POST')
  headers: Headers;                      // incoming request headers; on routes filtered by `route.headers` allow-list when set
  url: URL;                              // parsed request URL — use `url.pathname`, `url.searchParams`, etc.
  id?: string;                           // Swell-Request-ID for log correlation across function invocations

  // Parsed JSON body as object, or raw text string when body isn't JSON. Empty {} for model/cron triggers.
  body: { [key: string]: any } | string;

  query: { [key: string]: string };      // URL query parameters (routes)

  // Raw request body text, untouched by parsing.
  // Use on route triggers for HMAC/webhook signature verification — re-stringifying `body` won't byte-match the original.
  rawBody: string;

  // true when invoked via `swell app dev` local proxy; false in production. Useful for dev-only branches (mock external APIs, skip destructive writes)
  isLocalDev: boolean;

  // Cloudflare Worker execution context. Use waitUntil() to run work after the response returns (logs, metrics, non-blocking side effects)
  context: {
    waitUntil(promise: Promise<unknown>): void;
  };

  swell: SwellAPI;                       // authenticated platform client

  /**
   * Wrap values for the $app namespace when writing to standard model extensions.
   * Returns `{ $app: { [appId]: values } }`. Pass `appId` as the first argument to target another app.
   * @throws if values is not a plain object (arrays, class instances, null, and primitives are rejected)
   */
  appValues(values: object): { $app: { [appId: string]: object } };
  appValues(appId: string, values: object): { $app: { [appId: string]: object } };
}

// Platform API client
interface SwellAPI {
  get(url: string, query?: object): Promise<any>;
  put(url: string, data: object): Promise<any>;
  post(url: string, data: object): Promise<any>;
  delete(url: string, data?: object): Promise<any>;
  /**
   * Read app settings. With no argument, returns the current app's settings.
   * Pass another app's id to read a different installed app's settings (cross-app).
   */
  settings(id?: string): Promise<{ [key: string]: any }>;
}

// Response helper for custom status/headers; preferred over native Response
declare class SwellResponse extends Response {
  constructor(data: string | object | undefined, options?: { status?: number; headers?: HeadersInit });
}

/**
 * Thrown by `req.swell.*` on non-2xx responses (and on non-GET 2xx responses containing `errors`).
 * User code can also throw this to return error responses.
 */
class SwellError extends Error {
  constructor(message: string | object, options?: { status?: number });
  status: number;
  body?: any;   // structured response payload when the error was constructed from a non-string
}