import "dotenv/config";
import { notificationService } from "../src/services/notification.service";

/**
 * Retry every failed notification that has attempts left.
 *
 *   npm run notifications:retry
 *
 * The same work happens inside the scheduled job; this is the manual handle
 * for after a mail-server outage.
 */
async function main(): Promise<void> {
  const { attempted, sent } = await notificationService.retryAllFailed(500);
  console.log(`Retried ${attempted} notification(s); ${sent} were delivered.`);
  if (attempted > sent) {
    console.log("Check the email log at /tickets/reports/notifications/ for the errors.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
