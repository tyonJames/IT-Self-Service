export default function Loading() {
  return (
    <div className="d-flex align-items-center justify-content-center py-5" role="status">
      <span className="spinner-border text-success me-2" aria-hidden="true" />
      <span>Loading…</span>
    </div>
  );
}
