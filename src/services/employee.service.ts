import type { StaffGroup } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { normaliseCountryCode } from "@/lib/config/countries";
import { fernetEncrypt, safeFernetDecrypt } from "@/lib/security/fernet";
import { auditService } from "./audit.service";
import { assetService } from "./asset.service";
import { SecurityEvent } from "@/lib/logging/logger";
import { softDeleteData } from "@/repositories/soft-delete";
import { revokeAllForUser } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/permissions";
import type { AppSession } from "@/lib/auth/session";

/**
 * Employee business logic, including the encrypted temporary mailbox password
 * (spec §3.7).
 *
 * The password is stored as Fernet ciphertext, revealed only through an
 * authenticated, audited call, and never included in any export, log line or
 * list projection — `employeeListSelect` deliberately omits the column and
 * exposes only `emailPasswordSetAt` so the UI can show the stale badge.
 */

export class EmployeeValidationError extends Error {
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = "EmployeeValidationError";
  }
}

export interface EmployeeWriteInput {
  fullName: string;
  email: string;
  phone: string;
  department: string;
  jobTitle: string;
  site: string;
  employeeNumber: string | null;
  staffGroup: StaffGroup;
  altEmail: string;
  isActive: boolean;
  notes: string;
  userId: number | null;
}

async function assertUnique(
  input: { email: string; employeeNumber: string | null },
  excludeId: number | null,
): Promise<void> {
  const byEmail = await prisma.employee.findFirst({
    where: { email: input.email },
    select: { id: true, isDeleted: true },
  });
  if (byEmail && byEmail.id !== excludeId) {
    throw new EmployeeValidationError(
      byEmail.isDeleted
        ? "An employee in the recycle bin already uses that email address. Restore or purge it first."
        : "Another employee already uses that email address.",
      "email",
    );
  }

  if (input.employeeNumber) {
    const byNumber = await prisma.employee.findFirst({
      where: { employeeNumber: input.employeeNumber },
      select: { id: true },
    });
    if (byNumber && byNumber.id !== excludeId) {
      throw new EmployeeValidationError("That employee number is already in use.", "employeeNumber");
    }
  }
}

