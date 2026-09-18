import "dotenv/config";
import { recycleBinService } from "../src/services/recyclebin.service";
import { purgeExpiredSessions } from "../src/lib/auth/session";

/**
 * Manual equivalent of the scheduled housekeeping job.
 *
 * In Azure the job runs over HTTP (`POST /api/jobs/purge`) so that exactly one
 * instance does the work — see AZURE_DEPLOYMENT.md §15. This script exists for
 * running it by hand, from a console session or a WebJob.
 *
 *   npm run purge:run
 */
async function main(): Promise<void> {
  console.log("Purging records past the retention window…");

  const purged = await recycleBinService.purgeExpired();
  const sessions = await purgeExpiredSessions();

  console.log(`  assets:     ${purged.assets}`);
  console.log(`  employees:  ${purged.employees}`);
  console.log(`  tickets:    ${purged.tickets}`);
  console.log(`  equipment:  ${purged.equipment}`);
  console.log(`  sessions:   ${sessions} expired session(s) removed`);
  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
