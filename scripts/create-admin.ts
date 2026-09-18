import "dotenv/config";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "@node-rs/argon2";

/**
 * Create the first administrator (instruction §25).
 *
 * Deliberately interactive and deliberately not part of the seed: no
 * production password should ever be hard-coded in a script that lives in
 * version control. Run it once after the first deployment.
 *
 *   npm run create:admin
 *
 * For an unattended first deploy, set RADX_ADMIN_USERNAME, RADX_ADMIN_EMAIL
 * and RADX_ADMIN_PASSWORD in the environment and the prompts are skipped —
 * pull the password from Key Vault, never from a file.
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const MIN_LENGTH = Number.parseInt(process.env.PASSWORD_MIN_LENGTH ?? "12", 10);

async function main(): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    const existing = await prisma.user.count({
      where: { OR: [{ isSuperuser: true }, { profile: { role: "admin" } }] },
    });

    if (existing > 0) {
      console.log(`There ${existing === 1 ? "is" : "are"} already ${existing} administrator account(s).`);
      const proceed = (await rl.question("Create another? (y/N) ")).trim().toLowerCase();
      if (proceed !== "y" && proceed !== "yes") {
        console.log("Nothing created.");
        return;
      }
    }

    const username = (
      process.env.RADX_ADMIN_USERNAME ?? (await rl.question("Username: "))
    )
      .trim()
      .toLowerCase();

    const email = (process.env.RADX_ADMIN_EMAIL ?? (await rl.question("Email address: ")))
      .trim()
      .toLowerCase();

    const firstName = process.env.RADX_ADMIN_FIRST_NAME ?? (await rl.question("First name: "));
    const lastName = process.env.RADX_ADMIN_LAST_NAME ?? (await rl.question("Surname: "));

    let password = process.env.RADX_ADMIN_PASSWORD ?? "";
    if (!password) {
      password = await rl.question(`Password (at least ${MIN_LENGTH} characters): `);
      const confirm = await rl.question("Confirm password: ");
      if (password !== confirm) {
        console.error("Those passwords do not match. Nothing created.");
        process.exitCode = 1;
        return;
      }
    }

    if (!username || !email || !password) {
      console.error("Username, email and password are all required. Nothing created.");
      process.exitCode = 1;
      return;
    }

    if (password.length < MIN_LENGTH) {
      console.error(`That password is shorter than ${MIN_LENGTH} characters. Nothing created.`);
      process.exitCode = 1;
      return;
    }

    const clash = await prisma.user.findFirst({
      where: { OR: [{ username }, { email }] },
      select: { username: true },
    });
    if (clash) {
      console.error("An account already exists with that username or email. Nothing created.");
      process.exitCode = 1;
      return;
    }

    const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username,
          email,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          passwordHash,
          isActive: true,
          isStaff: true,
          isSuperuser: true,
        },
        select: { id: true, username: true },
      });

      await tx.userProfile.create({
        data: { userId: created.id, role: "admin", site: "ZW" },
      });

      return created;
    });

    console.log(`\n✔ Administrator “${user.username}” created.`);
    console.log("  Sign in at /accounts/login/ and change the password from your profile page.\n");
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
