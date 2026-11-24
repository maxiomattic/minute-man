// Demo clock. When a demo date is set, the whole app (server and client) behaves as if
// today is that date in the given time zone. The time of day still runs, so "this morning"
// and "tonight" read naturally. Used by the server (src/) and the browser (public/).
//
//   installClock({ date: '2026-10-01', zone: 'America/Chicago' })
//
// It replaces the global Date with a subclass whose no-argument constructor and Date.now()
// return the shifted time. Dates built from explicit values are untouched.
const Real = globalThis.__RealDate || Date;
globalThis.__RealDate = Real;

function zoneOffsetMs(ms, zone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Real(ms)).map((x) => [x.type, x.value]),
  );
  const asUtc = Real.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

let shift = null; // () => ms

export function installClock({ date, zone } = {}) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    globalThis.Date = Real;
    shift = null;
    return;
  }
  const [y, m, d] = date.split('-').map(Number);
  shift = () => {
    const now = Real.now();
    const msOfDay = (((now + zoneOffsetMs(now, zone)) % 86400000) + 86400000) % 86400000;
    const localMidnightAsUtc = Real.UTC(y, m - 1, d);
    // Offset of the demo day itself (DST may differ from today's).
    const off = zoneOffsetMs(localMidnightAsUtc + 12 * 3600000, zone);
    return localMidnightAsUtc - off + msOfDay;
  };
  class DemoDate extends Real {
    constructor(...a) {
      if (a.length) super(...a);
      else super(shift());
    }
    static now() {
      return shift();
    }
  }
  globalThis.Date = DemoDate;
}

export const clockActive = () => !!shift;
