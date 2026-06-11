type SwellRequestMethod = 'get' | 'post' | 'put' | 'delete';

// Trigger configuration. Regular functions specify exactly one of route, model, or cron.
// Workflows (Beta — feature-gated; enabled per store by Swell support) use kind: 'workflow' with a class entrypoint instead.
type SwellConfig = SwellFunctionConfig | SwellWorkflowConfig;

interface SwellFunctionConfig {
  kind?: 'function';
  description?: string;
  timeout?: number;                      // ms; 1000–10000 (default 10000). Values above 10000 (up to 20000) are platform-enabled and set outside this field.
  extension?: string;                    // scope this function to a specific app extension (multi-extension apps only)
  route?: {
    public?: boolean;                    // default false — requires secret key auth; set true to expose without auth
    methods?: [SwellRequestMethod, ...SwellRequestMethod[]];
    headers?: string[];                  // allow-list of incoming header names to forward; omit to forward all
    cache?: { timeout?: number };        // ms, GET only; defaults to 5000 ms when omitted — set 0 to disable
  };
  model?: {
    events: [string, ...string[]];       // async: 'review.created'; hook: 'before:review.created' / 'after:review.created', or 'apps/<app_id>/reviews/before:review.created' (fully qualified for app-own models)
    conditions?: object;                 // MongoDB-style filter; may reference $record, $data, $event, $settings, $formula
    schedule?: { formula: string };      // date field for delayed execution
    fields?: string[];                   // narrows $event.data for custom events to the listed fields (has no effect on standard created/updated/deleted events)
  };
  cron?: {
    schedule: string;                    // cron expression, e.g. '0 0 * * *'
  };
}

// Workflow declaration (Beta — feature-gated; enabled per store by Swell support).
// The file default-exports a class with run(req, step) instead of a handler function.
// Workflows run only after `swell app push` — they do NOT execute under `swell app dev`.
interface SwellWorkflowConfig {
  kind: 'workflow';
  description?: string;
  route?: never;
  model?: never;
  cron?: never;
  extension?: never;
  timeout?: never;
}

// Event metadata attached to req.data for model triggers
interface SwellEvent {
  id: string;
  type: string;                          // e.g. 'review.created'
  model: string;                         // e.g. 'reviews' or 'apps/<app_id>/reviews'
  app_id?: string;
  hook?: 'before' | 'after';             // present only on synchronous hook invocations
  data: { [key: string]: any };          // created/deleted: full record snapshot; updated: changed fields only; custom: subset declared in model event `fields`
  delivery?: {                           // per-delivery retry state on event-triggered functions
    attempts: number;                    // 0 on first delivery, increments on each retry
    date_first_failed?: string;          // set after the delivery first fails
  };
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
  /**
   * Atomic multi-operation write (POST /:transaction). Max 10 operations; if any fails, the whole
   * transaction rolls back and no partial writes are committed. Errors carry stable codes
   * (transaction_conflict, transaction_throttled, transaction_timeout, transaction_op_failed) and
   * `op_index` identifying the failed operation. Child operations fire no per-record webhooks or
   * app functions; a successful transaction emits one `transaction.committed` event for the bundle.
   */
  transaction(
    ops: Array<{ method: SwellRequestMethod; url: string; data?: object }>,
    options?: { retry?: boolean }
  ): Promise<any>;
  workflows: SwellWorkflowsAPI;          // Beta — feature-gated; enabled per store by Swell support
}

interface SwellWorkflowsAPI {
  /**
   * Start a workflow instance by name. `params` are passed through as `req.data` inside the workflow;
   * they must be JSON-serializable and ≤128 KB — non-serializable params reject with
   * `workflow_params_unserializable` before any instance is created.
   */
  create(workflowName: string, params?: unknown): Promise<{ id: string; status: 'active' }>;
}

// Request context passed to a workflow's run(req, step) (Beta — feature-gated)
interface SwellWorkflowRequest {
  id: string;
  appId: string;
  store: { id: string; url?: string; admin_url?: string };
  data: unknown;                         // params passed to workflows.create()
  workflow: {
    workflow_id: string;
    workflow_name: string;
    workflow_instance_id: string;
    trigger: 'function';
    request_id: string;
  };
  isLocalDev: false;                     // workflows never run under `swell app dev`
  swell: SwellWorkflowAPI;
  appValues(values: object): { $app: { [appId: string]: object } };
  appValues(appId: string, values: object): { $app: { [appId: string]: object } };
}

// Platform client inside a workflow — same store access as functions
interface SwellWorkflowAPI {
  get(url: string, query?: object): Promise<any>;
  post(url: string, data?: object): Promise<any>;
  put(url: string, data?: object): Promise<any>;
  delete(url: string, data?: object): Promise<any>;
  settings(): Promise<{ [key: string]: any }>;
}

// Durable step runner. Each step.do(name, fn) executes once — its result is recorded and not re-run on retry.
interface SwellWorkflowStep {
  do<T>(name: string, callback: () => Promise<T>): Promise<T>;
  do<T>(name: string, options: SwellWorkflowStepOptions, callback: () => Promise<T>): Promise<T>;
  sleep(name: string, duration: string | number): Promise<void>;       // e.g. '30 seconds'; pauses without holding compute
  sleepUntil(name: string, date: Date | string | number): Promise<void>;
}

interface SwellWorkflowStepOptions {
  retries?: {
    limit: number;
    delay: string | number;
    backoff?: 'constant' | 'linear' | 'exponential';
  };
  timeout?: string | number;
}

// Response helper for custom status/headers; preferred over native Response
declare class SwellResponse extends Response {
  constructor(data: string | object | undefined, options?: { status?: number; headers?: HeadersInit });
}

/**
 * Thrown by `req.swell.*` on non-2xx responses (and on non-GET 2xx responses containing `errors`).
 * User code can also throw this to return error responses.
 * On event-triggered functions, throw with `retry: false` to record the failed delivery
 * (with its real status and message) without scheduling further retries.
 */
class SwellError extends Error {
  constructor(message: string | object, options?: { status?: number; retry?: boolean });
  status: number;
  body?: any;   // structured response payload when the error was constructed from a non-string
}