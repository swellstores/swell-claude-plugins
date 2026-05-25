/**
 * Manually created types.
 * Doesn't require creating or editing the `schema/function.json` file.
 */

/** http method */
type SwellRequestMethod = 'get' | 'post' | 'put' | 'delete';

/** Trigger configuration — exactly one of route, model, or cron must be specified */
interface SwellConfig {
  description?: string;
  /** ms; 1000–10000 (default 10000). Values above 10000 (up to 20000) are platform-enabled and set outside this field. */
  timeout?: number;
  /** scope this function to a specific app extension (multi-extension apps only) */
  extension?: string;
  route?: {
    /** default `false` — requires secret key auth; set true to expose without auth */
    public?: boolean;
    methods?: [SwellRequestMethod, ...SwellRequestMethod[]];
    /** allow-list of incoming header names to forward; omit to forward all */
    headers?: string[];
    cache?: {
      /** ms, GET only; defaults to 5000 ms when omitted — set 0 to disable */
      timeout?: number;
    };
  };
  model?: {
    /**
     * * async: `review.created`;
     * * hook: `before:review.created` / `after:review.created`, or `apps/<app_id>/reviews/before:review.created` (fully qualified for app-own models)
     */
    events: [string, ...string[]];
    /** MongoDB-style filter; may reference `$record`, `$data`, `$event`, `$settings`, `$formula` */
    conditions?: object;
    schedule?: {
      /** date field for delayed execution */
      formula: string;
    };
    /** narrows `$event.data` for custom events to the listed fields (has no effect on standard `created`/`updated`/`deleted` events) */
    fields?: string[];
  };
  cron?: {
    /** cron expression, e.g. `0 0 * * *` */
    schedule: string;
  };
}

/** Event metadata attached to req.data for model triggers */
interface SwellEvent {
  id: string;
  /** e.g. `review.created` */
  type: string;
  /** e.g. `reviews` or `apps/<app_id>/reviews` */
  model: string;
  app_id?: string;
  /** present only on synchronous hook invocations */
  hook?: 'before' | 'after';
  /**
   * * `created/deleted` — full record snapshot;
   * * `updated` — changed fields only;
   * * `custom` — subset declared in model event `fields`
   */
  data: Record<string, any>;
  /** Event delivery state */
  delivery: {
    /** The number of attempts to send an event to the function */
    attempts: number;
    /** The date of the first failure to send an event to the function */
    date_first_failed?: string;
  };
}

/** Request context available in all function handlers */
interface SwellRequest {
  /** current app identifier */
  appId: string;
  store: {
    id: string;
    url: string;
    admin_url: string;
  };
  /** authenticated user (routes) */
  session?: { account_id?: string; [key: string]: any };

  /**
   * Trigger payload. model: `record fields + $event`. cron: `empty`. route: `body ∪ query`, query keys overwrite body keys.
   *
   * Hook invocations also include `$record` (pre-mutation record on `before:updated` / `after:updated` only) and `$event.hook` = 'before' | 'after'.
   *
   * When body/query precedence matters (e.g. security-sensitive handlers), use `req.body` and `req.query` directly.
   */
  data: {
    $event?: SwellEvent;
    /** pre-mutation record; only on `before:updated` / `after:updated` (absent on `create`/`delete` — check with `if (!$record)`) */
    $record?: Record<string, any>;
    [key: string]: any;
  };

  /**
   * HTTP request layer (routes).
   *
   * On model/cron triggers method is 'POST', headers carry the platform envelope, url/id are populated but not meaningful to author code.
   */

  /** uppercase HTTP method (e.g. `GET`, `POST`) */
  method: string;
  /** incoming request headers; on routes filtered by `route.headers` allow-list when set */
  headers: Headers;
  /** parsed request URL — use `url.pathname`, `url.searchParams`, etc. */
  url: URL;
  /** `Swell-Request-ID` for log correlation across function invocations */
  id?: string;

  /** Parsed JSON body as object, or raw text string when body isn't JSON. Empty `{}` for model/cron triggers. */
  body: Record<string, any> | string;

  /** URL query parameters (routes) */
  query: Record<string, string | undefined>;

  // Raw request body text, untouched by parsing.
  // Use on route triggers for HMAC/webhook signature verification — re-stringifying `body` won't byte-match the original.
  rawBody: string;

  /** `true` when invoked via `swell app dev` local proxy; `false` in production. Useful for dev-only branches (mock external APIs, skip destructive writes) */
  isLocalDev: boolean;

  /** Cloudflare Worker execution context. Use `waitUntil()` to run work after the response returns (logs, metrics, non-blocking side effects) */
  context: {
    waitUntil(promise: Promise<unknown>): void;
  };

  /** authenticated platform client */
  swell: SwellAPI;

  /**
   * Wrap values for the $app namespace when writing to standard model extensions.
   * Returns `{ $app: { [appId]: values } }`. Pass `appId` as the first argument to target another app.
   * @throws if values is not a plain object (arrays, class instances, null, and primitives are rejected)
   */
  appValues(values: object): { $app: Record<string, object | undefined> };
  appValues(appId: string, values: object): { $app: Record<string, object | undefined> };
}

/** Platform API client */
interface SwellAPI {
  get<T>(url: string, query?: object): Promise<T | null>;
  put<T>(url: string, data: object): Promise<T>;
  post<T>(url: string, data: object): Promise<T>;
  delete<T>(url: string, data?: object): Promise<T>;
  /**
   * Read app settings. With no argument, returns the current app's settings.
   * Pass another app's id to read a different installed app's settings (cross-app).
   */
  settings(id?: string): Promise<Record<string, any>>;
}

/** Response helper for custom status/headers; preferred over native Response */
declare class SwellResponse extends Response {
  constructor(data: string | object | undefined, options?: { status?: number; headers?: HeadersInit });
}

/**
 * Thrown by `req.swell.*` on non-2xx responses (and on non-GET 2xx responses containing `errors`).
 * User code can also throw this to return error responses.
 */
declare class SwellError extends Error {
  constructor(message: string | object, options?: { status?: number });
  status: number;
  /** structured response payload when the error was constructed from a non-string */
  body?: any;
}
