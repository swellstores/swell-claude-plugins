/**
 * Schema definition for Swell content models and their dashboard content views.
 */
export interface SwellContentModel {
  /**
   * Optional reference to the JSON schema for validation and intellisense.
   */
  $schema?: string;
  /**
   * Name of the collection this content model targets. MUST be the shorthand name within the app scope (e.g. 'suppliers'), NOT the full model address (e.g. 'app/multivendor/suppliers'). For standard collections (like 'products', 'accounts', 'orders') the fields and views defined here augment the existing dashboard pages. For app-defined collections, they create entirely new pages.
   */
  collection: string;
  /**
   * Plural label for this content model shown in the dashboard (e.g. 'Reviews').
   */
  label?: string;
  /**
   * Human-readable summary explaining the purpose of this content model.
   */
  description?: string;
  /**
   * When true, makes collection records readable from the storefront API. Individual fields can also be marked public.
   */
  public?: boolean;
  /**
   * Content fields and layout elements applied to each record in the collection. Order controls how fields appear in the dashboard.
   */
  fields: Field[];
  /**
   * Content views describing how this model appears in the dashboard. Standard views use ids 'list' (collection table), 'edit' (edit form), and 'new' (create form). Custom views with any id can be added and appear in a view selector dropdown, enabling multiple layouts per view type.
   */
  views?: View[];
}

export type Field = ContentFieldBase & {
  /**
   * Identifier of the field. Required for data-bearing fields.
   */
  id?: string;
  type: FieldType;
  /**
   * Optional override for the underlying data type.
   */
  value_type?: string;
  /**
   * Marks this field as a fallback value.
   */
  fallback?: boolean;
  /**
   * Default value for the field or Liquid template.
   */
  default?: string | number | boolean | {} | unknown[];
  conditions?: QueryExpression;
  /**
   * Object path in the underlying model where this field is stored.
   */
  root?: string | boolean;
  /**
   * Number of columns (1-4) this field should span in the admin grid.
   */
  admin_span?: number;
  /**
   * Named dashboard zone where this field should appear. Standard zones include 'details', 'content', 'pricing', 'shipping', etc.
   */
  admin_zone?:
    | "details"
    | "content"
    | "pricing"
    | "options"
    | "inventory"
    | "shipping"
    | "contact"
    | "billing"
    | "charge"
    | "refund"
    | "order"
    | "option-edit"
    | "option-value-edit"
    | "variant-edit"
    | "related"
    | "attributes";
  /**
   * Enables multiple value selection. Supported on select-style fields (select, checkboxes, radio, dropdown) and asset fields (asset, image, video, document).
   */
  multi?: boolean;
  /**
   * When true, enforces uniqueness across the collection. When a string, enforces uniqueness within the scope of the specified field (e.g. 'parent_id').
   */
  unique?: boolean | string;
  /**
   * For lookup fields, the model name to query (e.g. 'suppliers').
   */
  model?: string;
  /**
   * For lookup fields, the local field id storing the foreign key.
   */
  key?: string;
  /**
   * For lookup fields, the target field name on the linked model.
   */
  key_field?: string;
  /**
   * For lookup fields, limits the number of results displayed.
   */
  limit?: number;
  /**
   * For text fields (short_text, long_text): minimum character length. For number fields: minimum allowed value.
   */
  min?: number;
  /**
   * For text fields (short_text, long_text): maximum character length. For number fields: maximum allowed value.
   */
  max?: number;
  /**
   * For number fields, number of decimal digits to round to.
   */
  digits?: number;
  /**
   * For slider fields, the step increment.
   */
  increment?: number;
  /**
   * When true, indicates that the value can be localized.
   */
  localized?: boolean;
  /**
   * Optional unit label for numeric values (e.g. '%', 'kg').
   */
  unit?: string;
  /**
   * Optional list of allowed values.
   */
  enum?: (string | number | boolean | null)[];
  /**
   * Restricts allowed file types for asset fields. Use for multiple types (e.g. ['image', 'video']) or specific mime types (e.g. ['image/png']). For single types, prefer preset types: 'image', 'video', 'document'.
   */
  asset_types?: string[];
  /**
   * For collection fields, the id of the nested field used as the row label.
   */
  item_label?: string;
  /**
   * For collection fields, optional icon identifier.
   */
  icon?: string;
  /**
   * Available options for select-style fields.
   */
  options?: FieldOption[];
  /**
   * For collection fields, the id of the parent collection.
   */
  collection_parent_id?: string;
  /**
   * For collection fields, the field name on the parent collection.
   */
  collection_parent_field?: string;
  /**
   * For collection/lookup fields, the related collection.
   */
  collection?: string;
  query?: QueryExpression;
  /**
   * Formula expression for computed fields (e.g. 'like_count - dislike_count').
   */
  formula?: string;
  /**
   * For collection fields, configuration for linking rows to records.
   */
  link?: {
    /**
     * Map of URL parameter names to local field IDs (e.g. { "product_id": "id" }).
     */
    params?: {
      [k: string]: string;
    };
    [k: string]: unknown;
  };
  /**
   * Nested fields for collection, field_group, or field_row types.
   */
  fields?: Field[];
};

