import type { Metadata } from "next";
import Link from "next/link";
import type { StaffGroup } from "@prisma/client";
import { requireAgent } from "@/lib/permissions";
import { employeeRepository, type EmployeeFilters } from "@/repositories/employee.repository";
import { employeeFilterSchema } from "@/lib/validation/employees";
import { parsePageRequest, paginate } from "@/lib/utils/pagination";
import { countryColour, countryName, COUNTRY_CODES } from "@/lib/config/countries";
import { initials, isPasswordStale } from "@/lib/utils/format";
import { CountryTile, EmptyState, PageHeader, Pagination } from "@/components/ui";
import { EmployeeFilterBar } from "@/components/employees/EmployeeFilterBar";

export const metadata: Metadata = { title: "Employees" };
export const dynamic = "force-dynamic";

const STAFF_GROUP_LABELS: Record<StaffGroup, string> = {
  staff: "Staff",
  management: "Management",
  consultant: "Consultant",
};

/** `/employees/` — active employees with country tiles (spec §5.10). */
export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAgent("/employees/");

  const raw = await searchParams;
  const query = employeeFilterSchema.parse(raw);
  const page = parsePageRequest(raw as { page?: string }, query.view === "grid" ? 24 : 25);

  const filters: EmployeeFilters = {
    activeOnly: true,
    country: query.country ?? null,
    department: query.department ?? null,
    staffGroup: (query.staffGroup as StaffGroup | undefined) ?? null,
    search: query.q ?? null,
  };

  const [{ rows, total }, countryCounts, departments, suspendedCount] = await Promise.all([
    employeeRepository.list(filters, page),
    employeeRepository.countByCountry(true),
    employeeRepository.departments(),
    employeeRepository.count({ isDeleted: false, isActive: false }),
  ]);

  const result = paginate(rows, total, page);

  const assetCounts = await employeeRepository.assetCounts(result.items.map((e) => e.id));

  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "page") continue;
    const v = Array.isArray(value) ? value[0] : value;
    if (v) params[key] = v;
  }

  const tileMap = new Map(countryCounts.map((c) => [c.site, c._count._all]));

  const viewHref = (view: "grid" | "table"): string => {
    const next = new URLSearchParams(params);
    next.set("view", view);
    next.delete("page");
    return `/employees/?${next.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Employees"
        icon="bi-people"
        subtitle="Everyone IT supports, and what they are holding"
        actions={
          <>
            <Link className="btn btn-outline-secondary btn-sm" href="/employees/health/">
              <i className="bi bi-heart-pulse me-1" aria-hidden="true" />
              Data health
            </Link>
            <div className="btn-group btn-group-sm">
              <Link className="btn btn-outline-secondary" href="/employees/register.xlsx">
                <i className="bi bi-file-earmark-excel me-1" aria-hidden="true" />
                Register (Excel)
              </Link>
              <Link className="btn btn-outline-secondary" href="/employees/register.pdf">
                <i className="bi bi-file-earmark-pdf me-1" aria-hidden="true" />
                PDF
              </Link>
            </div>
            <Link className="btn btn-outline-secondary btn-sm" href="/employees/import/">
              <i className="bi bi-upload me-1" aria-hidden="true" />
              Import CSV
            </Link>
            <Link className="btn btn-primary btn-sm" href="/employees/new/">
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />
              Add an employee
            </Link>
          </>
        }
      />

      <div className="row g-2 mb-3">
        {COUNTRY_CODES.map((code) => (
          <div className="col-6 col-lg-3" key={code}>
            <CountryTile
              code={code}
              count={tileMap.get(code) ?? 0}
              label={`${countryName(code)} — active`}
              href={`/employees/?country=${code}&view=${query.view}`}
            />
          </div>
        ))}
      </div>

      {suspendedCount > 0 && (
        <p className="small text-secondary">
          <i className="bi bi-person-dash me-1" aria-hidden="true" />
          {suspendedCount} suspended employee{suspendedCount === 1 ? "" : "s"} —{" "}
          <Link href="/employees/suspended/">view them</Link>
        </p>
      )}

      <EmployeeFilterBar
        country={query.country}
        department={query.department}
        staffGroup={query.staffGroup}
        q={query.q}
        view={query.view}
        departments={departments}
        basePath="/employees/"
      />

      <div className="d-flex justify-content-between align-items-center mb-2">
        <p className="text-secondary small mb-0">
          {total.toLocaleString()} employee{total === 1 ? "" : "s"} match
        </p>
        <div className="btn-group btn-group-sm" role="group" aria-label="View mode">
          <Link
            className={`btn btn-outline-secondary${query.view === "table" ? " active" : ""}`}
            href={viewHref("table")}
            aria-pressed={query.view === "table"}
          >
            <i className="bi bi-list-ul me-1" aria-hidden="true" />
            Table
          </Link>
          <Link
            className={`btn btn-outline-secondary${query.view === "grid" ? " active" : ""}`}
            href={viewHref("grid")}
            aria-pressed={query.view === "grid"}
          >
            <i className="bi bi-grid-3x3-gap me-1" aria-hidden="true" />
            Grid
          </Link>
        </div>
      </div>

      {result.items.length === 0 ? (
        <div className="card">
          <div className="card-body">
            <EmptyState
              icon="bi-person-x"
              title="No employees match these filters"
              hint="Adjust the filters, import a CSV, or add someone."
              action={
                <Link className="btn btn-outline-primary btn-sm" href="/employees/new/">
                  Add an employee
                </Link>
              }
            />
          </div>
        </div>
      ) : query.view === "grid" ? (
        <div className="row g-3">
          {result.items.map((employee) => (
            <div className="col-sm-6 col-lg-4 col-xxl-3" key={employee.id}>
              <Link href={`/employees/${employee.id}/`} className="text-decoration-none text-body">
                <div
                  className="asset-card"
                  style={{ ["--country-accent" as string]: countryColour(employee.site) }}
                >
                  <div className="d-flex align-items-center gap-2">
                    <span className="avatar-chip" aria-hidden="true">
                      {initials(employee.fullName)}
                    </span>
                    <div className="min-w-0">
                      <div className="fw-semibold text-truncate">{employee.fullName}</div>
                      <div className="small text-secondary text-truncate">
                        {employee.jobTitle || employee.department || "—"}
                      </div>
                    </div>
                  </div>

                  <div className="small text-secondary text-truncate">{employee.email}</div>

                  <div className="d-flex justify-content-between small text-secondary mt-auto">
                    <span>{countryName(employee.site)}</span>
                    <span title="Devices assigned">
                      <i className="bi bi-hdd me-1" aria-hidden="true" />
                      {assetCounts.active.get(employee.id) ?? 0}
                    </span>
                  </div>
                </div>
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <caption className="visually-hidden">
                Employee list, page {result.page} of {result.totalPages}
              </caption>
              <thead className="table-light">
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col" className="d-none d-md-table-cell">
                    Email
                  </th>
                  <th scope="col" className="d-none d-lg-table-cell">
                    Department
                  </th>
                  <th scope="col" className="d-none d-lg-table-cell">
                    Group
                  </th>
                  <th scope="col">Country</th>
                  <th scope="col" className="text-end">
                    Devices
                  </th>
                  <th scope="col" className="d-none d-xl-table-cell">
                    Mailbox password
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((employee) => (
                  <tr key={employee.id}>
                    <th scope="row" className="fw-normal">
                      <span
                        className="country-accent ps-2 d-inline-flex align-items-center gap-2"
                        style={{ ["--country-accent" as string]: countryColour(employee.site) }}
                      >
                        <span className="avatar-chip" aria-hidden="true">
                          {initials(employee.fullName)}
                        </span>
                        <span>
                          <Link className="text-decoration-none fw-semibold" href={`/employees/${employee.id}/`}>
                            {employee.fullName}
                          </Link>
                          {employee.jobTitle && (
                            <div className="small text-secondary">{employee.jobTitle}</div>
                          )}
                        </span>
                      </span>
                    </th>
                    <td className="small d-none d-md-table-cell">
                      <a href={`mailto:${employee.email}`}>{employee.email}</a>
                    </td>
                    <td className="small d-none d-lg-table-cell">{employee.department || "—"}</td>
                    <td className="small d-none d-lg-table-cell">
                      {STAFF_GROUP_LABELS[employee.staffGroup]}
                    </td>
                    <td className="small">{countryName(employee.site)}</td>
                    <td className="text-end small">{assetCounts.active.get(employee.id) ?? 0}</td>
                    <td className="small d-none d-xl-table-cell">
                      {employee.emailPasswordSetAt ? (
                        isPasswordStale(employee.emailPasswordSetAt) ? (
                          <span className="badge bg-warning text-dark">Over 30 days</span>
                        ) : (
                          <span className="badge bg-success">Stored</span>
                        )
                      ) : (
                        <span className="text-secondary">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination result={result} baseUrl="/employees/" params={params} itemLabel="employees" />
    </>
  );
}
