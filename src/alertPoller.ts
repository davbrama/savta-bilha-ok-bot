import axios from "axios";
import { EventEmitter } from "events";
import { OrefAlert, OrefApiResponse } from "./types.js";
import { config } from "./config.js";

const OREF_URL = "https://www.oref.org.il/WarningMessages/alert/alerts.json";

// Headers required to avoid being blocked — oref.org.il checks Referer
const REQUEST_HEADERS = {
  Referer: "https://www.oref.org.il/",
  "X-Requested-With": "XMLHttpRequest",
  "Content-Type": "application/json",
};

export interface AlertPollerEvents {
  alert: (alert: OrefAlert) => void;
  error: (err: Error) => void;
}

export class AlertPoller extends EventEmitter {
  private lastAlertId: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log(`[poller] Starting — polling every ${config.pollIntervalMs}ms`);
    this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("[poller] Stopped");
  }

  private schedule(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => this.poll(), config.pollIntervalMs);
  }

  private async poll(): Promise<void> {
    try {
      const response = await axios.get<OrefApiResponse | "">(OREF_URL, {
        headers: REQUEST_HEADERS,
        timeout: 5000,
        // oref sometimes returns non-UTF8 — let axios handle encoding
        responseType: "text",
      });

      const body = response.data as unknown as string;

      // Empty body = no active alert
      if (!body || body.trim() === "" || body.trim() === "{}") {
        this.lastAlertId = null;
        this.schedule();
        return;
      }

      let parsed: OrefApiResponse;
      try {
        parsed = JSON.parse(body);
      } catch {
        this.schedule();
        return;
      }

      // Guard against empty/malformed responses
      if (!parsed.id || !parsed.data?.length) {
        this.schedule();
        return;
      }

      // De-duplicate: same alert id = already handled
      if (parsed.id === this.lastAlertId) {
        this.schedule();
        return;
      }

      this.lastAlertId = parsed.id;

      const alert: OrefAlert = {
        id: parsed.id,
        cat: parseInt(parsed.cat as unknown as string, 10),
        title: parsed.title,
        data: parsed.data,
        desc: parsed.desc,
      };

      if (this.passesFilter(alert)) {
        console.log(
          `[poller] New alert — cat=${alert.cat}, cities=${alert.data.join(", ")}`,
        );
        this.emit("alert", alert);
      } else {
        console.log(
          `[poller] Alert filtered out — id=${alert.id} cat=${alert.cat}, cities=${alert.data.join(", ")}`,
        );
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error("[poller] Request failed:", error.message);
      this.emit("error", error);
    }

    this.schedule();
  }

  private passesFilter(alert: OrefAlert): boolean {
    const { cities, alertCategories } = config;

    // If no category filter configured, pass all
    const categoryOk =
      alertCategories.length === 0 || alertCategories.includes(alert.cat);

    // If no city filter configured, pass all
    const cityOk =
      cities.length === 0 || alert.data.some((city) => cities.includes(city));

    return categoryOk && cityOk;
  }
}
