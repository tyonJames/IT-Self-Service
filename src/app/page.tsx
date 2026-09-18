import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/session";

/**
 * Root: signed-in staff land on the Command Centre dashboard (spec note 13);
 * everyone else lands on the public self-service portal.
 */
export default async function RootPage() {
  const session = await auth();
  redirect(session ? "/tickets/reports/" : "/help/");
}
