import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Seed the lookup tables with the defaults from spec §9.
 *
 * Idempotent: every row is upserted by its natural key, so running this
 * against an existing database refreshes labels and sort orders without
 * touching anything else. No administrative password is hard-coded here —
 * `npm run create:admin` provisions the first account interactively
 * (instruction §25).
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const COUNTRIES = [
  { code: "ZW", name: "Zimbabwe", sortOrder: 10 },
  { code: "MZ", name: "Mozambique", sortOrder: 20 },
  // Radx uses "GR" (Griffin entity) rather than the ISO "ZA" — spec note 10.
  { code: "GR", name: "South Africa", sortOrder: 30 },
  { code: "NA", name: "Namibia", sortOrder: 40 },
];

const TICKET_CATEGORIES = [
  { slug: "hardware", name: "Hardware", sortOrder: 10, isActive: true },
  { slug: "software", name: "Software", sortOrder: 20, isActive: true },
  { slug: "network", name: "Network / Connectivity", sortOrder: 30, isActive: true },
  { slug: "email", name: "Email / Office 365", sortOrder: 40, isActive: true },
  { slug: "access", name: "Access / Permissions", sortOrder: 50, isActive: true },
  { slug: "printer", name: "Printer", sortOrder: 60, isActive: true },
  { slug: "starlink", name: "Starlink / Internet", sortOrder: 70, isActive: true },
  { slug: "other", name: "Other", sortOrder: 80, isActive: true },
  // Present but deactivated, exactly as the spec records it (§9).
  { slug: "phone", name: "Phone", sortOrder: 90, isActive: false },
];

const EQUIPMENT_TYPES = [
  { slug: "laptop", name: "Laptop", sortOrder: 10 },
  { slug: "desktop", name: "Desktop", sortOrder: 20 },
  { slug: "monitor", name: "Monitor", sortOrder: 30 },
  { slug: "printer", name: "Printer", sortOrder: 40 },
  { slug: "mouse", name: "Mouse", sortOrder: 50 },
  { slug: "laptop_bag", name: "Laptop bag", sortOrder: 60 },
  { slug: "laptop_charger", name: "Laptop charger", sortOrder: 70 },
  { slug: "wifi", name: "Wi-Fi", sortOrder: 80 },
  { slug: "other", name: "Something else", sortOrder: 90 },
];

async function main(): Promise<void> {
  for (const country of COUNTRIES) {
    await prisma.country.upsert({
      where: { code: country.code },
      create: { ...country, isActive: true },
      update: { name: country.name, sortOrder: country.sortOrder },
    });
  }
  console.log(`✔ ${COUNTRIES.length} countries`);

  for (const category of TICKET_CATEGORIES) {
    await prisma.ticketCategory.upsert({
      where: { slug: category.slug },
      create: category,
      update: { name: category.name, sortOrder: category.sortOrder, isActive: category.isActive },
    });
  }
  console.log(`✔ ${TICKET_CATEGORIES.length} ticket categories`);

  for (const type of EQUIPMENT_TYPES) {
    await prisma.equipmentItemType.upsert({
      where: { slug: type.slug },
      create: { ...type, isActive: true },
      update: { name: type.name, sortOrder: type.sortOrder },
    });
  }
  console.log(`✔ ${EQUIPMENT_TYPES.length} equipment item types`);

  const siteCount = await prisma.site.count();
  if (siteCount === 0) {
    // One head-office site per country so the cascading Country → Site
    // dropdown is usable on day one. Real sites are added under /manage/sites/.
    await prisma.site.createMany({
      data: [
        { name: "Harare Head Office", code: "HRE-HO", siteCountry: "ZW", address: "Harare, Zimbabwe" },
        { name: "Maputo Office", code: "MPM-HO", siteCountry: "MZ", address: "Maputo, Mozambique" },
        { name: "Johannesburg Office", code: "JNB-HO", siteCountry: "GR", address: "Johannesburg, South Africa" },
        { name: "Windhoek Office", code: "WDH-HO", siteCountry: "NA", address: "Windhoek, Namibia" },
      ],
    });
    console.log("✔ 4 starter sites");
  } else {
    console.log(`• ${siteCount} sites already present — left untouched`);
  }

  const adminCount = await prisma.user.count({
    where: { OR: [{ isSuperuser: true }, { profile: { role: "admin" } }] },
  });
  if (adminCount === 0) {
    console.log("\n⚠ No administrator account exists yet.");
    console.log("  Create one with:  npm run create:admin\n");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
