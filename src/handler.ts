import { pollOnce } from './alertPoller.js';
import { sendOnce } from './whatsapp.js';
import { useS3AuthState } from './s3Auth.js';
import { loadConfigFromSSM, getLambdaConfig, Config } from './config.js';
import { OrefAlert, ALERT_CATEGORIES } from './types.js';

function formatMessage(alert: OrefAlert, cfg: Config): string {
  const categoryLabel = ALERT_CATEGORIES[alert.cat] ?? `סוג ${alert.cat}`;

  const citiesToShow =
    cfg.cities.length > 0
      ? alert.data.filter((c) => cfg.cities.includes(c))
      : alert.data;

  const cityList = citiesToShow.join(', ');

  return cfg.messageTemplate
    .replace('{title}', categoryLabel)
    .replace('{cities}', cityList)
    .replace('{instructions}', alert.desc);
}

export async function handler(): Promise<{ statusCode: number; body: string }> {
  const lambdaCfg = getLambdaConfig();
  const cfg = await loadConfigFromSSM();

  console.log(`[handler] Polling oref API...`);

  const alert = await pollOnce({
    dynamoTable: lambdaCfg.dynamoTable,
    cities: cfg.cities,
    alertCategories: cfg.alertCategories,
  });

  if (!alert) {
    return { statusCode: 200, body: 'No new alerts' };
  }

  const message = formatMessage(alert, cfg);
  console.log(`[handler] New alert, sending to ${cfg.groupJid}:\n${message}`);

  const authState = await useS3AuthState(lambdaCfg.s3Bucket, lambdaCfg.kmsKeyId);

  try {
    await sendOnce(cfg.groupJid, message, authState);
    return { statusCode: 200, body: `Alert ${alert.id} sent` };
  } finally {
    authState.cleanup();
  }
}
