/**
 * Defines the structure, validation, and behavior of a collection in Swell.
 *
 *  NAMING CONVENTION: Model name and namespace are derived from the filename (stem):
 *   • 'products.json' → name: 'products', namespace: null
 *   • 'my_custom_models.json' → namespace: 'my', name: 'custom_models' (splits on FIRST underscore only).
 */
export interface SwellDataModel {
  /**
   * Optional reference to the JSON schema for validation and intellisense.
   */
  $schema?: string;
  /**
   * Human-readable summary explaining the purpose of this collection.
   */
  description?: string;
  /**
   * Field definitions keyed by field name. Each field configures storage type, validation rules, and presentation. At least one field is required.
   */
  fields: {
    [k: string]: Field;
  };
  /**
   * Plural label shown in admin UI (e.g. 'Products'). Defaults to humanized model name; override only when automatic capitalization is insufficient.
   */
  label?: string;
  /**
   * Field used as the default record label. Defaults to model name, otherwise the primary field.
   */
  name_field?: string;
  /**
   * Template for generating record labels using field interpolation (e.g. '{name} - {sku}'). Can reference nested fields (e.g. '{parent.name}'). When defined, overrides `name_field`.
   */
  name_pattern?: string;
  /**
   * Primary lookup field for record identification. Defaults to 'id' when omitted.
   */
  primary_field?: string;
  /**
   * Optional secondary lookup field for alternative record retrieval (e.g. 'slug', 'sku').
   */
  secondary_field?: string;
  /**
   * When true, makes the entire collection and all fields publicly readable via storefront API without authentication. Only enable when all data is safe for public access.
   */
  public?: boolean;
  public_permissions?: SwellPublicPermissions;
  /**
   * When true, the model represents a singleton record (like site settings) instead of a collection. API endpoints return a single object instead of arrays.
   */
  single?: boolean;
  /**
   * Marks the model as a base definition for inheritance only—cannot be instantiated directly. Typically set by platform for base models.
   */
  abstract?: boolean;
  events?: Events;
  searches?: SwellSearches;
  query?: SwellQueryDefinition;
  [k: string]: unknown;
}

/**
 * Base properties common to all field types.
 */
export interface FieldBase {
  /**
   * Human-friendly label displayed in admin UI. Defaults to humanized field name.
   */
  label?: string;
  /**
   * Short explanation of the field's purpose and usage, shown as help text in admin UI.
   */
  description?: string;
  /**
   * When true, API rejects create/update operations if this field is undefined or null. Use for critical data.
   */
  required?: boolean;
  /**
   * Prevents manual updates after initial creation. Formula fields can still modify the value automatically.
   */
  readonly?: boolean;
  /**
   * Marks the field as deprecated. Keep for backward compatibility but avoid in new records.
   */
  deprecated?: boolean;
  /**
   * Alternative field name accepted in API payloads for backward compatibility.
   */
  alias?: string;
  /**
   * Grants public storefront API access to this specific field, even when model-level `public` is false.
   */
  public?: boolean;
  /**
   * Restricts field from public API access. Opposite of `public`. Use for sensitive data like internal flags or admin-only fields.
   */
  private?: boolean;
}

/**
 * Discriminated union of field definitions by required 'type'.
 */
export type Field =
  | StringField
  | IntField
  | FloatField
  | BoolField
  | DateField
  | CurrencyField
  | ObjectIdField
  | ArrayField
  | ObjectField
  | CollectionField
  | LinkField
  | FileField
  | FileDataField;

export type StringField = FieldBase & {
  type: "string";
  /**
   * Default value automatically applied when field is undefined on create/update. Can be a static string or an object with $formula property for dynamic defaults (e.g. {$formula: 'upper(code)'}).
   */
  default?:
    | string
    | {
        $formula: string;
      };
  /**
   * Restrict field to specific allowed string values (e.g., ['draft', 'active', 'archived']).
   */
  enum?: string[];
  /**
   * Automatic formatting applied on save. 'password' hashes with bcrypt. 'slug' converts to URL-safe format. 'email' normalizes addresses.
   */
  format?:
    | "uppercase"
    | "lowercase"
    | "underscore"
    | "slug"
    | "slugid"
    | "currency-code"
    | "url"
    | "email"
    | "semver"
    | "password";
  length?: number;
  minlength?: number;
  maxlength?: number;
  /**
   * Create composite uniqueness constraint. Current field is ALWAYS included: `true` for global uniqueness; `"parent_id"` creates [field, parent_id] constraint (unique per parent); `["account_id", "type"]` creates [field, account_id, type] constraint. Use for scoped uniqueness in nested collections.
   */
  unique?: boolean | string[] | string;
  auto?: boolean | "insert";
  increment?: Increment;
  /**
   * Expression to compute field value on create/update (e.g., 'upper(code)'). If result is undefined, field becomes undefined.
   */
  formula?: string;
  rules?: Rule[];
};

