/**
 * Schema definition for transactional email notifications triggered by model events. Notifications consist of this JSON manifest paired with a corresponding .tpl Liquid template file sharing the same base filename.
 */
export interface SwellNotification {
  /**
   * Optional reference to the JSON schema for validation and intellisense.
   */
  $schema?: string;
  /**
   * The collection this notification is bound to. Record data from this collection populates the template context. Use standard collection names (e.g., 'orders', 'accounts'), app collection names, or child collection notation with colon separator (e.g., 'reviews:comments'). For child collections, the parent record is accessible in templates via the 'parent' variable.
   */
  collection: string;
  /**
   * Human-readable name displayed in the Dashboard notification settings. Should clearly describe the notification's purpose (e.g., 'Order Confirmation', 'Review Approved').
   */
  label: string;
  /**
   * Internal description of the notification's purpose. Displayed in Dashboard settings to help merchants understand when this notification is sent.
   */
  description?: string;
  /**
   * Delivery method for the notification. Currently only 'email' is supported.
   */
  method?: "email";
  /**
   * The model event that triggers this notification. Must match a custom event declared in the collection's data model (e.g., 'approved', 'submitted', 'rejected'). Standard CRUD events (created, updated, deleted) are also available on all models.
   */
  event: string;
  /**
   * Controls whether the notification is active. Disabled notifications will not trigger automatically or via API.
   */
  enabled?: boolean;
  /**
   * When true, sends the notification to store administrators instead of customers. Mutually exclusive with 'contact'—use one or the other to define recipients.
   */
  admin?: boolean;
  /**
   * Dot-notation path to the record field containing the recipient email address (e.g., 'account.email'). Requires the referenced relationship to be included in query.expand. Required for customer-facing notifications when 'admin' is false.
   */
  contact?: string;
  /**
   * Sender email address. If omitted, uses the store's default sender address.
   */
  from?: string;
  /**
   * Comma-separated email addresses to receive a copy of the notification.
   */
  cc?: string;
  /**
   * Comma-separated email addresses to receive a blind copy of the notification.
   */
  bcc?: string;
  /**
   * Email address used for recipient replies. Overrides the store's default reply-to address.
   */
  replyto?: string;
  /**
   * Email subject line. Supports Liquid templating with access to record data, app settings, and store settings (e.g., 'Thank you for reviewing {{ product.name }}', '{% if settings.rewards.enabled %}Earn rewards for your feedback{% endif %}').
   */
  subject: string;
  /**
   * Additional MongoDB-style query conditions beyond the event trigger. The notification fires only when both the event occurs AND conditions evaluate true. Supports comparison operators ($gt, $lt, $ne), existence checks ($exists), and logical operators ($and, $or). Use '$data' to access transient event data. Set to false to disable automatic triggering entirely, requiring explicit API calls.
   */
  conditions?: {} | false;
  /**
   * Controls multi-send behavior for the same record. When false (default), the notification fires only once per record even if the event occurs again. When true, fires every time the event occurs—use for notifications like status updates where multiple sends are expected.
   */
  repeat?: boolean;
  /**
   * When true, the notification triggers only on record creation, ignoring subsequent updates. Useful for welcome emails or initial confirmations. The 'repeat' property has no effect when 'new' is true.
   */
  new?: boolean;
  /**
   * Minutes to wait before sending after the event occurs. Useful for abandoned cart sequences or allowing time for related updates to complete.
   */
  delay?: number;
  /**
   * Admin-editable content variables displayed in Dashboard notification settings. Merchants can customize these values without editing templates. Access in templates via {{ content.field_id }}.
   */
  fields?: {
    /**
     * Unique identifier for the field. Access in templates via {{ content.{id} }}.
     */
    id: string;
    /**
     * Human-readable label displayed in the Dashboard editor.
     */
    label?: string;
    /**
     * Input widget type for the Dashboard editor.
     */
    type:
      | "short_text"
      | "long_text"
      | "rich_text"
      | "number"
      | "boolean"
      | "select";
    /**
     * Default value when merchant has not customized the field. Supports Liquid templating for dynamic defaults that reference record data.
     */
    default?: unknown;
  }[];
  /**
   * Query parameters applied when fetching the record for template rendering. Use expand to include linked records needed by the template.
   */
  query?: {
    /**
     * Relationship paths to expand when fetching the record. Use dot notation for nested expansions (e.g., 'account', 'items.product', 'parent.product' for child collections). Expanded data becomes available in the template context. Required for any linked records referenced in the template or contact path.
     */
    expand?: string[];
  };
  /**
   * Dummy data for Dashboard template previews. Structure must mirror the record shape after query expansion, including nested objects for expanded relationships. Include realistic values for all fields and relationships referenced in the template.
   */
  sample?: {
    [k: string]: unknown;
  };
}
