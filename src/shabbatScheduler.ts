import SunCalc from 'suncalc';
import { AlertPoller } from './alertPoller.js';
import { Config, config } from './config.js';

const TEL_AVIV_LAT = 32.0853;
const TEL_AVIV_LON = 34.7818;

interface ShabbatWindow {
  start: Date;
  end: Date;
}

function getShabbatWindowForFriday(friday: Date, cfg: Config): ShabbatWindow {
  const saturday = new Date(friday);
  saturday.setDate(friday.getDate() + 1);

  const fridaySunset = SunCalc.getTimes(friday, TEL_AVIV_LAT, TEL_AVIV_LON).sunset;
  const saturdaySunset = SunCalc.getTimes(saturday, TEL_AVIV_LAT, TEL_AVIV_LON).sunset;

  const start = new Date(fridaySunset.getTime() - cfg.shabbatStartOffsetMin * 60_000);
  const end = new Date(saturdaySunset.getTime() + cfg.shabbatEndOffsetMin * 60_000);

  return { start, end };
}

function getCurrentShabbatWindow(now: Date, cfg: Config): ShabbatWindow | null {
  const day = now.getDay(); // 0=Sun, 5=Fri, 6=Sat

  if (day === 5) {
    return getShabbatWindowForFriday(now, cfg);
  }

  if (day === 6) {
    const friday = new Date(now);
    friday.setDate(now.getDate() - 1);
    return getShabbatWindowForFriday(friday, cfg);
  }

  if (day === 0) {
    const friday = new Date(now);
    friday.setDate(now.getDate() - 2);
    const window = getShabbatWindowForFriday(friday, cfg);
    if (now <= window.end) return window;
  }

  return null;
}

/** Check if it's currently Shabbat. Accepts optional config for Lambda use. */
export function isShabbatNow(cfg?: Config): boolean {
  const c = cfg ?? config;
  if (!c.shabbatMode) return false;
  const now = new Date();
  const window = getCurrentShabbatWindow(now, c);
  return window !== null && now >= window.start && now <= window.end;
}

export class ShabbatScheduler {
  private poller: AlertPoller;
  private timer: NodeJS.Timeout | null = null;

  constructor(poller: AlertPoller) {
    this.poller = poller;
  }

  init(): void {
    const now = new Date();
    const window = getCurrentShabbatWindow(now, config);

    if (window && now >= window.start && now <= window.end) {
      console.log(`[shabbat] Currently Shabbat — poller will remain stopped until ${window.end.toLocaleString('he-IL')}`);
      this.scheduleTransition(window.end, () => this.onShabbatEnd());
    } else {
      this.poller.start();
      const next = this.getNextShabbatStart(now);
      console.log(`[shabbat] Next Shabbat starts ${next.toLocaleString('he-IL')}`);
      this.scheduleTransition(next, () => this.onShabbatStart());
    }
  }

  destroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private getNextShabbatStart(now: Date): Date {
    const day = now.getDay();
    const daysUntilFriday = (5 - day + 7) % 7 || 7; // at least 1 day ahead if already Friday
    const nextFriday = new Date(now);
    nextFriday.setDate(now.getDate() + daysUntilFriday);

    const window = getShabbatWindowForFriday(nextFriday, config);

    // If it's Friday and we haven't passed the start yet, use today
    if (day === 5) {
      const todayWindow = getShabbatWindowForFriday(now, config);
      if (now < todayWindow.start) return todayWindow.start;
    }

    return window.start;
  }

  private scheduleTransition(at: Date, callback: () => void): void {
    const delayMs = at.getTime() - Date.now();
    if (delayMs <= 0) {
      callback();
      return;
    }
    this.timer = setTimeout(callback, delayMs);
  }

  private onShabbatStart(): void {
    console.log('[shabbat] Shabbat starting — stopping poller');
    this.poller.stop();

    const now = new Date();
    const window = getCurrentShabbatWindow(now, config);
    if (window) {
      console.log(`[shabbat] Poller will resume at ${window.end.toLocaleString('he-IL')}`);
      this.scheduleTransition(window.end, () => this.onShabbatEnd());
    }
  }

  private onShabbatEnd(): void {
    console.log('[shabbat] Shabbat ended — starting poller');
    this.poller.start();

    const now = new Date();
    const next = this.getNextShabbatStart(now);
    console.log(`[shabbat] Next Shabbat starts ${next.toLocaleString('he-IL')}`);
    this.scheduleTransition(next, () => this.onShabbatStart());
  }
}
