"use client";

import { useActionState } from "react";
import {
  retryAllNotifications,
  retryNotification,
} from "@/app/(app)/tickets/reports/notifications/actions";
import { IDLE_STATE } from "@/lib/utils/result";
import { FormMessage } from "@/components/forms/FormField";
import { SubmitButton } from "@/components/forms/SubmitButton";

export function RetryButton({
  notificationId,
  disabled,
  csrfToken,
}: {
  notificationId: string;
  disabled: boolean;
  csrfToken: string;
}) {
  const [state, action] = useActionState(retryNotification, IDLE_STATE);

  if (disabled) {
    return (
      <span className="small text-secondary" title="Five attempts have been made">
        Gave up
      </span>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="csrf_token" value={csrfToken} />
      <input type="hidden" name="notificationId" value={notificationId} />
      <SubmitButton size="sm" variant="outline-primary" pendingLabel="…">
        <i className="bi bi-arrow-repeat me-1" aria-hidden="true" />
        Retry
      </SubmitButton>
      {state.status === "error" && (
        <span className="visually-hidden" role="alert">
          {state.message}
        </span>
      )}
    </form>
  );
}

export function RetryAllPanel({ csrfToken, pending }: { csrfToken: string; pending: number }) {
  const [state, action] = useActionState(retryAllNotifications, IDLE_STATE);

  return (
    <>
      <FormMessage state={state} />
      <form action={action}>
        <input type="hidden" name="csrf_token" value={csrfToken} />
        <SubmitButton
          size="sm"
          variant="outline-primary"
          icon="bi-arrow-repeat"
          pendingLabel="Retrying…"
        >
          Retry all {pending > 0 ? `(${pending})` : ""}
        </SubmitButton>
      </form>
    </>
  );
}
