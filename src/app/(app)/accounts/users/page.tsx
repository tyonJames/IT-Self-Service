import type { Metadata } from "next";
import { requireAdmin } from "@/lib/permissions";
import { userService } from "@/services/user.service";
import { lookupRepository } from "@/repositories/lookup.repository";
import { currentCsrfToken } from "@/lib/security/csrf";
import { env } from "@/lib/config/env";
import { effectiveRole } from "@/lib/auth/session";
import { parsePageRequest, paginate } from "@/lib/utils/pagination";
import { formatDateTime, formatRelative, initials } from "@/lib/utils/format";
import { countryName } from "@/lib/config/countries";
import { Alert, EmptyState, PageHeader, Pagination, Section } from "@/components/ui";
import { CreateUserForm, RoleForm } from "@/components/accounts/AccountForms";
import { toggleUserActive } from "../actions";

export const metadata: Metadata = { title: "User accounts" };
export const dynamic = "force-dynamic";

/** `/accounts/users/` — admin-only account management (spec §4). */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdmin("/accounts/users/");

  const raw = await searchParams;
  const search = (Array.isArray(raw.q) ? raw.q[0] : raw.q) ?? "";
  const page = parsePageRequest(raw as { page?: string });

  const [{ rows, total }, countries, csrfToken] = await Promise.all([
    userService.list(search, page.skip, page.take),
    lookupRepository.countryChoices(),
    currentCsrfToken(),
  ]);

  const result = paginate(rows, total, page);

  return (
    <>
      <PageHeader
        title="User accounts"
        icon="bi-people-fill"
        subtitle="Sign-in accounts for IT staff. Everyone else uses the public portal without one."
      />

      <Alert variant="info" title="There is no public registration">
        Accounts exist only for people who need to work inside the help desk. Reporters do not need
        one — they submit at <code>/report/</code> and get updates by email.
      </Alert>

      <div className="row g-3">
        <div className="col-lg-7">
          <div className="card">
            <div className="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
              <span>Accounts ({total})</span>
              <form method="get" action="/accounts/users/" className="d-flex gap-1">
                <label className="visually-hidden" htmlFor="q">
                  Search accounts
                </label>
                <input
                  className="form-control form-control-sm"
                  type="search"
                  id="q"
                  name="q"
                  defaultValue={search}
                  placeholder="Search…"
                  maxLength={100}
                />
                <button type="submit" className="btn btn-sm btn-outline-secondary">
                  <i className="bi bi-search" aria-hidden="true" />
                  <span className="visually-hidden">Search</span>
                </button>
              </form>
            </div>

            {result.items.length === 0 ? (
              <div className="card-body">
                <EmptyState icon="bi-person-x" title="No accounts match that search" />
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <caption className="visually-hidden">User accounts</caption>
                  <thead className="table-light">
                    <tr>
                      <th scope="col">User</th>
                      <th scope="col" className="d-none d-lg-table-cell">
                        Country
                      </th>
                      <th scope="col">Role</th>
                      <th scope="col" className="d-none d-md-table-cell">
                        Last seen
                      </th>
                      <th scope="col" className="text-end">
                        Account
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((user) => {
                      const role = effectiveRole({
                        isSuperuser: user.isSuperuser,
                        isStaff: user.isStaff,
                        profileRole: user.profile?.role,
                      });
                      const isSelf = user.id === session.user.id;

                      return (
                        <tr key={user.id} className={user.isActive ? "" : "opacity-75"}>
                          <th scope="row" className="fw-normal">
                            <span className="d-inline-flex align-items-center gap-2">
                              <span className="avatar-chip" aria-hidden="true">
                                {initials(`${user.firstName} ${user.lastName}`.trim() || user.username)}
                              </span>
                              <span>
                                <span className="fw-semibold">
                                  {`${user.firstName} ${user.lastName}`.trim() || user.username}
                                </span>
                                {isSelf && <span className="badge bg-light text-dark border ms-2">You</span>}
                                <div className="small text-secondary">
                                  <code>{user.username}</code> · {user.email}
                                </div>
                              </span>
                            </span>
                          </th>
                          <td className="small d-none d-lg-table-cell">
                            {countryName(user.profile?.site ?? "")}
                          </td>
                          <td>
                            <RoleForm
                              userId={user.id}
                              currentRole={role}
                              disabled={isSelf}
                              csrfToken={csrfToken}
                            />
                            {isSelf && (
                              <div className="small text-secondary">
                                You cannot change your own role.
                              </div>
                            )}
                          </td>
                          <td className="small text-secondary d-none d-md-table-cell">
                            {user.lastLoginAt ? (
                              <span title={formatDateTime(user.lastLoginAt)}>
                                {formatRelative(user.lastLoginAt)}
                              </span>
                            ) : (
                              "Never"
                            )}
                          </td>
                          <td className="text-end">
                            <form action={toggleUserActive}>
                              <input type="hidden" name="csrf_token" value={csrfToken} />
                              <input type="hidden" name="userId" value={user.id} />
                              <input type="hidden" name="isActive" value={user.isActive ? "0" : "1"} />
                              <button
                                type="submit"
                                className={`btn btn-sm btn-outline-${user.isActive ? "danger" : "success"}`}
                                disabled={isSelf}
                                title={isSelf ? "You cannot disable your own account" : undefined}
                              >
                                {user.isActive ? "Disable" : "Enable"}
                              </button>
                            </form>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <Pagination
            result={result}
            baseUrl="/accounts/users/"
            params={search ? { q: search } : {}}
            itemLabel="accounts"
          />
        </div>

        <div className="col-lg-5">
          <Section title="Create an account" icon="bi-person-plus">
            <CreateUserForm
              countries={countries}
              csrfToken={csrfToken}
              minLength={env().PASSWORD_MIN_LENGTH}
            />
          </Section>
        </div>
      </div>
    </>
  );
}
