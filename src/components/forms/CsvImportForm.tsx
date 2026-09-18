"use client";

import { useActionState } from "react";
import { importAssetsCsv, importEmployeesCsv } from "@/app/(app)/assets/import/actions";
import { IDLE_STATE } from "@/lib/utils/result";
import { FormMessage } from "@/components/forms/FormField";
import { SubmitButton } from "@/components/forms/SubmitButton";

interface ImportIssue {
  row: number;
  field: string;
  message: string;
  value?: string;
}

/**
 * Shared CSV import form for assets and employees (instruction §21).
 *
 * "Rehearse" is on by default: an import that cannot be previewed is an
 * import someone will run against production by accident.
 */
export function CsvImportForm({
  kind,
  csrfToken,
  columns,
  sample,
}: {
  kind: "assets" | "employees";
  csrfToken: string;
  columns: { name: string; required: boolean; note: string }[];
  sample: string;
}) {
  const [state, action] = useActionState(
    kind === "assets" ? importAssetsCsv : importEmployeesCsv,
    IDLE_STATE,
  );

  const issues: ImportIssue[] =
    typeof state.data?.issues === "string" ? (JSON.parse(state.data.issues) as ImportIssue[]) : [];
  const issueCount = typeof state.data?.issueCount === "number" ? state.data.issueCount : 0;

  return (
    <div className="row g-3">
      <div className="col-lg-5">
        <div className="card">
          <div className="card-header">Upload</div>
          <div className="card-body">
            <form action={action}>
              <input type="hidden" name="csrf_token" value={csrfToken} />

              <FormMessage state={state} />

              <div className="mb-3">
                <label className="form-label" htmlFor="file">
                  CSV file <span className="text-danger" aria-hidden="true">*</span>
                </label>
                <input
                  className="form-control"
                  type="file"
                  id="file"
                  name="file"
                  accept=".csv,text/csv"
                  required
                  aria-describedby="file-hint"
                />
                <div className="form-text" id="file-hint">
                  Up to 5 MB and 5,000 rows. The first row must be the column headings.
                </div>
              </div>

              <div className="mb-3">
                <label className="form-label" htmlFor="mode">
                  If a record already exists
                </label>
                <select className="form-select" id="mode" name="mode" defaultValue="upsert">
                  <option value="upsert">Update it with the values in the file</option>
                  <option value="create">Skip it and report it</option>
                </select>
              </div>

              <div className="form-check mb-3">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="dryRun"
                  name="dryRun"
                  defaultChecked
                />
                <label className="form-check-label" htmlFor="dryRun">
                  Rehearse only — show me what would happen without saving
                </label>
              </div>

              <SubmitButton icon="bi-upload" pendingLabel="Importing…">
                Run import
              </SubmitButton>
            </form>
          </div>
        </div>
      </div>

      <div className="col-lg-7">
        {state.status === "success" && (
          <div className="card mb-3">
            <div className="card-header d-flex justify-content-between align-items-center">
              <span>Import report</span>
              {state.data?.dryRun ? (
                <span className="badge bg-info text-dark">Rehearsal — nothing saved</span>
              ) : (
                <span className="badge bg-success">Saved</span>
              )}
            </div>
            <div className="card-body">
              <div className="row text-center g-2 mb-3">
                <div className="col">
                  <div className="stat-tile-value h4 mb-0">{String(state.data?.totalRows ?? 0)}</div>
                  <div className="small text-secondary">Rows read</div>
                </div>
                <div className="col">
                  <div className="stat-tile-value h4 mb-0 text-success">
                    {String(state.data?.created ?? 0)}
                  </div>
                  <div className="small text-secondary">Created</div>
                </div>
                <div className="col">
                  <div className="stat-tile-value h4 mb-0 text-primary">
                    {String(state.data?.updated ?? 0)}
                  </div>
                  <div className="small text-secondary">Updated</div>
                </div>
                <div className="col">
                  <div className="stat-tile-value h4 mb-0 text-warning">
                    {String(state.data?.skipped ?? 0)}
                  </div>
                  <div className="small text-secondary">Skipped</div>
                </div>
              </div>

              {issues.length > 0 ? (
                <>
                  <h3 className="h6">
                    {issueCount} issue{issueCount === 1 ? "" : "s"}
                    {issueCount > issues.length && ` (showing the first ${issues.length})`}
                  </h3>
                  <div className="table-responsive" style={{ maxHeight: 320 }}>
                    <table className="table table-sm mb-0">
                      <caption className="visually-hidden">Rows that need attention</caption>
                      <thead className="table-light table-sticky">
                        <tr>
                          <th scope="col">Row</th>
                          <th scope="col">Column</th>
                          <th scope="col">Problem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {issues.map((issue, index) => (
                          // eslint-disable-next-line react/no-array-index-key
                          <tr key={`${issue.row}-${issue.field}-${index}`}>
                            <th scope="row" className="fw-normal">
                              {issue.row}
                            </th>
                            <td>
                              <code>{issue.field}</code>
                            </td>
                            <td className="small">
                              {issue.message}
                              {issue.value && (
                                <div className="text-secondary">
                                  Value: <code>{issue.value}</code>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="text-success small mb-0">
                  <i className="bi bi-check-circle me-1" aria-hidden="true" />
                  No problems found in that file.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-header">Columns</div>
          <div className="card-body">
            <p className="small text-secondary">
              Headings are matched loosely — “Asset Tag”, “asset_tag” and “ASSETTAG” all work.
              Anything not listed here is ignored.
            </p>
            <div className="table-responsive">
              <table className="table table-sm mb-3">
                <caption className="visually-hidden">Accepted CSV columns</caption>
                <thead className="table-light">
                  <tr>
                    <th scope="col">Column</th>
                    <th scope="col">Required</th>
                    <th scope="col">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {columns.map((column) => (
                    <tr key={column.name}>
                      <th scope="row" className="fw-normal">
                        <code>{column.name}</code>
                      </th>
                      <td>
                        {column.required ? (
                          <span className="badge bg-danger">Yes</span>
                        ) : (
                          <span className="text-secondary small">No</span>
                        )}
                      </td>
                      <td className="small">{column.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="h6">Example</h3>
            <pre className="bg-light border rounded p-2 small mb-0" style={{ overflowX: "auto" }}>
              {sample}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
