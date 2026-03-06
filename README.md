# oref-whatsapp-bot

Polls the Pikud Ha'oref (Israeli Home Front Command) API for active missile/rocket alerts and forwards them to a WhatsApp group.

## Requirements

- Node.js 18+
- Must run on a machine with an **Israeli IP** (the oref API geo-blocks non-Israeli IPs)
- A WhatsApp account to link as the bot

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure

Copy `config.json` and fill it in:

```json
{
  "groupJid": "",           // leave empty on first run — the bot will print it
  "cities": [
    "תל אביב - מרכז העיר",
    "תל אביב - מזרח"
  ],
  "alertCategories": [1, 2, 5],
  "pollIntervalMs": 2000,
  "authDir": "./auth",
  "messageTemplate": "🚨 *{title}*\n\n📍 {cities}\n\n⚠️ {instructions}"
}
```

**Alert categories:**
| Number | Type |
|--------|------|
| 1 | Missiles / Rockets (ירי רקטות וטילים) |
| 2 | Hostile aircraft (חדירת כלי טיס עוין) |
| 3 | Earthquake (רעידת אדמה) |
| 4 | Tsunami (צונאמי) |
| 5 | Terrorist infiltration (חדירת מחבלים) |
| 6 | Hazardous materials (חומרים מסוכנים) |
| 13 | All clear (ניתן לצאת מהמרחב המוגן) |

**City names** must match Pikud Ha'oref exactly. You can find the canonical list in:
- The oref API response itself when an alert fires
- https://github.com/idodov/RedAlert (hebrew.md city list)

Leave `cities` and/or `alertCategories` as empty arrays `[]` to receive **all** alerts.

### 3. First run — get the group JID

Leave `groupJid` empty and start the bot:

```bash
npm run dev
```

Scan the QR code with your WhatsApp. The bot will print all groups this account is in:

```
[whatsapp] ── Groups this account is in ──
  My Family                                JID: 120363XXXXXXXXX@g.us
  Work Team                                JID: 120363YYYYYYYYY@g.us
[whatsapp] ─────────────────────────────────
```

Copy the correct JID into `config.json → groupJid`, then restart.

### 4. Run

```bash
npm run dev        # development (ts-node, no build step)
npm run build      # compile to dist/
npm run start:built  # run compiled output
```

## Persistent deployment (systemd)

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

```bash
sudo systemctl enable oref-whatsapp-bot
sudo systemctl start oref-whatsapp-bot
sudo journalctl -u oref-whatsapp-bot -f
```

The `./auth` directory persists the WhatsApp session — **back it up** and don't delete it, or you'll need to re-scan the QR.

## Notes

- Baileys is an unofficial WhatsApp Web library. WhatsApp may update their protocol; keep `@whiskeysockets/baileys` up to date.
- The bot uses your personal WhatsApp account. Low-volume group messaging is generally fine, but use a dedicated number if you want to be safe.
- The oref API sometimes returns empty bodies between alerts — this is normal, not an error.
