/** Skeleton for the dashboard so the layout does not jump when data lands. */
export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading the dashboard…</span>

      <div className="placeholder-glow mb-3">
        <span className="placeholder col-3" style={{ height: "1.75rem" }} />
      </div>

      <div className="row g-3 mb-3">
        {[0, 1, 2, 3].map((i) => (
          <div className="col-6 col-lg-3" key={i}>
            <div className="stat-tile placeholder-glow">
              <span className="placeholder col-6 mb-2" />
              <span className="placeholder col-4" style={{ height: "1.9rem" }} />
            </div>
          </div>
        ))}
      </div>

      <div className="row g-3">
        {[0, 1, 2].map((i) => (
          <div className="col-lg-4" key={i}>
            <div className="card">
              <div className="card-body placeholder-glow" style={{ height: 300 }}>
                <span className="placeholder col-12 h-100" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
