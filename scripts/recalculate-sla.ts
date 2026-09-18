import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { slaDueDate } from "../src/lib/sla/sla";

/**
 * Recalculate `due_date` on open tickets from their creation time and current
 * priority.
 *
 * Provided against CC-002: if Radx confirms the SLA targets were transcribed
 * the wrong way round, changing `SLA_TARGET_HOURS` fixes new tickets, and this
 * script restates the ones already in flight. Resolved and closed tickets are
 * left alone — their deadline is a historical fact and rewriting it would
 * silently change past compliance figures.
 *
 *   npx tsx scripts/recalculate-sla.ts            # dry run
 *   npx tsx scripts/recalculate-sla.ts --apply    # write
 */
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const tickets = await prisma.ticket.findMany({
    where: { isDeleted: false, status: { notIn: ["resolved", "closed"] } },
    select: { id: true, priority: true, createdAt: true, dueDate: true },
    orderBy: { id: "asc" },
  });

  let changed = 0;

  for (const ticket of tickets) {
    const expected = slaDueDate(ticket.createdAt, ticket.priority);
    if (ticket.dueDate && Math.abs(ticket.dueDate.getTime() - expected.getTime()) < 60_000) {
      continue;
    }

    changed += 1;
    console.log(
      `RDX-${String(ticket.id).padStart(4, "0")}  ${ticket.priority.padEnd(8)}  ${ticket.dueDate?.toISOString() ?? "none"} → ${expected.toISOString()}`,
    );

    if (apply) {
      await prisma.ticket.update({ where: { id: ticket.id }, data: { dueDate: expected } });
    }
  }

  console.log(
    `\n${changed} of ${tickets.length} open ticket(s) ${apply ? "updated" : "would change"}.`,
  );
  if (!apply && changed > 0) console.log("Re-run with --apply to write the changes.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
