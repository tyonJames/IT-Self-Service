"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  confirmPasswordReset,
  requestPasswordReset,
} from "@/app/accounts/password-reset/actions";
import { IDLE_STATE } from "@/lib/utils/result";
import { FormMessage, TextField } from "@/components/forms/FormField";
import { SubmitButton } from "@/components/forms/SubmitButton";

export function PasswordResetRequestForm({ csrfToken }: { csrfToken: string }) {
  const [state, action] = useActionState(requestPasswordReset, IDLE_STATE);

  return (
    <form action={action} noValidate>
      <input type="hidden" name="csrf_token" value={csrfToken} />
      <FormMessage state={state} />

      {state.status !== "success" && (
        <>
          <TextField
            name="email"
            label="Your work email address"
            type="email"
            inputMode="email"
            required
            autoComplete="email"
            state={state}
          />
          <div className="d-grid">
            <SubmitButton icon="bi-envelope" pendingLabel="Sending…">
              Send reset link
            </SubmitButton>
          </div>
        </>
      )}

      <div className="text-center mt-3 small">
        <Link href="/accounts/login/">Back to sign in</Link>
      </div>
    </form>
  );
}

export function PasswordResetConfirmForm({
  csrfToken,
  token,
  minLength,
}: {
  csrfToken: string;
  token: string;
  minLength: number;
}) {
  const [state, action] = useActionState(confirmPasswordReset, IDLE_STATE);

  if (state.status === "success") {
    return (
      <>
        <FormMessage state={state} />
        <div className="d-grid">
          <Link className="btn btn-primary" href="/accounts/login/">
            Sign in
          </Link>
        </div>
      </>
    );
  }

  return (
    <form action={action} noValidate>
      <input type="hidden" name="csrf_token" value={csrfToken} />
      <input type="hidden" name="token" value={token} />

      <FormMessage state={state} />

      <TextField
        name="password"
        label="New password"
        type="password"
        required
        autoComplete="new-password"
        hint={`At least ${minLength} characters. A short phrase you will remember beats a jumble you will not.`}
        state={state}
      />

      <TextField
        name="confirmPassword"
        label="Confirm new password"
        type="password"
        required
        autoComplete="new-password"
        state={state}
      />

      <div className="d-grid">
        <SubmitButton icon="bi-shield-check" pendingLabel="Saving…">
          Set new password
        </SubmitButton>
      </div>
    </form>
  );
}
