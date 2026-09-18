import type { Metadata } from "next";
import Link from "next/link";
import { requireAgent } from "@/lib/permissions";
import { lookupRepository } from "@/repositories/lookup.repository";
import { prisma } from "@/lib/db/prisma";
import { currentCsrfToken } from "@/lib/security/csrf";
import { PageHeader } from "@/components/ui";
import { EmployeeForm, type EmployeeFormValues } from "@/components/employees/EmployeePanels";

export const metadata: Metadata = { title: "Add an employee" };
export const dynamic = "force-dynamic";

const EMPTY: EmployeeFormValues = {
  fullName: "",
  email: "",
  phone: "",
  department: "",
  jobTitle: "",
  site: "ZW",
  employeeNumber: "",
  staffGroup: "staff",
  altEmail: "",
  isActive: true,
  notes: "",
  userId: "",
};

/** `/employees/new/` */
export default async function NewEmployeePage() {
  await requireAgent("/employees/new/");

  const [countries, users, csrfToken] = await Promise.all([
    lookupRepository.countryChoices(),
    prisma.user.findMany({
      where: { isActive: true, employee: null },
      select: { id: true, username: true, firstName: true, lastName: true, email: true },
      orderBy: { username: "asc" },
    }),
    currentCsrfToken(),
  ]);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2">
        <ol className="breadcrumb small mb-0">
          <li className="breadcrumb-item">
            <Link href="/employees/">Employees</Link>
          </li>
          <li className="breadcrumb-item active" aria-current="page">
            Add an employee
          </li>
        </ol>
      </nav>

      <PageHeader title="Add an employee" icon="bi-person-plus" />

      <EmployeeForm
        mode="create"
        values={EMPTY}
        countries={countries}
        users={users.map((u) => ({
          id: u.id,
          label: `${`${u.firstName} ${u.lastName}`.trim() || u.username} (${u.email})`,
        }))}
        csrfToken={csrfToken}
      />
    </>
  );
}
