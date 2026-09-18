import type { Metadata } from "next";
import Link from "next/link";
import { requireAgent } from "@/lib/permissions";
import { employeeRepository } from "@/repositories/employee.repository";
import { employeeFilterSchema } from "@/lib/validation/employees";
import { parsePageRequest, paginate } from "@/lib/utils/pagination";
import { countryColour, countryName } from "@/lib/config/countries";
import { initials } from "@/lib/utils/format";
import { currentCsrfToken } from "@/lib/security/csrf";
import { EmptyState, PageHeader, Pagination } from "@/components/ui";
import { reactivateEmployee } from "../actions";

export const metadata: Metadata = { title: "Suspended employees" };
export const dynamic = "force-dynamic";

/** `/employees/suspended/` — people who have been offboarded (spec §4). */
export default async function SuspendedEmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAgent("/employees/suspended/");

  const raw = await searchParams;
  const query = employeeFilterSchema.parse(raw);
  const page = parsePageRequest(raw as { page?: string });

  const [{ rows, total }, csrfToken] = await Promise.all([
    employeeRepository.list(
      { suspendedOnly: true, country: query.country ?? null, search: query.q ?? null },
      page,
    ),
    currentCsrfToken(),
  ]);

  const result = paginate(rows, total, page);
  const assetCounts = await employeeRepository.assetCounts(result.items.map((e) => e.id));

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2">
        <ol className="breadcrumb small mb-0">
          <li className="breadcrumb-item">
            <Link href="/employees/">Employees</Link>
          </li>
          <li className="breadcrumb-item active" aria-current="page">
            Suspended
          </li>
        </ol>
      </nav>

      <PageHeader
        title="Suspended employees"
        icon="bi-person-dash"
        subtitle="People who have left or been deactivated. Devices still on their name are listed so nothing goes missing."
        actions={
          <Link className="btn btn-outline-secondary btn-sm" href="/employees/">
            Back to active employees
          </Link>
        }
      />

      {result.items.length === 0 ? (
        <div className="card">
          <div className="card-body">
            <EmptyState icon="bi-person-check" title="Nobody is suspended" hint="Everyone on file is currently active." />
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <caption className="visually-hidden">Suspended employees</caption>
              <thead className="table-light">
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col" className="d-none d-md-table-cell">
                    Email
                  </th>
                  <th scope="col" className="d-none d-lg-table-cell">
                    Department
                  </th>
                  <th scope="col">Country</th>
                  <th scope="col" className="text-end">
                    Devices still held
                  </th>
                  <th scope="col" className="text-end">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((employee) => {
                  const stillHolding = assetCounts.active.get(employee.id) ?? 0;
                  return (
                    <tr key={employee.id}>
                      <th scope="row" className="fw-normal">
                        <span
                          className="country-accent ps-2 d-inline-flex align-items-center gap-2"
                          style={{ ["--country-accent" as string]: countryColour(employee.site) }}
                        >
                          <span className="avatar-chip" aria-hidden="true">
                            {initials(employee.fullName)}
                          </span>
                          <Link className="text-decoration-none fw-semibold" href={`/employees/${employee.id}/`}>
                            {employee.fullName}
                          </Link>
                        </span>
                      </th>
                      <td className="small d-none d-md-table-cell">{employee.email}</td>
                      <td className="small d-none d-lg-table-cell">{employee.department || "—"}</td>
                      <td className="small">{countryName(employee.site)}</td>
                      <td className="text-end">
                        {stillHolding > 0 ? (
                          <span className="badge bg-warning text-dark" title="Devices still assigned to this person">
                            {stillHolding}
                          </span>
                        ) : (
                          <span className="text-secondary small">None</span>
                        )}
                      </td>
                      <td className="text-end">
                        <form action={reactivateEmployee}>
                          <input type="hidden" name="csrf_token" value={csrfToken} />
                          <input type="hidden" name="employeeId" value={employee.id} />
                          <button type="submit" className="btn btn-sm btn-outline-success">
                            <i className="bi bi-arrow-counterclockwise me-1" aria-hidden="true" />
                            Reactivate
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination result={result} baseUrl="/employees/suspended/" params={{}} itemLabel="employees" />
    </>
  );
}
