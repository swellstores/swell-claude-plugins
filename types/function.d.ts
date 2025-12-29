// Trigger configuration — exactly one of route, model, or cron must be specified
interface SwellConfig {
  description?: string;
  route?: {
    public?: boolean;                    // false requires secret key auth
    methods?: [string, ...string[]];     // 'get', 'post', 'put', 'delete'
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

// Request context available in all function handlers
interface SwellRequest {
  appId: string;                         // current app identifier
  store: {
    id: string;
    url: string;
    admin_url: string;
  };
  session?: { account_id?: string; [key: string]: any };  // authenticated user (routes)
  data: { [key: string]: any };          // trigger payload or parsed request body
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

// Error handling
class SwellError extends Error {
  constructor(message: string | object, options?: { status?: number });
}