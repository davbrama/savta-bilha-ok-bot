import makeWASocket, {
  AuthenticationState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import path from "path";
import fs from "fs";
import { config } from "./config.js";

export class WhatsAppClient {
  private sock: WASocket | null = null;
  private ready = false;
  private messageQueue: string[] = [];
  private reconnectDelay = 2000;
  private maxReconnectDelay = 30000;

  async connect(): Promise<void> {
    const authDir = path.resolve(config.authDir);
    fs.mkdirSync(authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    console.log(`[whatsapp] Using Baileys v${version.join(".")}`);

    this.sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false, // we handle QR ourselves
      browser: ["OrefBot", "Chrome", "1.0.0"],
      syncFullHistory: false,
    });

    this.sock.ev.on("creds.update", saveCreds);

    this.sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log("\n[whatsapp] Scan this QR code with your WhatsApp:\n");
        qrcode.generate(qr, { small: true });
        console.log();
      }

      if (connection === "open") {
        console.log("[whatsapp] Connected ✓");
        this.ready = true;
        this.reconnectDelay = 2000; // reset backoff

        // Print group list if no groupJid configured yet
        if (!config.groupJid) {
          await this.printGroups();
        }

        // Flush any queued messages
        while (this.messageQueue.length > 0) {
          const msg = this.messageQueue.shift()!;
          await this.sendToGroup(config.groupJid, msg);
        }
      }

      if (connection === "close") {
        this.ready = false;
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(
          `[whatsapp] Connection closed — status=${statusCode}, reconnect=${shouldReconnect}`,
        );

        if (shouldReconnect) {
          console.log(`[whatsapp] Reconnecting in ${this.reconnectDelay}ms...`);
          setTimeout(() => {
            this.reconnectDelay = Math.min(
              this.reconnectDelay * 2,
              this.maxReconnectDelay,
            );
            this.connect();
          }, this.reconnectDelay);
        } else {
          console.error(
            "[whatsapp] Logged out. Delete ./auth and restart to re-authenticate.",
          );
          process.exit(1);
        }
      }
    });
  }

  async sendToGroup(jid: string, message: string): Promise<void> {
    if (!jid) {
      console.warn("[whatsapp] No GROUP_JID configured, cannot send message");
      return;
    }

    if (!this.ready || !this.sock) {
      console.warn("[whatsapp] Not connected yet, queuing message");
      this.messageQueue.push(message);
      return;
    }

    try {
      await this.sock.sendMessage(jid, { text: message });
      console.log(`[whatsapp] Message sent to ${jid}`);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error("[whatsapp] Failed to send message:", error.message);
      // Re-queue so it retries on reconnect
      this.messageQueue.unshift(message);
    }
  }

  private async printGroups(): Promise<void> {
    if (!this.sock) return;

    // Give the store a moment to populate after connection
    await new Promise((r) => setTimeout(r, 3000));

    try {
      // Fetch all chats from the store
      const chats = await this.sock.groupFetchAllParticipating();
      const groups = Object.values(chats);

      if (groups.length === 0) {
        console.log(
          "[whatsapp] No groups found. Make sure this account is in at least one group.",
        );
        return;
      }

      console.log("\n[whatsapp] ── Groups this account is in ──");
      groups.forEach((g) => {
        console.log(`  ${g.subject.padEnd(40)} JID: ${g.id}`);
      });
      console.log("[whatsapp] ─────────────────────────────────");
      console.log(
        "[whatsapp] Copy the JID and set it in config.json → groupJid\n",
      );
    } catch (err) {
      console.error("[whatsapp] Could not fetch groups:", err);
    }
  }
}

/**
 * Ephemeral connect → send → disconnect for Lambda.
 * Takes a pre-loaded auth state (e.g. from S3) so it doesn't touch local disk.
 */
export async function sendOnce(
  groupJid: string,
  message: string,
  authState: { state: AuthenticationState; saveCreds: () => Promise<void> },
): Promise<void> {
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: authState.state,
    printQRInTerminal: false,
    browser: ["OrefBot", "Chrome", "1.0.0"],
    syncFullHistory: false,
  });

  sock.ev.on("creds.update", authState.saveCreds);

  // Wait for connection to open (or fail)
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("WhatsApp connection timed out after 15s"));
    }, 15000);

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "open") {
        clearTimeout(timeout);
        resolve();
      }

      if (connection === "close") {
        clearTimeout(timeout);
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        reject(
          new Error(`WhatsApp connection closed — status=${statusCode}`),
        );
      }
    });
  });

  try {
    await sock.sendMessage(groupJid, { text: message });
    console.log(`[whatsapp] Message sent to ${groupJid}`);
  } finally {
    sock.end(undefined);
  }
}
