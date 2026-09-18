"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Error boundary for the authenticated area.
 *
 * `ForbiddenError` thrown by the permission helpers surfaces here; it is shown
 * as a clear "you do not have access" rather than a generic failure, because
 * the two need different reactions from the user.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("Application error", { digest: error.digest });
  }, [error]);

  const isForbidden = error.name === "ForbiddenError";

  return (
    <div className="mx-auto" style={{ maxWidth: 560 }}>
      <div className="card mt-4">
        <div className="card-body text-center p-4">
          <i
            className={`bi ${isForbidden ? "bi-shield-lock" : "bi-exclamation-octagon"} display-5 ${isForbidden ? "text-warning" : "text-danger"}`}
            aria-hidden="true"
          />
          <h1 className="h5 mt-3">{isForbidden ? "You do not have access to that" : "Something went wrong"}</h1>
          <p className="text-secondary">
            {isForbidden
              ? error.message || "Ask an administrator if you think you should have access."
              : "That page could not be loaded. The problem has been logged."}
          </p>
          {!isForbidden && error.digest && (
            <p className="small text-secondary mb-3">
              Reference: <code>{error.digest}</code>
            </p>
          )}
          <div className="d-flex gap-2 justify-content-center">
            {!isForbidden && (
              <button type="button" className="btn btn-primary" onClick={reset}>
                Try again
              </button>
            )}
            <Link className="btn btn-outline-secondary" href="/tickets/reports/">
              Back to the dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
