import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

export interface Config {
  groupJid: string;
  cities: string[];
  alertCategories: number[];
  pollIntervalMs: number;
  sendDelayMs: number;
  cooldownMs: number;
  authDir: string;
  messageTemplate: string;
}

function loadConfig(): Config {
  // Try loading from config.json if it exists, fall back to env vars
  const configPath = path.resolve(process.cwd(), 'config.json');
  let fileConfig: Partial<Config> = {};

  if (fs.existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {
      console.error('[config] Failed to parse config.json, using env vars only');
    }
  }

  const groupJid = fileConfig.groupJid ?? process.env.GROUP_JID ?? '';
  if (!groupJid) {
    console.warn(
      '[config] GROUP_JID not set. Bot will start and print available groups on first connection.\n' +
        '         Set GROUP_JID in config.json or .env once you have it.'
    );
  }

  return {
    groupJid,

    // Hebrew city names — must match Pikud Ha'oref exactly
    cities: fileConfig.cities ?? parseCsv(process.env.CITIES),

    // Alert category numbers to forward (default: missiles + aircraft + terrorists)
    alertCategories: fileConfig.alertCategories ??
      parseCsv(process.env.ALERT_CATEGORIES).map(Number).filter(Boolean),

    pollIntervalMs: fileConfig.pollIntervalMs ??
      parseInt(process.env.POLL_INTERVAL_MS ?? '2000', 10),

    sendDelayMs: fileConfig.sendDelayMs ??
      parseInt(process.env.SEND_DELAY_MS ?? '30000', 10),

    cooldownMs: fileConfig.cooldownMs ??
      parseInt(process.env.COOLDOWN_MS ?? '600000', 10),

    authDir: fileConfig.authDir ?? process.env.AUTH_DIR ?? './auth',

    messageTemplate:
      fileConfig.messageTemplate ??
      process.env.MESSAGE_TEMPLATE ??
      '🚨 *{title}*\n\n📍 {cities}\n\n⚠️ {instructions}',
  };
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = loadConfig();
