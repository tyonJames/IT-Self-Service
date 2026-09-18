import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAgent } from "@/lib/permissions";
import { employeeRepository } from "@/repositories/employee.repository";
import { lookupRepository } from "@/repositories/lookup.repository";
import { prisma } from "@/lib/db/prisma";
import { currentCsrfToken } from "@/lib/security/csrf";
import { PageHeader } from "@/components/ui";
import { EmployeeForm, type EmployeeFormValues } from "@/components/employees/EmployeePanels";

export const metadata: Metadata = { title: "Edit employee" };
export const dynamic = "force-dynamic";

/** `/employees/{id}/edit/` */
export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAgent();

  const { id } = await params;
  const employeeId = Number.parseInt(id, 10);
  if (!Number.isSafeInteger(employeeId) || employeeId <= 0) notFound();

  const employee = await employeeRepository.findById(employeeId);
  if (!employee) notFound();

  const [countries, users, csrfToken] = await Promise.all([
    lookupRepository.countryChoices(),
    prisma.user.findMany({
      where: {
        isActive: true,
        OR: [{ employee: null }, { id: employee.userId ?? -1 }],
      },
      select: { id: true, username: true, firstName: true, lastName: true, email: true },
      orderBy: { username: "asc" },
    }),
    currentCsrfToken(),
  ]);

  const values: EmployeeFormValues = {
    id: employee.id,
    fullName: employee.fullName,
    email: employee.email,
    phone: employee.phone,
    department: employee.department,
    jobTitle: employee.jobTitle,
    site: employee.site,
    employeeNumber: employee.employeeNumber ?? "",
    staffGroup: employee.staffGroup,
    altEmail: employee.altEmail,
    isActive: employee.isActive,
    notes: employee.notes,
    userId: employee.userId ? String(employee.userId) : "",
  };

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2">
        <ol className="breadcrumb small mb-0">
          <li className="breadcrumb-item">
            <Link href="/employees/">Employees</Link>
          </li>
          <li className="breadcrumb-item">
            <Link href={`/employees/${employee.id}/`}>{employee.fullName}</Link>
          </li>
          <li className="breadcrumb-item active" aria-current="page">
            Edit
          </li>
        </ol>
      </nav>

      <PageHeader title={`Edit ${employee.fullName}`} icon="bi-pencil-square" />

      <EmployeeForm
        mode="edit"
        values={values}
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
