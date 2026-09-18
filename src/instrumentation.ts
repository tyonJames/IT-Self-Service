/**
 * Next.js instrumentation hook — runs once per server process, before the app
 * handles its first request (instruction §23).
 *
 * The Node-only work lives in `instrumentation.node.ts` and is imported
 * dynamically behind the `NEXT_RUNTIME` check. That split matters: Application
 * Insights pulls in gRPC, which depends on Node built-ins like `zlib`, and
 * bundling it for the Edge runtime fails the build outright.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation.node");
  }
}
