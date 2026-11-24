// The phone's own reminders to register and vote (Android/iOS app only; the web app has none).
// Rescheduled from each Today load, so they follow the next election and stop once you've voted.
// They're local notifications: nothing is sent from a server, and nothing about how you vote is used.
import { isNative, store } from './core.js';

const LN = () => window.Capacitor?.Plugins?.LocalNotifications;
const IDS = [7001, 7002, 7003, 7004, 7005, 7006];
const at = (iso, hour) => new Date(`${iso}T${String(hour).padStart(2, '0')}:00:00`);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** What to send and when, for one election. Exported for tests. */
export function reminderPlan(e, now = new Date()) {
  if (!e || e.voted) return [];
  const out = [];
  const add = (id, when, title, body) => when > now && out.push({ id, title, body, schedule: { at: when, allowWhileIdle: true } });
  if (!e.registered && e.registration_deadline)
    add(7001, at(addDays(e.registration_deadline, -3), 18), 'Register to vote', `Three days left to register for the ${e.name}. It takes about 2 minutes.`);
  if (e.early_voting_start) {
    add(7002, at(e.early_voting_start, 9), 'Early voting is open', `Vote early and skip the line. Your picks for the ${e.name} are ready.`);
    add(7003, at(addDays(e.early_voting_start, 4), 17), 'Have you voted yet?', 'Early voting is open. Your picks and polling place are in Minute Man.');
  }
  const day = new Date(`${e.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  add(7004, at(addDays(e.date, -4), 9), 'Last days of early voting', `Vote early and skip the Election Day line. Election Day is ${day}.`);
  add(7005, at(addDays(e.date, -1), 18), 'Tomorrow is Election Day', 'Your picks and polling place are ready in Minute Man.');
  add(7006, at(e.date, 7), 'Election Day. Go vote.', 'Polls are open. Your picks are ready.');
  return out;
}

export async function scheduleVoteReminders(t) {
  const ln = LN();
  if (!isNative || !ln) return;
  try {
    let perm = await ln.checkPermissions();
    // Ask once; if they say no, don't keep asking.
    if (perm.display !== 'granted' && !store.get('notifyAsked')) {
      store.set('notifyAsked', 1);
      perm = await ln.requestPermissions();
    }
    if (perm.display !== 'granted') return;
    await ln.cancel({ notifications: IDS.map((id) => ({ id })) });
    const plan = reminderPlan(t.election);
    if (plan.length) await ln.schedule({ notifications: plan });
  } catch { /* reminders are a nice-to-have; never break Today */ }
}
