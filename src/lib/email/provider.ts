/**
 * Email provider abstraction (instruction §13).
 *
 * Sending is always mediated by `notificationService`, which writes a
 * Notification row first and records the outcome afterwards. A provider's only
 * job is to attempt one delivery and either return or throw.
 */

export interface OutboundAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface OutboundMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: OutboundAttachment[];
}

export interface EmailProvider {
  readonly name: string;
  send(message: OutboundMessage): Promise<void>;
  verify(): Promise<boolean>;
}

export class EmailDeliveryError extends Error {
  constructor(message: string, readonly permanent = false) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}