/**
 * Content view configuration controlling how records appear in the dashboard. The 'type' determines rendering mode ('list' for tables, 'record' for forms), while 'id' identifies the specific view instance. Standard views ('list', 'edit', 'new') map to platform routes, while custom view ids enable multiple layouts accessible via dropdown selector.
 */
export interface View {
  /**
   * Identifier of the view. Standard views use 'list' for collection tables, 'edit' for editing existing records, 'new' for creating records, and 'record' for generic single-record views.
   */
  id: string;
  /**
   * View rendering mode: 'list' for collection/table views, or 'record' for detail/form views. If omitted, defaults to 'list' when id is 'list', otherwise defaults to 'record'.
   */
  type?: "list" | "record";
  /**
   * Optional label displayed in the Swell dashboard. Shown in the view selector dropdown when multiple views of the same type exist.
   */
  label?: string;
  /**
   * Optional description of this view.
   */
  description?: string;
  /**
   * Title template used for record views. Liquid syntax is supported.
   */
  title?: string;
  /**
   * Subtitle template used for record views. Liquid syntax is supported.
   */
  subtitle?: string;
  nav?: ViewNav;
  /**
   * Optional filters displayed above a list view.
   */
  filters?: ViewFilter[];
  /**
   * Tabs displayed within this view. In list views, tabs filter collection results using queries. In record views, tabs organize fields into separate sections.
   */
  tabs?: ViewTab[];
  query?: QueryExpression;
  /**
   * Fields to be displayed in the view. The only required property is 'id', but any field property can be overridden to change behavior in this specific view layout. List views may ignore certain properties that are only relevant to record views.
   */
  fields?: ViewField[];
  /**
   * Optional list-level actions.
   */
  actions?: {
    [k: string]: unknown;
  }[];
  /**
   * Optional record-level actions.
   */
  record_actions?: {
    [k: string]: unknown;
  }[];
  /**
   * Default sort applied to this view.
   */
  sort?:
    | string
    | {
        /**
         * This interface was referenced by `undefined`'s JSON-Schema definition
         * via the `patternProperty` "^.*$".
         */
        [k: string]: "asc" | "desc" | 1 | -1;
      };
}

/**
 * Field type selection. Prefer preset types (rich_text, image, currency, etc.) when they match your use case; use base types (long_text, asset, number) only for custom configurations.
 */
export type FieldType = BaseFieldType | PresetFieldType;

/**
 * Fundamental field types. Use when preset types don't match your needs or you need custom property combinations.
 */
export type BaseFieldType =
  | "short_text"
  | "long_text"
  | "boolean"
  | "select"
  | "number"
  | "date"
  | "asset"
  | "tags"
  | "color"
  | "icon"
  | "json"
  | "lookup"
  | "collection"
  | "field_group"
  | "field_row";

/**
 * Pre-configured field types with optimized defaults. PREFERRED over base types when they match your use case. Example: use 'image' instead of 'asset' with asset_types for image-only uploads; use 'currency' instead of 'number' for monetary values.
 */
export type PresetFieldType =
  | "text"
  | "textarea"
  | "rich_text"
  | "checkbox"
  | "checkboxes"
  | "toggle"
  | "radio"
  | "dropdown"
  | "integer"
  | "float"
  | "currency"
  | "percent"
  | "slider"
  | "time"
  | "datetime"
  | "phone"
  | "email"
  | "url"
  | "slug"
  | "html"
  | "basic_html"
  | "rich_html"
  | "markdown"
  | "liquid"
  | "image"
  | "document"
  | "video"
  | "customer_lookup"
  | "product_lookup"
  | "variant_lookup"
  | "category_lookup"
  | "child_collection";

/**
 * Field configuration within a view.
 */
