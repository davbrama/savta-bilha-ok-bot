import { pollOnce, markAlertSent } from "./alertPoller.js";
import { sendOnce } from "./whatsapp.js";
import { useS3AuthState } from "./s3Auth.js";
import { loadConfigFromSSM, getLambdaConfig, Config } from "./config.js";
import { isShabbatNow } from "./shabbatScheduler.js";
import { OrefAlert, ALERT_CATEGORIES } from "./types.js";

function formatMessage(alert: OrefAlert, cfg: Config): string {
  const categoryLabel = ALERT_CATEGORIES[alert.cat] ?? `סוג ${alert.cat}`;

  const citiesToShow =
    cfg.cities.length > 0
      ? alert.data.filter((c) => cfg.cities.includes(c))
      : alert.data;

  const cityList = citiesToShow.join(", ");

  return cfg.messageTemplate
    .replace("{title}", categoryLabel)
    .replace("{cities}", cityList)
    .replace("{instructions}", alert.desc);
}

const POLL_INTERVAL_MS = 2000;
const RESERVED_MS = 5000; // stop polling this many ms before Lambda timeout

export async function handler(
  _event: unknown,
  context?: { getRemainingTimeInMillis?: () => number },
): Promise<{ statusCode: number; body: string }> {
  const lambdaCfg = getLambdaConfig();
  const cfg = await loadConfigFromSSM();

  if (isShabbatNow(cfg)) {
    console.log('[handler] Shabbat mode active — skipping this invocation');
    return { statusCode: 200, body: 'Shabbat — skipped' };
  }

  const deadline = context?.getRemainingTimeInMillis
    ? () => context.getRemainingTimeInMillis!()
    : (() => {
        const end = Date.now() + 290_000; // fallback ~290s
        return () => end - Date.now();
      })();

  const sentAlerts: string[] = [];

  while (deadline() > RESERVED_MS) {
    // console.log(`[handler] Polling oref API...`);

    const alert = await pollOnce({
      dynamoTable: lambdaCfg.dynamoTable,
      cities: cfg.cities,
      alertCategories: cfg.alertCategories,
    });

    if (alert) {
      const message = formatMessage(alert, cfg);
      console.log(
        `[handler] New alert, sending to ${cfg.groupJid}:\n${message}`,
      );

      const authState = await useS3AuthState(
        lambdaCfg.s3Bucket,
        lambdaCfg.kmsKeyId,
      );
      try {
        await sendOnce(cfg.groupJid, message, authState);
        await markAlertSent(alert.id, lambdaCfg.dynamoTable);
        sentAlerts.push(alert.id);
      } finally {
        authState.cleanup();
      }
    }

    // Wait before next poll, but break if we'd exceed the deadline
    if (deadline() > RESERVED_MS + POLL_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    } else {
      break;
    }
  }

  const body =
    sentAlerts.length > 0
      ? `Sent alerts: ${sentAlerts.join(", ")}`
      : "No new alerts";
  return { statusCode: 200, body };
}
