/**
 * Application Insights initialisation (instruction §23).
 *
 * Loaded only on the Node runtime, from `instrumentation.ts`. When
 * APPLICATIONINSIGHTS_CONNECTION_STRING is absent — local development, tests —
 * nothing is imported and nothing runs.
 */

const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;

if (connectionString) {
  void (async () => {
    try {
      const appInsights = await import("applicationinsights");

      appInsights
        .setup(connectionString)
        .setAutoCollectRequests(true)
        .setAutoCollectPerformance(true, true)
        .setAutoCollectExceptions(true)
        .setAutoCollectDependencies(true)
        .setAutoCollectConsole(true, false)
        .setSendLiveMetrics(true);

      const client = appInsights.defaultClient;
      client.context.tags[client.context.keys.cloudRole] = "radx-helpdesk";

      // Telemetry must never carry a secret. Query strings can contain a
      // password-reset token or the scheduled-job secret, so they are stripped
      // before anything leaves the process.
      client.addTelemetryProcessor((envelope) => {
        const data = envelope.data as { baseData?: Record<string, unknown> };
        const baseData = data.baseData;
        if (baseData && typeof baseData.url === "string") {
          baseData.url = baseData.url.split("?")[0] ?? baseData.url;
        }
        if (baseData && typeof baseData.name === "string") {
          baseData.name = baseData.name.split("?")[0] ?? baseData.name;
        }
        return true;
      });

      appInsights.start();

      // eslint-disable-next-line no-console
      console.log("[instrumentation] Application Insights started");
    } catch (error) {
      // Telemetry failing to start must never stop the application serving.
      // eslint-disable-next-line no-console
      console.error(
        "[instrumentation] Application Insights failed to start:",
        (error as Error).message,
      );
    }
  })();
}

export {};