export type ViewField = {
  /**
   * Identifier of the underlying content field or standard model field.
   */
  id?: string;
  /**
   * Override label for this field in this view.
   */
  label?: string;
  /**
   * Override help text for this field in this view.
   */
  description?: string;
  /**
   * Optional override type or layout type (e.g. 'field_row').
   */
  type?: FieldType | string;
  /**
   * When true, disables editing of this field in this view.
   */
  readonly?: boolean;
  /**
   * When true, requires a value in this view.
   */
  required?: boolean;
  /**
   * Override default value.
   */
  default?: string | number | boolean | {} | unknown[];
  conditions?: QueryExpression;
  /**
   * Override column span.
   */
  admin_span?: number;
  /**
   * For text fields in list views, max characters to display.
   */
  truncated?: number;
  /**
   * Liquid-style template for rendering the field value.
   */
  template?: string;
  /**
   * Legacy name for template.
   */
  format?: string;
  /**
   * Override options for select-style fields.
   */
  options?: FieldOption[];
  /**
   * For layout elements like 'field_row', nested view fields.
   */
  fields?: ViewField[];
};

/**
 * Tab configuration within a list or record view. List view tabs use 'query' to filter results. Record view tabs use 'fields' to organize form sections.
 */
export interface ViewTab {
  /**
   * Unique identifier of the tab. Use 'default' to override the auto-prepended Details tab in record views and redeclare its fields.
   */
  id: string;
  /**
   * Label displayed as the tab text in the dashboard UI. Defaults to wordified id if omitted.
   */
  label?: string;
  query?: QueryExpression;
  /**
   * Optional list of fields visible when this tab is active.
   */
  fields?: ViewField[];
}

/**
 * Filter configuration displayed above a list view.
 */
export interface ViewFilter {
  /**
   * Identifier of the field this filter controls.
   */
  id: string;
  /**
   * Label shown next to the filter control.
   */
  label?: string;
  /**
   * UI type used for the filter.
   */
  type?:
    | "short_text"
    | "long_text"
    | "number"
    | "select"
    | "boolean"
    | "date"
    | "asset"
    | "tags"
    | "color"
    | "lookup"
    | "product_lookup"
    | "variant_lookup"
    | "category_lookup"
    | "customer_lookup";
  /**
   * Available options for select-style filters.
   */
  options?: FieldOption[];
  /**
   * Target collection for the lookup filter.
   */
  collection?: string;
  conditions?: QueryExpression;
}

/**
 * Navigation configuration for a list view entry.
 */
export interface ViewNav {
  /**
   * Label shown in the sidebar navigation.
   */
  label?: string;
  /**
   * Parent navigation section. If not defined, the view appears at top-level using the icon property.
   */
  parent?:
    | "orders"
    | "products"
    | "subscriptions"
    | "discounts"
    | "reporting"
    | "customers"
    | "content";
  /**
   * Icon identifier for top-level navigation items (when parent is not defined). If unset, the app's logo_icon will appear as a secondary badge.
   */
  icon?:
    | "home"
    | "orders"
    | "subscriptions"
    | "customers"
    | "products"
    | "discounts"
    | "apps"
    | "reporting"
    | "storefront"
    | "integrations"
    | "developer"
    | "settings";
  /**
   * URL pointing to the location of the view. May contain patterns such as {id} if the view expects a record to exist.
   */
  link?: string;
  /**
   * Link target for navigation.
   */
  target?:
    | 'self'
    | 'blank';
}

/**
 * Selectable option used by select-style fields.
 */
export interface FieldOption {
  /**
   * Human-friendly label shown in the dashboard.
   */
  label?: string;
  /**
   * Internal value stored when this option is selected.
   */
  value: string | number | boolean | null;
}

/**
 * Base properties common to all content field types.
 */
export interface ContentFieldBase {
  /**
   * Human-friendly label displayed in the admin UI.
   */
  label?: string;
  /**
   * Short explanation of the field's purpose, shown as help text.
   */
  description?: string;
  /**
   * When true, the field value is required when editing records.
   */
  required?: boolean;
  /**
   * Prevents manual editing in the dashboard.
   */
  readonly?: boolean;
  /**
   * Grants public storefront API access to this specific field.
   */
  public?: boolean;
  /**
   * Restricts this field from public API access.
   */
  private?: boolean;
  /**
   * Optional placeholder text shown in the input.
   */
  placeholder?: string;
}

/**
 * Query-style expression used for conditions and tab filters. Supports standard query properties like 'where' (filter object with query operators), 'limit' (max results), and 'sort' (sort directive like 'name asc'). Also supports direct field filters (e.g. { "status": "active", "$settings.enabled": true }).
 */
export interface QueryExpression {
  [k: string]: unknown;
}
