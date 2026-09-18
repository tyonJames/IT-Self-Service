"use client";

import { useEffect } from "react";

/**
 * Global error boundary.
 *
 * The user sees a friendly message and a digest they can quote to IT; the
 * stack trace stays in the server logs, never in the browser (instruction §28).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("Unhandled application error", { digest: error.digest });
  }, [error]);

  return (
    <div className="container py-5">
      <div className="mx-auto" style={{ maxWidth: 560 }}>
        <div className="card">
          <div className="card-body text-center p-4">
            <i className="bi bi-exclamation-octagon display-5 text-danger" aria-hidden="true" />
            <h1 className="h4 mt-3">Something went wrong</h1>
            <p className="text-secondary">
              That page could not be loaded. The problem has been logged and the IT team can see it.
            </p>
            {error.digest && (
              <p className="small text-secondary mb-4">
                Quote this reference if you report it: <code>{error.digest}</code>
              </p>
            )}
            <div className="d-flex gap-2 justify-content-center">
              <button type="button" className="btn btn-primary" onClick={reset}>
                <i className="bi bi-arrow-clockwise me-1" aria-hidden="true" />
                Try again
              </button>
              <a className="btn btn-outline-secondary" href="/tickets/reports/">
                Back to the dashboard
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
