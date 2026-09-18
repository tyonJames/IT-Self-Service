/**
 * The shape every Server Action returns.
 *
 * Actions never throw at the UI: they return a discriminated result so the
 * form can re-render with field-level errors and keep what the user typed.
 * Unexpected errors are logged server-side and surface as a generic message —
 * stack traces never reach the browser (instruction §18, §28).
 */

export interface FormState {
  status: "idle" | "success" | "error";
  message: string;
  /** Field name → messages, for inline validation display. */
  fieldErrors?: Record<string, string[]>;
  /** Anything the page needs after a successful action (new id, reference…). */
  data?: Record<string, string | number | boolean>;
}

export const IDLE_STATE: FormState = { status: "idle", message: "" };

export function successState(message: string, data?: FormState["data"]): FormState {
  return { status: "success", message, data };
}

export function errorState(message: string, fieldErrors?: Record<string, string[]>): FormState {
  return { status: "error", message, fieldErrors };
}

/** Flatten a ZodError into the FormState shape. */
export function zodErrorState(
  error: { issues: { path: (string | number)[]; message: string }[] },
  message = "Please correct the highlighted fields.",
): FormState {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return { status: "error", message, fieldErrors };
}
