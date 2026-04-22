type SwellRequestMethod = 'get' | 'post' | 'put' | 'delete';

// Trigger configuration — exactly one of route, model, or cron must be specified
interface SwellConfig {
  description?: string;
  route?: {
    public?: boolean;                    // false requires secret key auth
    methods?: [SwellRequestMethod, ...SwellRequestMethod[]];
    headers?: { [key: string]: string };
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
  data: { $event?: SwellEvent; [key: string]: any };  // model: record fields + $event; route: parsed body merged with query; cron: empty
  query: { [key: string]: string };      // URL query parameters (routes)
  swell: SwellAPI;                       // authenticated platform client
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

// Error handling
class SwellError extends Error {
  constructor(message: string | object, options?: { status?: number });
}