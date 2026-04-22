type SwellRequestMethod = 'get' | 'post' | 'put' | 'delete';

// Trigger configuration — exactly one of route, model, or cron must be specified
interface SwellConfig {
  description?: string;
  route?: {
    public?: boolean;                    // false requires secret key auth
    methods?: [SwellRequestMethod, ...SwellRequestMethod[]];
    headers?: string[];                  // allow-list of incoming header names to forward; omit to forward all
    cache?: { timeout?: number };        // milliseconds, GET only
  };
  model?: {
    events: [string, ...string[]];       // e.g. ['review.created', 'review.updated']
    conditions?: object;                 // filter which records trigger
    schedule?: { formula: string };      // date field for delayed execution
    sequence?: number;                   // priority among handlers (lower = first)
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
  // When body/query precedence matters (e.g. security-sensitive handlers), use req.body and req.query directly.
  data: { $event?: SwellEvent; [key: string]: any };

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