# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ok-bot is an Israeli Home Front Command (Pikud Ha'oref) alert bot that polls the oref API for missile/rocket alerts and forwards them to WhatsApp groups using the Baileys library. Requires an Israeli IP to access the oref API.

Two deployment modes: **local** (long-running process) and **AWS Lambda** (serverless, 1-minute polling via CloudWatch Events in `il-central-1`).

## Commands

```bash
npm run dev            # Run locally (ts-node, no build needed)
npm run build          # Compile TypeScript to dist/
npm run start:built    # Run compiled output from dist/
npm run build:lambda   # Build clean Lambda package in .build/
npm run deploy         # Build + deploy to AWS (CloudFormation)
npm run auth-bootstrap # One-time WhatsApp QR auth + upload to S3
```

## Architecture

All source is in `src/` with modules for local and Lambda modes:

### Shared modules
- **alertPoller.ts** — Polls `https://www.oref.org.il/WarningMessages/alert/alerts.json`. Local mode: EventEmitter with in-memory dedup. Lambda mode: `pollOnce()` with DynamoDB dedup (24h TTL).
- **whatsapp.ts** — Wraps `@whiskeysockets/baileys`. Local mode: `WhatsAppClient` class with reconnection/queueing. Lambda mode: `sendOnce()` for ephemeral connect-send-disconnect.
- **config.ts** — Local: loads from `config.json` / env vars. Lambda: `loadConfigFromSSM()` reads from SSM Parameter Store. Also exports `getLambdaConfig()` for AWS resource references (env vars set by SAM template).
- **types.ts** — `OrefAlert`, `OrefApiResponse` interfaces and `ALERT_CATEGORIES` map.
- **shabbatScheduler.ts** — Shabbat awareness for both modes. Uses `suncalc` to compute Tel Aviv sunset times. Exports `isShabbatNow()` (used by Lambda handler for early return) and `ShabbatScheduler` class (used by local mode to start/stop poller via setTimeout). Configurable offsets: stops `shabbatStartOffsetMin` before Friday sunset, resumes `shabbatEndOffsetMin` after Saturday sunset.

### Local mode
- **index.ts** — Entry point. Wires AlertPoller events to WhatsAppClient, applies `sendDelayMs` + jitter + cooldown before sending, handles graceful shutdown. Optionally uses ShabbatScheduler when `shabbatMode` is enabled.

### Lambda mode
- **handler.ts** — Lambda entry point. Polls oref API, only initializes S3 auth + Baileys when there's an alert to send (no WhatsApp overhead on quiet polls). Skips invocation entirely during Shabbat when `shabbatMode` is enabled.
- **s3Auth.ts** — Downloads WhatsApp auth from S3 to `/tmp/auth`, wraps Baileys auth state, uploads changes back to S3 on `creds.update`, cleans up `/tmp/auth` after use.
- **bootstrap.ts** — One-time script: QR scan → WhatsApp pairing → handles 515 restart-required → reconnects → uploads auth to S3 → cleans up local files.

### Deploy scripts
- **scripts/build-lambda.sh** — Compiles TS, stages only compiled JS + production node_modules into `.build/` (excludes auth/, .git/, src/, dev deps). Writes minimal `package.json` with `"type":"module"` for ESM.
- **scripts/deploy.sh** — Runs `aws cloudformation package` + `deploy`. Uses `oref-bot-deploy-<ACCOUNT_ID>` bucket. Configurable via `STACK_NAME` and `AWS_REGION` env vars.

### Infrastructure (template.yaml)
SAM/CloudFormation template creating: KMS key (auto-rotating), S3 bucket (KMS-encrypted, versioned, no public access), DynamoDB table (encrypted, on-demand), SSM parameter, SQS dead-letter queue, Lambda function with least-privilege IAM.

## Key Technical Details

- The oref API returns empty body during quiet periods — this is normal, not an error.
- The oref API requires a `Referer: https://www.oref.org.il/` header or requests get geo-blocked.
- Lambda must run in `il-central-1` for Israeli IP access.
- Alert deduplication: local mode uses in-memory last ID; Lambda mode uses DynamoDB with 24h TTL.
- WhatsApp auth in Lambda: S3 (KMS-encrypted) → `/tmp/auth` → wiped after each invocation.
- Bootstrap handles Baileys 515 "restart required" by automatically reconnecting after initial pairing.
- The `config.ts` module eagerly loads local config at import time (`export const config = loadLocalConfig()`). This runs even in Lambda but is harmless — the handler uses `loadConfigFromSSM()` instead.
- Lambda handler only touches S3/Baileys when there's a new alert. Quiet polls = 1 HTTP call + 1 DynamoDB read.

## Configuration

### Local mode
`config.json` or env vars (`GROUP_JID`, `CITIES`, `ALERT_CATEGORIES`, `POLL_INTERVAL_MS`, `SEND_DELAY_MS`, `SEND_DELAY_JITTER_MS`, `COOLDOWN_MS`, `AUTH_DIR`, `MESSAGE_TEMPLATE`, `SHABBAT_MODE`, `SHABBAT_START_OFFSET_MIN`, `SHABBAT_END_OFFSET_MIN`). JSON takes precedence.

### Lambda mode
SSM Parameter (`/oref-bot/config` by default) containing JSON with: `groupJid`, `cities`, `alertCategories`, `messageTemplate`, `shabbatMode`, `shabbatStartOffsetMin`, `shabbatEndOffsetMin`. AWS resource references (bucket, table, KMS key, SSM path) are set via Lambda environment variables by the SAM template — do not edit manually.

### Bootstrap env vars
`AUTH_S3_BUCKET` (required), `KMS_KEY_ID` (recommended) — get values from `aws cloudformation describe-stacks --stack-name oref-bot`.
