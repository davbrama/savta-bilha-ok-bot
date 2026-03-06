# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ok-bot is an Israeli Home Front Command (Pikud Ha'oref) alert bot that polls the oref API for missile/rocket alerts and forwards them to WhatsApp groups using the Baileys library. Requires an Israeli IP to access the oref API.

## Commands

```bash
npm run dev          # Run in development (ts-node, no build needed)
npm run build        # Compile TypeScript to dist/
npm run start:built  # Run compiled output from dist/
```

## Architecture

All source is in `src/` with four modules orchestrated by the entry point:

- **index.ts** — Entry point. Wires AlertPoller events to WhatsAppClient, formats messages using a configurable template with `{title}`, `{cities}`, `{instructions}` placeholders, applies `sendDelayMs` before sending, handles graceful shutdown (SIGINT/SIGTERM).
- **alertPoller.ts** — EventEmitter that polls `https://www.oref.org.il/WarningMessages/alert/alerts.json` on an interval. Deduplicates by alert ID, filters by city names and alert category numbers per config. Emits `'alert'` and `'error'` events. 5-minute heartbeat log for liveness monitoring.
- **whatsapp.ts** — Wraps `@whiskeysockets/baileys` socket. Handles QR auth, session persistence in `authDir`, exponential backoff reconnection (2s–30s), message queueing while disconnected, and group JID discovery on first run.
- **config.ts** — Loads from `config.json` (takes precedence) then falls back to environment variables. Key settings: `groupJid`, `cities` (Hebrew names), `alertCategories` (numeric codes), `pollIntervalMs`, `sendDelayMs`, `authDir`, `messageTemplate`.
- **types.ts** — `OrefAlert`, `OrefApiResponse` interfaces and `ALERT_CATEGORIES` map (category number → Hebrew description).

## Key Technical Details

- The oref API returns empty body during quiet periods — this is normal, not an error.
- The oref API requires a `Referer` header or requests get geo-blocked.
- Alert deduplication is by alert ID; the poller tracks seen IDs in memory.
- When `cities` filter is set, only matching cities appear in the forwarded message.
- WhatsApp session files live in `./auth/` — delete to force QR re-scan.
- First run with no `groupJid` prints available groups and their JIDs to console.

## Configuration

Supports both `config.json` and env vars (`GROUP_JID`, `CITIES`, `ALERT_CATEGORIES`, `POLL_INTERVAL_MS`, `SEND_DELAY_MS`, `AUTH_DIR`, `MESSAGE_TEMPLATE`). JSON config takes precedence.
