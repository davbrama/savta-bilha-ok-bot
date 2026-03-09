/**
 * One-time bootstrap script: authenticates with WhatsApp via QR code locally,
 * then uploads the resulting auth state to S3 (encrypted via SSE-KMS).
 *
 * Usage: npm run auth-bootstrap
 *
 * Required env vars:
 *   AUTH_S3_BUCKET — S3 bucket name for auth storage
 *   AWS_REGION     — (or configured via AWS CLI profile)
 * Optional env vars:
 *   KMS_KEY_ID     — KMS key ARN for S3 encryption (recommended)
 */

import makeWASocket, {
  DisconnectReason,
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
const KMS_KEY_ID = process.env.KMS_KEY_ID;

if (!S3_BUCKET) {
  console.error('[bootstrap] AUTH_S3_BUCKET env var is required');
  process.exit(1);
}

function cleanupLocalAuth() {
  try {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    console.log('[bootstrap] Local auth directory cleaned up');
  } catch {
    console.warn('[bootstrap] Could not clean up local auth dir — delete ./auth/ manually');
  }
}

async function connectAndAuth(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['OrefBot', 'Chrome', '1.0.0'],
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  return new Promise<void>((resolve, reject) => {
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'open') {
        console.log('\n[bootstrap] WhatsApp authenticated successfully!');
        console.log(`[bootstrap] Uploading auth files to s3://${S3_BUCKET}/auth/ ...`);

        await uploadLocalAuthToS3(AUTH_DIR, S3_BUCKET!, 'auth/', KMS_KEY_ID);

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
        resolve();
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;

        // 515 = restart required (normal after pairing), also reconnect on other recoverable codes
        if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
          console.log('[bootstrap] Restart required after pairing — reconnecting...');
          sock.end(undefined);
          // Reconnect with updated auth state
          connectAndAuth().then(resolve, reject);
          return;
        }

        if (statusCode === DisconnectReason.loggedOut) {
          reject(new Error('Logged out — delete ./auth/ and try again'));
          return;
        }

        reject(new Error(`Connection closed — status=${statusCode}`));
      }
    });
  });
}

async function main() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  console.log('[bootstrap] Starting WhatsApp authentication...');
  console.log('[bootstrap] Scan the QR code with your phone when it appears.\n');

  await connectAndAuth();

  cleanupLocalAuth();
}

main().catch((err) => {
  console.error('[bootstrap] Fatal error:', err);
  cleanupLocalAuth();
  process.exit(1);
});
