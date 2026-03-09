# oref-whatsapp-bot

Polls the Pikud Ha'oref (Israeli Home Front Command) API for active missile/rocket alerts and forwards them to a WhatsApp group.

Supports two deployment modes:
- **Local mode** — long-running process on a server/VM, polls every 2s
- **AWS Lambda mode** — serverless, polls every 1 minute via CloudWatch Events

## Requirements

- Node.js 20+
- A WhatsApp account to link as the bot
- **Israeli IP** — the oref API geo-blocks non-Israeli requests (Lambda must run in `il-central-1`)

## Quick start (local mode)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure

Create `config.json`:

```json
{
  "groupJid": "",
  "cities": ["תל אביב - מרכז העיר"],
  "alertCategories": [1, 2, 5],
  "pollIntervalMs": 2000,
  "sendDelayMs": 30000,
  "authDir": "./auth",
  "messageTemplate": "🚨 *{title}*\n\n📍 {cities}\n\n⚠️ {instructions}"
}
```

All fields are optional. See [Configuration reference](#configuration-reference) below.

### 3. First run — get the group JID

Leave `groupJid` empty and start the bot:

```bash
npm run dev
```

Scan the QR code with your WhatsApp. The bot will print all groups:

```
[whatsapp] ── Groups this account is in ──
  My Family                                JID: 120363XXXXXXXXX@g.us
  Work Team                                JID: 120363YYYYYYYYY@g.us
[whatsapp] ─────────────────────────────────
```

Copy the JID into `config.json`, then restart.

### 4. Run

```bash
npm run dev          # development (ts-node, no build)
npm run build        # compile TypeScript to dist/
npm run start:built  # run compiled output
```

## AWS Lambda deployment

### Prerequisites

- AWS CLI v2 configured with credentials (`aws sts get-caller-identity` should work)
- The AWS account must have the `il-central-1` (Tel Aviv) region enabled
- Node.js 20+ and npm installed locally

### Architecture overview

```
CloudWatch Events (1 min) → Lambda → oref API
                                   → DynamoDB (dedup)
                                   → S3 (WhatsApp auth)
                                   → WhatsApp Web
```

The SAM template (`template.yaml`) creates all required resources:

| Resource | Type | Purpose |
|----------|------|---------|
| `AuthEncryptionKey` | KMS Key | Dedicated encryption key for WhatsApp credentials (auto-rotates) |
| `AuthBucket` | S3 Bucket | Stores WhatsApp session files (KMS-encrypted, versioned, no public access) |
| `AlertStateTable` | DynamoDB Table | Deduplicates alerts by ID (24h TTL) |
| `BotConfigParam` | SSM Parameter | Bot configuration (groupJid, cities, alertCategories, etc.) |
| `DeadLetterQueue` | SQS Queue | Captures failed Lambda invocations (14-day retention) |
| `OrefBotFunction` | Lambda Function | Polls oref API, sends WhatsApp messages |

### Step 1: Deploy the stack

```bash
npm run deploy
```

This runs `scripts/build-lambda.sh` (compiles TS, stages production-only dependencies) then `scripts/deploy.sh` (packages and deploys via CloudFormation).

The deploy script will:
1. Compile TypeScript to `dist/`
2. Stage a clean package in `.build/` (no `auth/`, no `.git/`, no dev dependencies)
3. Upload the package to a deploy S3 bucket (`oref-bot-deploy-<ACCOUNT_ID>`)
4. Deploy the CloudFormation stack

**Environment variables for deploy (optional):**

| Variable | Default | Description |
|----------|---------|-------------|
| `STACK_NAME` | `oref-bot` | CloudFormation stack name |
| `AWS_REGION` | `il-central-1` | AWS region (must be Israeli region for oref API access) |

### Step 2: Bootstrap WhatsApp authentication

After the stack is deployed, you need to authenticate with WhatsApp once and upload the session to S3.

Get the required values from the stack outputs:

```bash
aws cloudformation describe-stacks --stack-name oref-bot --region il-central-1 \
  --query 'Stacks[0].Outputs' --output table
```

Then run the bootstrap:

```bash
AUTH_S3_BUCKET=<AuthBucketName from outputs> \
KMS_KEY_ID=<run: aws kms list-aliases --region il-central-1 --query 'Aliases[?starts_with(AliasName,`alias/oref-bot`)].TargetKeyArn' --output text> \
npm run auth-bootstrap
```

This will:
1. Connect to WhatsApp — scan the QR code with your phone
2. Complete the pairing handshake (automatic reconnect after initial pairing)
3. Upload encrypted auth files to S3
4. Print available groups (copy the JID you need)
5. Clean up all local auth files

**The bootstrap handles the 515 "restart required" response automatically.** After scanning the QR, Baileys pairs and then needs to reconnect — the script does this without manual intervention.

### Step 3: Configure the bot

Edit the SSM parameter with your group JID and preferences:

```bash
aws ssm put-parameter \
  --name /oref-bot/config \
  --type String \
  --overwrite \
  --region il-central-1 \
  --value '{
    "groupJid": "120363XXXXXXXXX@g.us",
    "cities": ["אריאל"],
    "alertCategories": [1, 2],
    "messageTemplate": "👍"
  }'
```

The Lambda reads this parameter on every invocation — changes take effect within 1 minute.

### Step 4: Verify

Check Lambda logs:

```bash
aws logs tail /aws/lambda/<FunctionName> --since 5m --region il-central-1
```

You should see `[handler] Polling oref API...` on each invocation. During quiet periods the oref API returns empty responses — this is normal.

Check the DLQ for failures:

```bash
aws sqs get-queue-attributes \
  --queue-url <DeadLetterQueueUrl from outputs> \
  --attribute-names ApproximateNumberOfMessages \
  --region il-central-1
```

### Redeployment

After code changes:

```bash
npm run deploy
```

### Re-bootstrapping auth

If the WhatsApp session expires or you need to re-link:

```bash
AUTH_S3_BUCKET=<bucket> KMS_KEY_ID=<key-arn> npm run auth-bootstrap
```

## Configuration reference

### Local mode (`config.json` or environment variables)

| Field | Env var | Default | Description |
|-------|---------|---------|-------------|
| `groupJid` | `GROUP_JID` | `""` | WhatsApp group JID (leave empty to discover) |
| `cities` | `CITIES` | `[]` | Hebrew city names to filter (empty = all cities) |
| `alertCategories` | `ALERT_CATEGORIES` | `[]` | Category numbers to filter (empty = all categories) |
| `pollIntervalMs` | `POLL_INTERVAL_MS` | `2000` | Polling interval in ms |
| `sendDelayMs` | `SEND_DELAY_MS` | `30000` | Delay before sending (reduces false positives) |
| `sendDelayJitterMs` | `SEND_DELAY_JITTER_MS` | `0` | Random jitter added to send delay |
| `cooldownMs` | `COOLDOWN_MS` | `300000` | Minimum time between sent alerts (5 min) |
| `authDir` | `AUTH_DIR` | `./auth` | WhatsApp session file directory |
| `messageTemplate` | `MESSAGE_TEMPLATE` | *(see below)* | Message template with `{title}`, `{cities}`, `{instructions}` placeholders |
| `shabbatMode` | `SHABBAT_MODE` | `false` | Pause the bot during Shabbat |
| `shabbatStartOffsetMin` | `SHABBAT_START_OFFSET_MIN` | `30` | Minutes before Friday sunset to stop |
| `shabbatEndOffsetMin` | `SHABBAT_END_OFFSET_MIN` | `40` | Minutes after Saturday sunset to resume |

### Lambda mode (SSM Parameter `/oref-bot/config`)

Same fields as above, stored as a JSON string in SSM. The Lambda overrides `sendDelayMs` to `0` (send immediately) and uses `/tmp/auth` internally.

### Lambda environment variables (set by SAM template — do not edit manually)

| Variable | Description |
|----------|-------------|
| `AUTH_S3_BUCKET` | S3 bucket name for WhatsApp auth credentials |
| `DYNAMO_TABLE` | DynamoDB table name for alert deduplication |
| `SSM_PARAM_PATH` | SSM parameter path for bot configuration |
| `KMS_KEY_ID` | KMS key ARN for S3 encryption |

### Alert categories

| Number | Type |
|--------|------|
| 1 | Missiles / Rockets (ירי רקטות וטילים) |
| 2 | Hostile aircraft (חדירת כלי טיס עוין) |
| 3 | Earthquake (רעידת אדמה) |
| 4 | Tsunami (צונאמי) |
| 5 | Terrorist infiltration (חדירת מחבלים) |
| 6 | Hazardous materials (חומרים מסוכנים) |
| 7 | Unconventional warfare (לוחמה לא קונבנציונלית) |
| 13 | All clear (ניתן לצאת מהמרחב המוגן) |
| 101 | Emergency event (אירוע חירום) |

City names must match Pikud Ha'oref exactly. Leave `cities` and/or `alertCategories` as empty arrays to receive all alerts.

### Shabbat mode

When `shabbatMode` is enabled, the bot automatically pauses during Shabbat based on Tel Aviv sunset times (calculated with `suncalc`):

- **Stops** `shabbatStartOffsetMin` minutes before sunset on Friday (default: 30 min)
- **Resumes** `shabbatEndOffsetMin` minutes after sunset on Saturday (default: 40 min)

Works in both modes: local mode uses a scheduler to start/stop the poller, Lambda mode returns immediately on each invocation during Shabbat. If the bot starts during Shabbat, it waits until Shabbat ends before polling.

```json
{
  "shabbatMode": true,
  "shabbatStartOffsetMin": 30,
  "shabbatEndOffsetMin": 40
}
```

## Security

### Credential handling

- **WhatsApp session files** contain private keys and session tokens. They are equivalent to being logged into your WhatsApp account.
- In Lambda mode, credentials are stored in S3 encrypted with a **dedicated KMS key** (auto-rotating). The bucket enforces KMS encryption on all PutObject requests and denies unencrypted transport (HTTP).
- The bootstrap script **deletes local auth files** after uploading to S3. No credentials remain on disk.
- The Lambda **wipes `/tmp/auth`** after each invocation to prevent credential leakage between execution environment reuses.

### IAM (least privilege)

The Lambda function has the minimum permissions required:

| Service | Actions | Scope |
|---------|---------|-------|
| S3 | `GetObject`, `PutObject`, `ListBucket` | Auth bucket only |
| DynamoDB | `GetItem`, `PutItem` | Alert state table only |
| SSM | `GetParameter` | `/oref-bot/config` only |
| KMS | `Decrypt`, `GenerateDataKey` | Dedicated auth encryption key only |
| SQS | `SendMessage` | Dead-letter queue only |

No wildcard (`*`) resource permissions are used.

### S3 bucket hardening

- Server-side encryption (SSE-KMS) with a dedicated key
- Bucket key enabled (reduces KMS API costs)
- All public access blocked
- Bucket policy denies unencrypted uploads and insecure transport (HTTP)
- Versioning enabled (accidental overwrites are recoverable)
- `DeletionPolicy: Retain` (stack deletion won't destroy credentials)

### DynamoDB hardening

- Server-side encryption enabled (AWS-managed key)
- `DeletionPolicy: Retain`
- TTL-based cleanup (24 hours) — no unbounded data growth

### Dead-letter queue

Failed Lambda invocations are routed to an SQS dead-letter queue (`oref-bot-dlq`) with 14-day retention and SQS-managed encryption. Monitor this queue for auth expiry, API failures, or configuration errors.

### What to monitor

- **DLQ depth** — non-zero means the Lambda is failing. Check CloudWatch Logs.
- **CloudWatch Logs** — `[handler] Polling oref API...` should appear every minute.
- **WhatsApp session expiry** — if the session expires, the Lambda will fail to connect. Re-run `auth-bootstrap`.

## Project structure

```
src/
  index.ts              Entry point (local mode)
  handler.ts            Lambda handler
  alertPoller.ts        Oref API polling + DynamoDB dedup (Lambda)
  whatsapp.ts           WhatsApp client (local + Lambda sendOnce)
  shabbatScheduler.ts   Pauses poller during Shabbat (sunset-based)
  s3Auth.ts         S3-backed WhatsApp auth state
  bootstrap.ts      One-time QR auth + S3 upload
  config.ts         Config loading (local: config.json, Lambda: SSM)
  types.ts          OrefAlert interfaces + category map
scripts/
  build-lambda.sh   Stages clean Lambda package (.build/)
  deploy.sh         Packages and deploys via CloudFormation
template.yaml       SAM/CloudFormation template
config.json         Local mode configuration
```

## Persistent deployment (local — systemd)

```ini
[Unit]
Description=Oref WhatsApp Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/oref-whatsapp-bot
ExecStart=/usr/bin/node --loader ts-node/esm src/index.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## Notes

- Baileys is an unofficial WhatsApp Web library. WhatsApp may update their protocol; keep `@whiskeysockets/baileys` up to date.
- The bot uses your personal WhatsApp account. Consider using a dedicated number.
- The oref API returns empty bodies between alerts — this is normal, not an error.
- The oref API requires a `Referer: https://www.oref.org.il/` header or requests get blocked.
- Lambda must run in `il-central-1` for Israeli IP access to the oref API.
