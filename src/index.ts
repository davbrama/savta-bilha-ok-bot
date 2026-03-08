import { AlertPoller } from './alertPoller.js';
import { WhatsAppClient } from './whatsapp.js';
import { OrefAlert, ALERT_CATEGORIES } from './types.js';
import { config } from './config.js';

function formatMessage(alert: OrefAlert): string {
  const categoryLabel = ALERT_CATEGORIES[alert.cat] ?? `סוג ${alert.cat}`;

  // If cities filter is set, show only matching cities; otherwise show all
  const citiesToShow =
    config.cities.length > 0
      ? alert.data.filter((c) => config.cities.includes(c))
      : alert.data;

  const cityList = citiesToShow.join(', ');

  return config.messageTemplate
    .replace('{title}', categoryLabel)
    .replace('{cities}', cityList)
    .replace('{instructions}', alert.desc);
}

async function main(): Promise<void> {
  console.log('[bot] Starting Oref WhatsApp Bot...');
  console.log(`[bot] City filter: ${config.cities.length > 0 ? config.cities.join(', ') : 'ALL'}`);
  console.log(`[bot] Category filter: ${config.alertCategories.length > 0 ? config.alertCategories.join(', ') : 'ALL'}`);
  console.log(`[bot] Target group: ${config.groupJid || '(not set yet)'}`);

  const whatsapp = new WhatsAppClient();
  const poller = new AlertPoller();
  let lastSentAt = 0;

  poller.on('alert', (alert: OrefAlert) => {
    const now = Date.now();
    const elapsed = now - lastSentAt;
    if (elapsed < config.cooldownMs) {
      console.log(`[bot] Alert suppressed — cooldown active for ${Math.ceil((config.cooldownMs - elapsed) / 1000)}s more`);
      return;
    }

    const message = formatMessage(alert);
    console.log(`[bot] Alert received — sending in ${config.sendDelayMs}ms`);
    lastSentAt = now;

    setTimeout(() => {
      console.log('[bot] Sending alert:\n' + message);
      whatsapp.sendToGroup(config.groupJid, message);
    }, config.sendDelayMs);
  });

  poller.on('error', (err: Error) => {
    // Errors are logged in the poller; avoid crashing on transient failures
    console.error('[bot] Poller error:', err.message);
  });

  // Connect WhatsApp first, then start polling
  await whatsapp.connect();
  poller.start();

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[bot] Shutting down...');
    poller.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[bot] Fatal error:', err);
  process.exit(1);
});
