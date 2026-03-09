import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

dotenv.config();

export interface Config {
  groupJid: string;
  cities: string[];
  alertCategories: number[];
  pollIntervalMs: number;
  sendDelayMs: number;
  sendDelayJitterMs: number;
  cooldownMs: number;
  authDir: string;
  messageTemplate: string;
}

/** AWS-specific config — set via Lambda environment variables in SAM template */
export interface LambdaConfig {
  s3Bucket: string;
  dynamoTable: string;
  ssmParamPath: string;
  kmsKeyId: string;
}

export function isLambda(): boolean {
  return !!process.env.AWS_LAMBDA_FUNCTION_NAME;
}

export function getLambdaConfig(): LambdaConfig {
  return {
    s3Bucket: process.env.AUTH_S3_BUCKET ?? '',
    dynamoTable: process.env.DYNAMO_TABLE ?? '',
    ssmParamPath: process.env.SSM_PARAM_PATH ?? '/oref-bot/config',
    kmsKeyId: process.env.KMS_KEY_ID ?? '',
  };
}

/** Load bot config from SSM Parameter Store (for Lambda mode) */
export async function loadConfigFromSSM(): Promise<Config> {
  const { ssmParamPath } = getLambdaConfig();
  const ssm = new SSMClient({});

  const result = await ssm.send(
    new GetParameterCommand({ Name: ssmParamPath }),
  );

  if (!result.Parameter?.Value) {
    throw new Error(`SSM parameter ${ssmParamPath} not found or empty`);
  }

  const params = JSON.parse(result.Parameter.Value) as Partial<Config>;

  return {
    groupJid: params.groupJid ?? '',
    cities: params.cities ?? [],
    alertCategories: params.alertCategories ?? [],
    pollIntervalMs: params.pollIntervalMs ?? 2000,
    sendDelayMs: params.sendDelayMs ?? 0, // no delay in Lambda — send immediately
    sendDelayJitterMs: params.sendDelayJitterMs ?? 0,
    cooldownMs: params.cooldownMs ?? 0,
    authDir: '/tmp/auth',
    messageTemplate:
      params.messageTemplate ??
      '\u{1F6A8} *{title}*\n\n\u{1F4CD} {cities}\n\n\u26A0\uFE0F {instructions}',
  };
}

/** Load bot config from config.json / env vars (for local mode) */
function loadLocalConfig(): Config {
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
    cities: fileConfig.cities ?? parseCsv(process.env.CITIES),
    alertCategories: fileConfig.alertCategories ??
      parseCsv(process.env.ALERT_CATEGORIES).map(Number).filter(Boolean),
    pollIntervalMs: fileConfig.pollIntervalMs ??
      parseInt(process.env.POLL_INTERVAL_MS ?? '2000', 10),
    sendDelayMs: fileConfig.sendDelayMs ??
      parseInt(process.env.SEND_DELAY_MS ?? '30000', 10),
    sendDelayJitterMs: fileConfig.sendDelayJitterMs ??
      parseInt(process.env.SEND_DELAY_JITTER_MS ?? '0', 10),
    cooldownMs: fileConfig.cooldownMs ??
      parseInt(process.env.COOLDOWN_MS ?? '300000', 10),
    authDir: fileConfig.authDir ?? process.env.AUTH_DIR ?? './auth',
    messageTemplate:
      fileConfig.messageTemplate ??
      process.env.MESSAGE_TEMPLATE ??
      '\u{1F6A8} *{title}*\n\n\u{1F4CD} {cities}\n\n\u26A0\uFE0F {instructions}',
  };
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Eagerly loaded config for local mode (index.ts / AlertPoller class)
export const config = loadLocalConfig();
