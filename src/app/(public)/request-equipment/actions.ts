"use server";

import { redirect } from "next/navigation";
import { parseRequestedItems, publicEquipmentRequestSchema } from "@/lib/validation/equipment";
import { formDataToObject } from "@/lib/validation/common";
import { assertCsrf, CsrfError } from "@/lib/security/csrf";
import { clientIp } from "@/lib/security/request";
import { rateLimiter } from "@/lib/security/rate-limit";
import { env } from "@/lib/config/env";
import { equipmentService } from "@/services/equipment.service";
import { errorState, zodErrorState, type FormState } from "@/lib/utils/result";
import { SecurityEvent, securityLog, logger } from "@/lib/logging/logger";
import { prisma } from "@/lib/db/prisma";

/** Public equipment request submission (spec §5.2). */
export async function submitEquipmentRequest(
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
    `public:equipment:${ip}`,
    e.PUBLIC_FORM_MAX_PER_WINDOW,
    e.PUBLIC_FORM_WINDOW_SECONDS,
  );
  if (!limit.allowed) {
    securityLog(SecurityEvent.RATE_LIMITED, "Public equipment form rate limited", "WARNING", { ip });
    return errorState(
      `You have sent several requests already. Please wait about ${Math.ceil(limit.retryAfterSeconds / 60)} minutes before sending another.`,
    );
  }

  const parsed = publicEquipmentRequestSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return zodErrorState(parsed.error);

  const input = parsed.data;

  // Only item types that actually exist and are active may be requested —
  // the checkbox values are never trusted on their own.
  const submitted = parseRequestedItems(formData);
  const validTypes = await prisma.equipmentItemType.findMany({
    where: { slug: { in: submitted.map((s) => s.item) }, isActive: true },
    select: { slug: true },
  });
  const validSlugs = new Set(validTypes.map((t) => t.slug));
  const items = submitted.filter((s) => validSlugs.has(s.item));

  if (items.length === 0 && !input.otherEquipment.trim()) {
    return errorState("Tell us what you need.", {
      items: ["Tick at least one item, or describe what you need under “Something else”."],
    });
  }

  let requestId: number;
  try {
    requestId = await equipmentService.create({
      requesterName: input.requesterName,
      requesterEmail: input.requesterEmail,
      department: input.department,
      country: input.country,
      siteName: input.siteName,
      siteId: input.siteId,
      otherEquipment: input.otherEquipment,
      reason: input.reason,
      justification: input.justification,
      priority: input.priority,
      sendCopy: input.sendCopy,
      items,
      ipAddress: ip,
    });
  } catch (error) {
    logger().error({ err: (error as Error).message }, "Public equipment request failed");
    return errorState("We could not log your request just now. Please try again in a moment.");
  }

  redirect(`/request-equipment/sent/${requestId}/`);
}