export type IntField = FieldBase & {
  type: "int";
  /**
   * Default integer value applied when undefined. Can be a static integer or an object with $formula property.
   */
  default?:
    | number
    | {
        $formula: string;
      };
  min?: number;
  max?: number;
  enum?: number[];
  auto?: boolean;
  increment?: Increment;
  /**
   * Expression to compute field value on create/update (e.g., 'round(total / count)'). If result is undefined, field becomes undefined.
   */
  formula?: string;
  rules?: Rule[];
  unique?: boolean | string[] | string;
};

export type FloatField = FieldBase & {
  type: "float";
  /**
   * Default float value applied when undefined. Can be a static number or an object with $formula property.
   */
  default?:
    | number
    | {
        $formula: string;
      };
  min?: number;
  max?: number;
  /**
   * Decimal precision retained (e.g., 2 for currency).
   */
  scale?: number;
  /**
   * Expression to compute field value on create/update (e.g., 'round(price * 1.1, 2)'). If result is undefined, field becomes undefined.
   */
  formula?: string;
  rules?: Rule[];
};

export type BoolField = FieldBase & {
  type: "bool";
  /**
   * Default boolean value applied when undefined. Can be a static boolean or an object with $formula property.
   */
  default?:
    | boolean
    | {
        $formula: string;
      };
  formula?: string;
  rules?: Rule[];
};

export type DateField = FieldBase & {
  type: "date";
  /**
   * Default date value applied when undefined. Accepts ISO 8601 string, epoch milliseconds as integer, or a { $formula } object.
   */
  default?:
    | string
    | number
    | {
        $formula: string;
      };
  /**
   * Auto Timestamp: true/'insert' sets once on creation; 'update' refreshes on every update.
   */
  auto?: boolean | ("insert" | "update");
  /**
   * Expression to compute date value (e.g., 'now()', 'date_start + 86400000'). If result is undefined, field becomes undefined.
   */
  formula?: string;
  rules?: Rule[];
};

export type CurrencyField = FieldBase & {
  type: "currency";
  /**
   * Default currency amount. Can be a static number or a { $formula } object.
   */
  default?:
    | number
    | {
        $formula: string;
      };
  /**
   * Minimum allowed value.
   */
  min?: number;
  /**
   * Maximum allowed value.
   */
  max?: number;
  /**
   * Decimal precision (e.g., 2 for USD, 0 for JPY).
   */
  scale?: number;
  /**
   * Enable per-currency/locale values (region-specific pricing).
   */
  localized?: boolean;
  /**
   * Expression to compute amount (e.g., 'round(price * 1.2, 2)'). If result is undefined, field becomes undefined.
   */
  formula?: string;
  rules?: Rule[];
};

export type ObjectIdField = FieldBase & {
  type: "objectid";
  /**
   * Default ObjectID value. Typically null or a { $formula } object; static strings allowed for system-generated IDs.
   */
  default?:
    | string
    | null
    | {
        $formula: string;
      };
  /**
   * Auto-generate unique ID on creation.
   */
  auto?: boolean;
  /**
   * Prevent changes after creation (stricter than readonly).
   */
  immutable?: boolean;
  /**
   * Composite uniqueness. true = globally unique; 'parent_id' => [field,parent_id]; ['account_id','type'] => [field,account_id,type].
   */
  unique?: boolean | string[] | string;
  /**
   * Expression to compute value; rarely used for IDs.
   */
  formula?: string;
  rules?: Rule[];
};

export type ArrayField = FieldBase & {
  type: "array";
  /**
   * Defines the type of items in the array. Use 'object' for structured items; not compatible with 'collection' or 'record'.
   */
  value_type:
    | "string"
    | "int"
    | "float"
    | "bool"
    | "date"
    | "currency"
    | "objectid"
    | "object"
    | "file"
    | "filedata"
    | "link";
  /**
   * Required when value_type is 'object'. Defines the nested schema of each object item.
   */
  fields?: {
    [k: string]: Field;
  };
  /**
   * Automatically sort array items ascending or descending.
   */
  sort?: "asc" | "desc";
  /**
   * Inherit configuration from another top-level field name.
   */
  extends?: string;
  /**
   * Default array value.
   */
  default?: {
    [k: string]: unknown;
  };
  rules?: Rule[];
};

