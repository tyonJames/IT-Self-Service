import { requireAuthenticatedUser } from "@/lib/permissions";
import { currentCsrfToken } from "@/lib/security/csrf";
import { prisma } from "@/lib/db/prisma";
import { AppShell } from "@/components/layout/AppShell";
import { OPEN_TICKET_STATUSES } from "@/lib/domain/tickets";
import { OPEN_EQUIPMENT_STATUSES } from "@/lib/domain/equipment-status";
import { isAgentOrAdmin } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * Authenticated shell.
 *
 * The session check here is a convenience for redirecting cleanly — it is not
 * the security boundary. Every page and Server Action below re-checks, because
 * a layout does not run for a Server Action invoked from a cached page.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuthenticatedUser();
  const csrfToken = await currentCsrfToken();

  const agent = isAgentOrAdmin(session.user.role);

  // Staff see counts for their own tickets only — a badge must not leak the
  // size of the queue to someone who cannot see the queue.
  const staffScope = agent
    ? {}
    : {
        OR: [
          { createdById: session.user.id },
          { submitterEmail: { equals: session.user.email, mode: "insensitive" as const } },
          { employee: { userId: session.user.id } },
        ],
      };

  const [openTickets, overdueTickets, openEquipment, recycleBin] = await Promise.all([
    prisma.ticket.count({
      where: { isDeleted: false, status: { in: OPEN_TICKET_STATUSES }, ...staffScope },
    }),
    prisma.ticket.count({
      where: {
        isDeleted: false,
        status: { notIn: ["resolved", "closed"] },
        dueDate: { not: null, lt: new Date() },
        ...staffScope,
      },
    }),
    agent
      ? prisma.equipmentRequest.count({
          where: { isDeleted: false, status: { in: OPEN_EQUIPMENT_STATUSES } },
        })
      : Promise.resolve(0),
    agent
      ? Promise.all([
          prisma.asset.count({ where: { isDeleted: true } }),
          prisma.employee.count({ where: { isDeleted: true } }),
          prisma.ticket.count({ where: { isDeleted: true } }),
          prisma.equipmentRequest.count({ where: { isDeleted: true } }),
        ]).then((counts) => counts.reduce((a, b) => a + b, 0))
      : Promise.resolve(0),
  ]);

  return (
    <AppShell
      name={session.user.name}
      role={session.user.role}
      csrfToken={csrfToken}
      counts={{ openTickets, overdueTickets, openEquipment, recycleBin }}
    >
      {children}
    </AppShell>
  );
}