export const employeeService = {
  async create(session: AppSession, input: EmployeeWriteInput): Promise<number> {
    await assertUnique(input, null);

    const employee = await prisma.employee.create({
      data: {
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        department: input.department,
        jobTitle: input.jobTitle,
        site: normaliseCountryCode(input.site),
        // Blank employee numbers must be NULL, not '', for the same reason
        // asset tags must be: '' collides with itself under a unique index.
        employeeNumber: input.employeeNumber || null,
        staffGroup: input.staffGroup,
        altEmail: input.altEmail,
        isActive: input.isActive,
        notes: input.notes,
        userId: input.userId,
      },
      select: { id: true, fullName: true },
    });

    await auditService.record({
      event: SecurityEvent.EMPLOYEE_CREATED,
      message: `Employee ${employee.fullName} created`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Employee",
      targetId: employee.id,
    });

    return employee.id;
  },

  async update(session: AppSession, id: number, input: EmployeeWriteInput): Promise<void> {
    const existing = await prisma.employee.findFirst({ where: { id, isDeleted: false }, select: { id: true } });
    if (!existing) throw new ForbiddenError("That employee no longer exists.");

    await assertUnique(input, id);

    await prisma.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id },
        data: {
          fullName: input.fullName,
          email: input.email,
          phone: input.phone,
          department: input.department,
          jobTitle: input.jobTitle,
          site: normaliseCountryCode(input.site),
          employeeNumber: input.employeeNumber || null,
          staffGroup: input.staffGroup,
          altEmail: input.altEmail,
          isActive: input.isActive,
          notes: input.notes,
          userId: input.userId,
        },
      });

      // Keep the assets' denormalised holder columns in step with the rename.
      await tx.asset.updateMany({
        where: { assignedEmployeeId: id, isDeleted: false },
        data: { assignedToName: input.fullName, assignedToUserId: input.userId },
      });
    });

    await auditService.record({
      event: SecurityEvent.EMPLOYEE_CREATED,
      message: `Employee ${input.fullName} updated`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Employee",
      targetId: id,
    });
  },

  async softDelete(session: AppSession, id: number): Promise<void> {
    const employee = await prisma.employee.findFirst({
      where: { id, isDeleted: false },
      select: { id: true, fullName: true },
    });
    if (!employee) throw new ForbiddenError("That employee no longer exists.");

    await prisma.employee.update({ where: { id }, data: softDeleteData(session.user.id) });

    await auditService.record({
      event: SecurityEvent.EMPLOYEE_DELETED,
      message: `Employee ${employee.fullName} moved to the recycle bin`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Employee",
      targetId: id,
      level: "WARNING",
    });
  },

  /**
   * Offboarding (spec §5.9): deactivate the employee, mark their devices as
   * awaiting return, clear the stored mailbox password, and end any login
   * session they hold. One transaction — a half-completed offboarding is worse
   * than none.
   */
  async offboard(session: AppSession, id: number): Promise<{ assetsAffected: number }> {
    const employee = await prisma.employee.findFirst({
      where: { id, isDeleted: false },
      select: { id: true, fullName: true, userId: true },
    });
    if (!employee) throw new ForbiddenError("That employee no longer exists.");

    const assetsAffected = await prisma.$transaction(async (tx) => {
      const count = await assetService.retireAssetsForEmployee(tx, id);
      await tx.employee.update({
        where: { id },
        data: {
          isActive: false,
          emailPasswordEnc: null,
          emailPasswordSetAt: null,
        },
      });
      if (employee.userId) {
        await tx.user.update({ where: { id: employee.userId }, data: { isActive: false } });
      }
      return count;
    });

    if (employee.userId) {
      await revokeAllForUser(employee.userId);
    }

    await auditService.record({
      event: SecurityEvent.EMPLOYEE_OFFBOARDED,
      message: `Employee ${employee.fullName} offboarded; ${assetsAffected} device(s) marked return-pending`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Employee",
      targetId: id,
      level: "WARNING",
      detail: { assetsAffected },
    });

    return { assetsAffected };
  },

  async reactivate(session: AppSession, id: number): Promise<void> {
    const employee = await prisma.employee.findFirst({
      where: { id, isDeleted: false },
      select: { id: true, fullName: true, userId: true },
    });
    if (!employee) throw new ForbiddenError("That employee no longer exists.");

    await prisma.$transaction(async (tx) => {
      await tx.employee.update({ where: { id }, data: { isActive: true } });
      if (employee.userId) {
        await tx.user.update({ where: { id: employee.userId }, data: { isActive: true } });
      }
    });

    await auditService.record({
      event: SecurityEvent.EMPLOYEE_REACTIVATED,
      message: `Employee ${employee.fullName} reactivated`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Employee",
      targetId: id,
    });
  },

  // --- Encrypted temporary password -------------------------------------

  async setTemporaryPassword(session: AppSession, id: number, password: string): Promise<void> {
    const employee = await prisma.employee.findFirst({
      where: { id, isDeleted: false },
      select: { id: true, fullName: true },
    });
    if (!employee) throw new ForbiddenError("That employee no longer exists.");

    await prisma.employee.update({
      where: { id },
      data: { emailPasswordEnc: fernetEncrypt(password), emailPasswordSetAt: new Date() },
    });

    await auditService.record({
      event: SecurityEvent.EMPLOYEE_PASSWORD_CLEARED,
      message: `Temporary mailbox password stored for ${employee.fullName}`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Employee",
      targetId: id,
      // The password itself is never passed to the audit call.
    });
  },

  /**
   * Reveal the temporary password. Every reveal is audited with who, when and
   * from where — this is the one operation in the system that hands a
   * credential back to a human (spec §3.7).
   */
  async revealTemporaryPassword(
    session: AppSession,
    id: number,
    ipAddress: string,
  ): Promise<{ password: string; setAt: Date | null }> {
    const employee = await prisma.employee.findFirst({
      where: { id, isDeleted: false },
      select: { id: true, fullName: true, emailPasswordEnc: true, emailPasswordSetAt: true },
    });
    if (!employee) throw new ForbiddenError("That employee no longer exists.");

    await auditService.record({
      event: SecurityEvent.EMPLOYEE_PASSWORD_REVEALED,
      message: `Temporary mailbox password revealed for ${employee.fullName}`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Employee",
      targetId: id,
      ipAddress,
      level: "WARNING",
    });

    return {
      password: safeFernetDecrypt(employee.emailPasswordEnc),
      setAt: employee.emailPasswordSetAt,
    };
  },

  async clearTemporaryPassword(session: AppSession, id: number): Promise<void> {
    const employee = await prisma.employee.findFirst({
      where: { id, isDeleted: false },
      select: { id: true, fullName: true },
    });
    if (!employee) throw new ForbiddenError("That employee no longer exists.");

    await prisma.employee.update({
      where: { id },
      data: { emailPasswordEnc: null, emailPasswordSetAt: null },
    });

    await auditService.record({
      event: SecurityEvent.EMPLOYEE_PASSWORD_CLEARED,
      message: `Temporary mailbox password cleared for ${employee.fullName}`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Employee",
      targetId: id,
    });
  },
};