export type ObjectField = FieldBase & {
  type: "object";
  /**
   * Nested field definitions for the object. Keys are field names; values follow the Field schema.
   */
  fields?: {
    [k: string]: Field;
  };
  /**
   * Optional polymorphism: provide per-type field overrides. Keys are type identifiers matched against a 'type' field within this object.
   */
  object_types?: {
    [k: string]: {
      fields?: {
        [k: string]: Field;
      };
    };
  };
  /**
   * Inherit fields from another top-level field.
   */
  extends?: string;
  /**
   * Default object value.
   */
  default?: {
    [k: string]: unknown;
  };
  rules?: Rule[];
};

export type CollectionField = FieldBase & {
  type: "collection";
  /**
   * Field definitions for records in the nested collection. Uses the same Field schema as top-level fields.
   */
  fields: {
    [k: string]: Field;
  };
  /**
   * Singular label for nested collection records (e.g. 'Comment').
   */
  label?: string;
  /**
   * Plural label for the nested collection (e.g. 'Comments').
   */
  plural?: string;
  /**
   * Template for generating nested record labels (e.g. '{nickname}').
   */
  name_pattern?: string;
  events?: Events;
  searches?: SwellSearches;
  query?: SwellQueryDefinition;
  /**
   * When true, makes this nested collection publicly accessible.
   */
  public?: boolean;
  public_permissions?: SwellPublicPermissions;
};

export type LinkField = FieldBase &
  (
    | {
        type: "link";
        /**
         * Target model (e.g., 'products', 'accounts'). Can include nested syntax like 'products:variants'.
         */
        model: string;
        /**
         * Foreign key field in this model that stores the target record id (e.g., 'product_id').
         */
        key?: string;
        /**
         * Whether this link resolves to a collection or a single record (default 'record').
         */
        value_type?: "collection" | "record";
        /**
         * Static/dynamic query parameters. Supports field references (e.g., {'id': {'$in': 'category_ids'}}).
         */
        params?: {
          [k: string]: unknown;
        };
      }
    | {
        type: "link";
        /**
         * Custom URL pattern for link resolution (e.g., '/orders/{order_id}/items/{order_item_id}').
         */
        url: string;
        /**
         * Foreign key field in this model that stores the target record id (e.g., 'order_id').
         */
        key?: string;
        /**
         * Whether this link resolves to a collection or a single record (default 'record').
         */
        value_type?: "collection" | "record";
        /**
         * Static/dynamic query parameters for the resolved URL.
         */
        params?: {
          [k: string]: unknown;
        };
      }
  );

export type FileField = FieldBase & {
  type: "file";
  default?: unknown;
  rules?: Rule[];
};

export type FileDataField = FieldBase & {
  type: "filedata";
  description?: string;
};

/**
 * Auto-increment configuration for string and int fields when combined with `auto: true`.
 */
export interface Increment {
  /**
   * Starting number for auto-increment sequence (e.g. 1 for 1, 2, 3, ...). Applies globally across the collection.
   */
  start?: number;
  /**
   * For string fields: pattern with numeric placeholder in braces (e.g. 'ORDER-{0000}' produces 'ORDER-0001', 'ORDER-0002', ...). Maintains non-brace characters.
   */
  pattern?: string;
}

/**
 * Conditional validation rule triggered on save. Either `expression` or `conditions` must be provided to define the trigger.
 */
export interface Rule {
  /**
   * Formula expression that triggers the rule when it evaluates to true. Examples: 'and(date_start, date_end, date_end <= date_start)', 'quantity > max_quantity'. Use $record.field to reference existing values during updates. See 'formulas' reference.
   */
  expression?: string;
  /**
   * Query-style conditions using Swell operators ($and, $or, etc.). Rule triggers when conditions match the record.
   */
  conditions?: {};
  /**
   * When rule triggers, make this field required.
   */
  required?: boolean;
  /**
   * Error message returned to user when rule triggers (e.g. 'Must occur after Start Date').
   */
  error?: string;
}

/**
 * Event definitions that trigger HTTP webhooks and Swell function extensions. Events are emitted on record lifecycle actions (create, update, delete) and custom state transitions.
 */
