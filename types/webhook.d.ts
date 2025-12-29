/**
 * Schema for configuring webhooks in Swell applications. Webhooks subscribe to model events and update external services with event data.
 */
export interface SwellWebhook {
  /**
   * Optional reference to the JSON schema for validation and intellisense.
   */
  $schema?: string;
  /**
   * Alias used to refer to the webhook configuration.
   */
  alias?: string;
  /**
   * A brief description of the webhook's purpose.
   */
  description?: string;
  /**
   * Your application's webhook endpoint URL. For authentication, API secrets can be included directly in the URL and validated when requests are received from Swell.
   */
  url: string;
  /**
   * Array of event types to trigger this webhook. Events follow the format 'model.action' (e.g., 'product.created', 'payment.succeeded', 'payment.failed').
   *
   * @minItems 1
   */
  events: string[];
  /**
   * Indicates whether the webhook is enabled. When disabled, events will not be sent to the endpoint.
   */
  enabled?: boolean;
  /**
   * Determines whether the webhook retries disabled events.
   */
  retry_disabled_events?: boolean;
  /**
   * Displays the number of failed webhook attempts.
   */
  attempts_failed?: number;
  /**
   * The final attempt for a webhook after continuous failed attempts. Webhooks are disabled 7 days after the first failed attempt.
   */
  date_final_attempt?: string;
  /**
   * Schedule for specifying when a webhook is to be fired.
   */
  schedule?: {
    /**
     * The hour for which to fire the webhook.
     */
    hour?: number;
    /**
     * The day of the month for which to fire the webhook.
     */
    month_day?: number;
    /**
     * The month for which to fire the webhook.
     */
    month?: number;
    /**
     * The day of the week for which to fire the webhook.
     */
    week_day?: number;
  };
  /**
   * Date for which the webhook is scheduled to fire.
   */
  date_scheduled?: string;
}
