"use client";

import { useActionState } from "react";
import { signIn } from "@/app/accounts/login/actions";
import { IDLE_STATE } from "@/lib/utils/result";
import { FormMessage, TextField } from "@/components/forms/FormField";
import { SubmitButton } from "@/components/forms/SubmitButton";

export function LoginForm({ csrfToken, next }: { csrfToken: string; next: string }) {
  const [state, action] = useActionState(signIn, IDLE_STATE);

  return (
    <form action={action} noValidate>
      <input type="hidden" name="csrf_token" value={csrfToken} />
      <input type="hidden" name="next" value={next} />

      <FormMessage state={state} />

      <TextField
        name="identifier"
        label="Email address or username"
        required
        autoComplete="username"
        inputMode="email"
        state={state}
      />

      <TextField
        name="password"
        label="Password"
        type="password"
        required
        autoComplete="current-password"
        state={state}
      />

      <div className="d-grid">
        <SubmitButton icon="bi-box-arrow-in-right" pendingLabel="Signing in…">
          Sign in
        </SubmitButton>
      </div>
    </form>
  );
}
