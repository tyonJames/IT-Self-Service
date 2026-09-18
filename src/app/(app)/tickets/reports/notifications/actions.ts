"use server";

import { revalidatePath } from "next/cache";
import { notificationService } from "@/services/notification.service";
import { assertCsrf, CsrfError } from "@/lib/security/csrf";
import { requireAgent, ForbiddenError } from "@/lib/permissions";
import { errorState, successState, type FormState } from "@/lib/utils/result";
import { logger } from "@/lib/logging/logger";

/** Retry a failed email from the notification log (spec §5.4). */
export async function retryNotification(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await assertCsrf(formData);
    await requireAgent();

    const raw = String(formData.get("notificationId") ?? "");
    let notificationId: bigint;
    try {
      notificationId = BigInt(raw);
    } catch {
      return errorState("That notification could not be found.");
    }

    const sent = await notificationService.retry(notificationId);
    revalidatePath("/tickets/reports/notifications/");

    return sent
      ? successState("Sent.")
      : errorState(
          "Still failing. Check the error text below — after five attempts a notification stops retrying.",
        );
  } catch (error) {
    if (error instanceof CsrfError) return errorState(error.message);
    if (error instanceof ForbiddenError) return errorState(error.message);
    logger().error({ err: (error as Error).message }, "Notification retry failed");
    return errorState("Something went wrong retrying that email.");
  }
}

/** Retry everything retryable — the same work the scheduled job does. */
export async function retryAllNotifications(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await assertCsrf(formData);
    await requireAgent();

    const { attempted, sent } = await notificationService.retryAllFailed(100);
    revalidatePath("/tickets/reports/notifications/");

    if (attempted === 0) return successState("Nothing was waiting to be retried.");
    return successState(`Retried ${attempted}; ${sent} went out.`);
  } catch (error) {
    if (error instanceof CsrfError) return errorState(error.message);
    if (error instanceof ForbiddenError) return errorState(error.message);
    logger().error({ err: (error as Error).message }, "Bulk notification retry failed");
    return errorState("Something went wrong retrying those emails.");
  }
}
