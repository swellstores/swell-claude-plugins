/**
 * Schema definition for application settings in Swell
 */
export interface SwellSettingSection {
  /**
   * Optional reference to the JSON schema for validation and intellisense.
   */
  $schema?: string;
  /**
   * Plural label for this content model shown in the dashboard (e.g. 'Reviews').
   */
  label?: string;
  /**
   * Human-readable summary explaining the purpose of this content model.
   */
  description?: string;
  /**
   * Content fields and layout elements applied to each record in the collection. Order controls how fields appear in the dashboard.
   */
  fields: Field[];
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
   * For select-style fields, indicates that multiple values may be selected.
   */
  multi?: boolean;
  /**
   * When true, enforces uniqueness across the collection. When a string, enforces uniqueness within the scope of the specified field (e.g. 'parent_id').
   */
  unique?: boolean | string;
  /**
   * Minimum allowed numeric value or length.
   */
  min?: number;
  /**
   * Maximum allowed numeric value or length.
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
   * Allowed asset types for file uploads (e.g. ['image', 'video']).
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
  query?: QueryExpression;
  /**
   * Formula expression for computed fields (e.g. 'like_count - dislike_count').
   */
  formula?: string;
  /**
   * Nested fields for collection, field_group, or field_row types.
   */
  fields?: Field[];
};

/**
 * Content field type or layout type.
 */
export type FieldType = CoreFieldType;

/**
 * Core content field types that control the underlying data shape.
 */
export type CoreFieldType =
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
  | "collection"
  | "field_group"
  | "field_row";

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
   * UI style or variant for this field (e.g. 'rich_text', 'phone', 'currency', 'slider', 'toggle').
   */
  ui?: string;
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
