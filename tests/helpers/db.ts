import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/security/passwords";
import type { AppSession } from "@/lib/auth/session";
import type { Role } from "@prisma/client";

/**
 * Integration-test helpers.
 *
 * `resetDatabase()` truncates every table and restarts the identity sequences,
 * so each test file starts from a known state and ticket references are
 * predictable. It refuses to run against anything that does not look like a
 * test database — losing a development dataset to a stray `npm test` is a
 * mistake worth making impossible.
 */

const TABLES = [
  "_TicketRelatedAssets",
  "_EquipmentIssuedAssets",
  "equipment_statusevent",
  "equipment_requesteditem",
  "equipment_request",
  "tickets_notification",
  "tickets_comment",
  "tickets_ticketattachment",
  "tickets_ticket",
  "core_assetdocument",
  "core_devicecheckin",
  "core_asset",
  "core_employee",
  "core_auditlog",
  "accounts_passwordresettoken",
  "accounts_session",
  "accounts_userprofile",
  "auth_user",
  "core_site",
  "core_country",
  "tickets_ticketcategory",
  "equipment_itemtype",
];

function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL ?? "";
  if (!/test/i.test(url)) {
    throw new Error(
      `Refusing to truncate: DATABASE_URL does not look like a test database (${url.replace(/:[^:@]*@/, ":***@")}). Set TEST_DATABASE_URL.`,
    );
  }
}

export async function resetDatabase(): Promise<void> {
  assertTestDatabase();
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
}

export async function seedLookups(): Promise<void> {
  await prisma.country.createMany({
    data: [
      { code: "ZW", name: "Zimbabwe", sortOrder: 10 },
      { code: "MZ", name: "Mozambique", sortOrder: 20 },
      { code: "GR", name: "South Africa", sortOrder: 30 },
      { code: "NA", name: "Namibia", sortOrder: 40 },
    ],
  });

  await prisma.ticketCategory.createMany({
    data: [
      { slug: "hardware", name: "Hardware", sortOrder: 10 },
      { slug: "software", name: "Software", sortOrder: 20 },
      { slug: "network", name: "Network / Connectivity", sortOrder: 30 },
      { slug: "other", name: "Other", sortOrder: 80 },
      { slug: "phone", name: "Phone", sortOrder: 90, isActive: false },
    ],
  });

  await prisma.equipmentItemType.createMany({
    data: [
      { slug: "laptop", name: "Laptop", sortOrder: 10 },
      { slug: "monitor", name: "Monitor", sortOrder: 30 },
      { slug: "mouse", name: "Mouse", sortOrder: 50 },
      { slug: "other", name: "Something else", sortOrder: 90 },
    ],
  });
}

export async function createUser(options: {
  username: string;
  email: string;
  role: Role;
  password?: string;
  isActive?: boolean;
}): Promise<{ id: number; session: AppSession }> {
  const user = await prisma.user.create({
    data: {
      username: options.username,
      email: options.email,
      firstName: options.username,
      lastName: "Test",
      passwordHash: await hashPassword(options.password ?? "correct-horse-battery-staple"),
      isActive: options.isActive ?? true,
      isStaff: options.role !== "staff",
      isSuperuser: options.role === "admin",
      profile: { create: { role: options.role, site: "ZW" } },
    },
    select: { id: true, username: true, email: true, firstName: true, lastName: true },
  });

  return {
    id: user.id,
    session: {
      sessionId: `test-${user.id}`,
      expires: new Date(Date.now() + 3_600_000).toISOString(),
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
        firstName: user.firstName,
        lastName: user.lastName,
        role: options.role,
        isStaff: options.role !== "staff",
        isSuperuser: options.role === "admin",
        site: "ZW",
        department: "",
        phone: "",
      },
    },
  };
}

export async function createEmployee(options: {
  fullName?: string;
  email: string;
  site?: string;
  userId?: number;
  isActive?: boolean;
}): Promise<number> {
  const employee = await prisma.employee.create({
    data: {
      fullName: options.fullName ?? "Test Employee",
      email: options.email,
      site: options.site ?? "ZW",
      userId: options.userId ?? null,
      isActive: options.isActive ?? true,
    },
    select: { id: true },
  });
  return employee.id;
}

export async function createSite(name: string, country = "ZW"): Promise<number> {
  const site = await prisma.site.create({
    data: { name, code: name.slice(0, 6).toUpperCase(), siteCountry: country },
    select: { id: true },
  });
  return site.id;
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
