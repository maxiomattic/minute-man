// Calendar days follow the voters' local time zone, not UTC, so "today", deadlines,
// daily quests and weekly streaks roll over at local midnight.
// One zone for the whole deployment (the showcase is in Texas, Central time); see configureClock().
import { installClock } from '../public/clock.js';

let ZONE = 'America/Chicago';
let DEMO_DATE = null;
export const setZone = (z) => { if (z) ZONE = z; };
export const zone = () => ZONE;

/** Set the deployment's time zone and optional demo date (YYYY-MM-DD). Call before anything else. */
export function configureClock({ zone: z, demoDate } = {}) {
  setZone(z);
  DEMO_DATE = demoDate || null;
  installClock({ date: DEMO_DATE, zone: ZONE });
}
export const clockConfig = () => ({ zone: ZONE, demoDate: DEMO_DATE });

const parts = (d) => Object.fromEntries(
  new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(d).map((p) => [p.type, p.value]));

/** YYYY-MM-DD in the local zone. */
export const localDay = (d = new Date()) => { const p = parts(d); return `${p.year}-${p.month}-${p.day}`; };

/** Minutes the local zone is ahead of UTC at instant d (negative in the Americas). */
export const offsetMin = (d = new Date()) => {
  const p = parts(d);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000) / 60000);
};

/** Local wall-clock time on `day` at `hour` -> UTC 'YYYY-MM-DD HH:MM:SS' (how timestamps are stored). */
export const utcAt = (day, hour = 0, minute = 0) => {
  const guess = new Date(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);
  const t = new Date(guess.getTime() - offsetMin(guess) * 60000);
  return t.toISOString().slice(0, 19).replace('T', ' ');
};

/** SQLite modifier that shifts a stored UTC timestamp to local time, e.g. date(at, sqlShift()). */
export const sqlShift = () => `${offsetMin()} minutes`;