export interface Events {
  /**
   * Enable or disable event emission for this model. When false, no events are triggered for record changes. Defaults to true.
   */
  enabled?: boolean;
  types?: EventType[] | null;
  [k: string]: unknown;
}

/**
 * Definition of a single event type that triggers webhooks and function extensions.
 */
export interface EventType {
  /**
   * Event identifier (e.g., 'created', 'updated', 'paid'). Combined with model root to form full event name (e.g., 'order.paid'). This name is matched against webhook and function event subscriptions.
   */
  id?: string;
  /**
   * Human-readable description of when this event is triggered. Useful for documentation and admin UI.
   */
  description?: string;
  /**
   * Conditional trigger that determines when the event fires. Two patterns: (1) Formula for state transitions: {'$formula': 'and($record.status != "approved", status == "approved")'} where $record.field references the previous value and field references the new value. (2) Query operators: {'$and': [{'$record': {...}}, {'$data': {...}}]} for complex matching. When omitted, event triggers on every record change. See 'formulas' and 'query' references.
   */
  conditions?: {
    [k: string]: unknown;
  };
  /**
   * Subset of field names to include in the event payload. When specified, only these fields are sent to webhooks and functions. When omitted, all fields are included. Useful for limiting sensitive data exposure or reducing payload size.
   */
  fields?: string[];
  [k: string]: unknown;
}

/**
 * Search presets for admin UI and API helpers. Each entry can whitelist fields to search across, define a default query, or proxy to another model by a foreign key.
 */
export type SwellSearches = SearchDefinition[];

export interface SearchDefinition {
  /**
   * Identifier for the search preset (e.g. 'default', 'product'). Used by UI and APIs to reference this preset.
   */
  id: string;
  /**
   * Human-readable label for this search (shown in admin).
   */
  label?: string;
  /**
   * Optional help text explaining the purpose of this search.
   */
  description?: string;
  /**
   * List of fields to include in free-text search. Order can influence relevance in some tools.
   */
  fields?: string[];
  query?: SwellQueryDefinition;
  /**
   * Proxy search to a related model using a foreign key. Useful for jumping from one model to records in another model related by `key`.
   */
  proxy?: {
    /**
     * Target model to proxy to (e.g. 'products').
     */
    model: string;
    /**
     * Foreign key field in the current model that references the target model's id.
     */
    key: string;
    [k: string]: unknown;
  };
}

/**
 * Common query options (filters, sorting, pagination, expansions, and projections) used to define default collection queries, search presets, and public access constraints.
 */
export interface SwellQueryDefinition {
  /**
   * Filter conditions using Swell query operators (e.g. `$and`, `$or`).
   */
  where?: {
    [k: string]: unknown;
  };
  /**
   * Maximum number of records to return.
   */
  limit?: number;
  /**
   * Cursor for paginated responses.
   */
  page?: number;
  /**
   * Number of pages to pre-compute for pagination.
   */
  window?: number;
  /**
   * Sort expression, e.g. `name asc` or `date_created desc`.
   */
  sort?: string;
  /**
   * List of relationship paths to expand in responses.
   */
  expand?: string[];
  /**
   * Field whitelist for projection.
   */
  fields?: string[];
  /**
   * Cursor token indicating the starting point for results.
   */
  after?: string;
  /**
   * Cursor token indicating the end point for results.
   */
  before?: string;
}

/**
 * Restricts which fields and operations are allowed through the unauthenticated storefront API when `public` is false or omitted.
 */
export interface SwellPublicPermissions {
  /**
   * Optional scope limit. Use `account` to require the caller to be an authenticated customer.
   */
  scope?: "account";
  /**
   * Whitelist of fields that are readable through the public API.
   */
  fields?: string[];
  query?: SwellQueryDefinition;
  /**
   * Custom expansion URLs for link fields in public API responses. Keys are field names, values define the URL pattern (e.g. {'product': {'url': '/products/{product_id}'}}).
   */
  expands?: {
    [k: string]: {
      /**
       * URL pattern for expanding the link, with field interpolation (e.g. '/products/{product_id}').
       */
      url: string;
    };
  };
  /**
   * Controls which fields can be modified via the public API (e.g. when customers submit forms).
   */
  input?: {
    /**
     * Restrict write access to authenticated customers.
     */
    scope?: "account";
    /**
     * List of fields that may be written by the public endpoint.
     */
    fields?: string[];
    [k: string]: unknown;
  };
}
