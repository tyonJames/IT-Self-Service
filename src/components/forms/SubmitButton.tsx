"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button that disables itself and shows a spinner while the Server
 * Action runs — the loading state every mutating form needs (instruction §28),
 * and the double-submit guard.
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  icon,
  className = "",
  size,
  confirm,
  name,
  value,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: string;
  icon?: string;
  className?: string;
  size?: "sm" | "lg";
  /** When set, the browser asks this before submitting. */
  confirm?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name={name}
      value={value}
      className={`btn btn-${variant}${size ? ` btn-${size}` : ""} ${className}`.trim()}
      disabled={pending}
      aria-busy={pending}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) {
          event.preventDefault();
        }
      }}
    >
      {pending ? (
        <>
          <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
          {pendingLabel ?? "Working…"}
        </>
      ) : (
        <>
          {icon && <i className={`bi ${icon} me-1`} aria-hidden="true" />}
          {children}
        </>
      )}
    </button>
  );
}
