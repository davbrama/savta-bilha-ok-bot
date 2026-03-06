/**
 * One-time bootstrap script: authenticates with WhatsApp via QR code locally,
 * then uploads the resulting auth state to S3 (encrypted via SSE-KMS).
 *
 * Usage: npm run auth-bootstrap
 *
 * Required env vars:
 *   AUTH_S3_BUCKET — S3 bucket name for auth storage
 *   AWS_REGION     — (or configured via AWS CLI profile)
 */

import makeWASocket, {
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import path from 'path';
import fs from 'fs';
import { uploadLocalAuthToS3 } from './s3Auth.js';

const AUTH_DIR = path.resolve('./auth');
const S3_BUCKET = process.env.AUTH_S3_BUCKET;

if (!S3_BUCKET) {
  console.error('[bootstrap] AUTH_S3_BUCKET env var is required');
  process.exit(1);
}

async function main() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  console.log('[bootstrap] Starting WhatsApp authentication...');
  console.log('[bootstrap] Scan the QR code with your phone when it appears.\n');

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['OrefBot', 'Chrome', '1.0.0'],
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      console.log('\n[bootstrap] WhatsApp authenticated successfully!');
      console.log(`[bootstrap] Uploading auth files to s3://${S3_BUCKET}/auth/ ...`);

      await uploadLocalAuthToS3(AUTH_DIR, S3_BUCKET!);

      console.log('[bootstrap] Done! Auth credentials are now in S3 (encrypted with KMS).');
      console.log('[bootstrap] Your Lambda function can now use these credentials.');

      // Print groups for convenience
      try {
        await new Promise((r) => setTimeout(r, 3000));
        const chats = await sock.groupFetchAllParticipating();
        const groups = Object.values(chats);
        if (groups.length > 0) {
          console.log('\n[bootstrap] Available groups:');
          groups.forEach((g) => {
            console.log(`  ${g.subject.padEnd(40)} JID: ${g.id}`);
          });
          console.log('\nSet the groupJid in your SSM parameter (/oref-bot/config).');
        }
      } catch {
        // Non-critical
      }

      sock.end(undefined);
      process.exit(0);
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      console.error(`[bootstrap] Connection closed — status=${statusCode}`);
      process.exit(1);
    }
  });
}

main().catch((err) => {
  console.error('[bootstrap] Fatal error:', err);
  process.exit(1);
});
