import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";
import { EmailDeliveryError, type EmailProvider, type OutboundMessage } from "./provider";

export * from "./provider";

/** SMTP delivery — the production path (spec §5.18). */
class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";

  private transporter: Transporter | null = null;

  private client(): Transporter {
    if (this.transporter) return this.transporter;
    const e = env();
    this.transporter = nodemailer.createTransport({
      host: e.EMAIL_HOST,
      port: e.EMAIL_PORT,
      secure: e.EMAIL_USE_SSL,
      auth: e.EMAIL_HOST_USER ? { user: e.EMAIL_HOST_USER, pass: e.EMAIL_HOST_PASSWORD } : undefined,
      pool: true,
      maxConnections: 3,
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
    return this.transporter;
  }

  async send(message: OutboundMessage): Promise<void> {
    try {
      await this.client().sendMail({
        from: env().DEFAULT_FROM_EMAIL,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      });
    } catch (error) {
      const err = error as { responseCode?: number; message?: string };
      // 5xx is a permanent rejection — retrying it five times just annoys the
      // receiving server. 4xx and network errors are worth another attempt.
      const permanent = typeof err.responseCode === "number" && err.responseCode >= 500;
      throw new EmailDeliveryError(err.message ?? "SMTP delivery failed", permanent);
    }
  }

  async verify(): Promise<boolean> {
    try {
      await this.client().verify();
      return true;
    } catch {
      return false;
    }
  }
}

/** Development: print the message instead of sending it. */
class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";

  async send(message: OutboundMessage): Promise<void> {
    logger().info(
      {
        to: message.to,
        subject: message.subject,
        attachments: message.attachments?.length ?? 0,
      },
      "Email (console backend) — not actually sent",
    );
    // eslint-disable-next-line no-console
    console.log(
      `\n──── EMAIL ────\nTo:      ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n───────────────\n`,
    );
  }

  async verify(): Promise<boolean> {
    return true;
  }
}

/** Tests: capture messages in memory for assertions. */
export class MemoryEmailProvider implements EmailProvider {
  readonly name = "memory";
  readonly sent: OutboundMessage[] = [];
  /** Set to make the next N sends fail, for retry tests. */
  failuresRemaining = 0;

  async send(message: OutboundMessage): Promise<void> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new EmailDeliveryError("Injected failure");
    }
    this.sent.push(message);
  }

  async verify(): Promise<boolean> {
    return true;
  }

  clear(): void {
    this.sent.length = 0;
    this.failuresRemaining = 0;
  }
}

const globalForEmail = globalThis as unknown as { __radxEmail?: EmailProvider };

export function emailProvider(): EmailProvider {
  if (globalForEmail.__radxEmail) return globalForEmail.__radxEmail;

  const backend = env().EMAIL_BACKEND;
  const provider: EmailProvider =
    backend === "smtp"
      ? new SmtpEmailProvider()
      : backend === "memory"
        ? new MemoryEmailProvider()
        : new ConsoleEmailProvider();

  globalForEmail.__radxEmail = provider;
  return provider;
}

/** Test-only: inject a provider. */
export function setEmailProvider(provider: EmailProvider | undefined): void {
  globalForEmail.__radxEmail = provider;
}
