import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container py-5">
      <div className="mx-auto text-center" style={{ maxWidth: 520 }}>
        <i className="bi bi-signpost-2 display-4 text-secondary" aria-hidden="true" />
        <h1 className="h4 mt-3">Page not found</h1>
        <p className="text-secondary">
          That page does not exist, or the record it pointed at has been deleted.
        </p>
        <div className="d-flex gap-2 justify-content-center">
          <Link className="btn btn-primary" href="/tickets/reports/">
            Go to the dashboard
          </Link>
          <Link className="btn btn-outline-secondary" href="/help/">
            Self-service portal
          </Link>
        </div>
      </div>
    </div>
  );
}
