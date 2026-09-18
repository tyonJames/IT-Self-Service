"use server";

import { redirect } from "next/navigation";
import { publicTicketSchema } from "@/lib/validation/tickets";
import { filesFromFormData, formDataToObject } from "@/lib/validation/common";
import { assertCsrf, CsrfError } from "@/lib/security/csrf";
import { clientIp } from "@/lib/security/request";
import { rateLimiter } from "@/lib/security/rate-limit";
import { env } from "@/lib/config/env";
import { ticketService } from "@/services/ticket.service";
import { errorState, zodErrorState, type FormState } from "@/lib/utils/result";
import { UploadRejectedError } from "@/lib/security/uploads";
import { SecurityEvent, securityLog } from "@/lib/logging/logger";
import { logger } from "@/lib/logging/logger";
import { prisma } from "@/lib/db/prisma";

/**
 * Public ticket submission (spec §5.1).
 *
 * Anti-abuse, in order: CSRF + trusted origin, honeypot, per-IP rate limit,
 * Zod validation, then per-file upload validation. Priority is never taken
 * from the form — a public submission always starts at medium and an agent
 * triages it.
 */
export async function submitPublicTicket(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await assertCsrf(formData);
  } catch (error) {
    if (error instanceof CsrfError) return errorState(error.message);
    throw error;
  }

  const ip = await clientIp();
  const e = env();

  const limit = await rateLimiter().hit(
    `public:ticket:${ip}`,
    e.PUBLIC_FORM_MAX_PER_WINDOW,
    e.PUBLIC_FORM_WINDOW_SECONDS,
  );

  if (!limit.allowed) {
    securityLog(SecurityEvent.RATE_LIMITED, "Public ticket form rate limited", "WARNING", { ip });
    return errorState(
      `You have submitted several requests already. Please wait about ${Math.ceil(limit.retryAfterSeconds / 60)} minutes, or call IT if it is urgent.`,
    );
  }

  const parsed = publicTicketSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return zodErrorState(parsed.error);
  }

  const input = parsed.data;

  // The honeypot is validated by the schema (it must be empty). Reaching here
  // with content is impossible, but a bot that clears it still faces the rate
  // limit above.

  // The category must be a real, active category — never whatever the form posted.
  const category = await prisma.ticketCategory.findFirst({
    where: { slug: input.category, isActive: true },
    select: { slug: true },
  });
  if (!category) {
    return errorState("Please choose an issue category from the list.", {
      category: ["Choose a category from the list."],
    });
  }

  const files = filesFromFormData(formData, "attachments").slice(0, 5);

  let created;
  try {
    created = await ticketService.create(
      {
        title: input.title,
        description: input.description,
        category: category.slug,
        deviceType: input.deviceType,
        anydeskId: input.anydeskId,
        country: input.country,
        siteName: input.siteName,
        assetNumber: input.assetNumber,
        submitterName: input.submitterName,
        submitterEmail: input.submitterEmail,
        sendCopy: input.sendCopy,
        submittedPublicly: true,
        createdById: null,
        ipAddress: ip,
      },
      files,
    );
  } catch (error) {
    if (error instanceof UploadRejectedError) {
      return errorState(error.message, { attachments: [error.message] });
    }
    logger().error({ err: (error as Error).message }, "Public ticket submission failed");
    return errorState(
      "We could not log your request just now. Please try again, or call IT if it is urgent.",
    );
  }

  redirect(`/report/sent/?ref=${encodeURIComponent(created.reference)}`);
}
