// Remind someone to vote: a short, personal message for someone who isn't on Minute Man yet (people on
// the app already get its reminders). The voter picks a message, edits it if they like, and their phone's
// share sheet sends it (a text, or any app). Nothing is ever sent automatically. A finished share records
// a 'reminded' activity; cancelling records nothing. Points are honorific.
import { $, $$, api, esc, guard, haptic, icon, refreshStats, sheet, toast, xpFly } from '../core.js';

/** Open the phone's share sheet. Returns true (shared), 'copied' (clipboard fallback) or false (cancelled). */
async function send(message) {
  const NativeShare = window.Capacitor?.Plugins?.Share;
  try {
    if (NativeShare) { await NativeShare.share({ text: message, dialogTitle: 'Send a reminder' }); return true; }
    if (navigator.share) { await navigator.share({ text: message }); return true; }
  } catch (e) {
    if (e?.name === 'AbortError' || /cancel/i.test(e?.message || '')) return false;
  }
  try {
    await navigator.clipboard.writeText(message);
    return 'copied';
  } catch {
    toast("Couldn't open sharing on this device.");
    return false;
  }
}

export async function openRemind(onDone) {
  const d = await api('/reminders');
  let i = 0;
  const { el, close } = sheet(`<div class="vb">
    <div class="row between" style="margin-bottom:4px"><h2 style="margin:0">Remind someone to vote</h2>
      <button class="icon-btn" data-close aria-label="Close">${icon('close')}</button></div>
    <p class="small muted" style="margin:0">For someone who isn't on Minute Man yet. It goes from your phone as a text, or in any app.</p>
    <div class="remind-pick" role="group" aria-label="Which reminder">${d.reminders.map((r, k) =>
      `<button type="button" data-r="${k}" aria-pressed="${k === 0}">${esc(r.label)}</button>`).join('')}</div>
    <figure class="post-card"><label class="sr-only" for="rtext">Your message</label>
      <textarea id="rtext" class="post-text remind-text" rows="4" maxlength="400"></textarea>
      <figcaption class="post-link" id="rlink"></figcaption></figure>
    <p class="tiny muted" id="rpts" style="margin:8px 0 12px"></p>
    <button class="btn go block" id="rsend">Send reminder</button>
    <p class="tiny muted center" style="margin-top:10px">You pick who gets it. Nothing is sent until you do.</p>
  </div>`);
  $('[data-close]', el).onclick = close;
  const btn = $('#rsend', el);
  const text = $('#rtext', el);
  $('#rlink', el).textContent = d.url.replace(/^https?:\/\//, '');
  const pick = (k) => {
    i = k;
    text.value = d.reminders[i].text;
    $$('[data-r]', el).forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.r) === i)));
  };
  const paint = () => {
    const left = d.pointsLeftToday;
    const capped = d.limitLeftToday <= 0;
    $('#rpts', el).textContent = capped ? "That's plenty for today. Thank you! Pick it up again tomorrow."
      : left > 0 ? `+${d.perReminder} XP per reminder, up to ${d.dailyCap} a day.` : "You've earned today's reminder points. Reminders still count toward your goals.";
    btn.disabled = capped;
    btn.innerHTML = `Send reminder${left > 0 && !capped ? ` <span class="xp">+${Math.min(d.perReminder, left)}</span>` : ''}`;
  };
  pick(0);
  paint();
  $$('[data-r]', el).forEach((b) => (b.onclick = () => { haptic(); pick(Number(b.dataset.r)); }));
  btn.onclick = guard(async () => {
    const r = d.reminders[i];
    const message = `${text.value.trim() || r.text} ${d.url}`;
    btn.disabled = true;
    try {
      const how = await send(message);
      if (!how) return;
      const res = await api('/reminders/share', { method: 'POST', body: { reminderId: r.id } });
      d.pointsLeftToday = Math.max(0, d.pointsLeftToday - res.points);
      d.limitLeftToday -= 1;
      haptic('success');
      const xp = res.points ? ` +${res.points} XP` : '';
      toast(how === 'copied' ? `Copied. Paste it into a text.${xp}` : `Reminder sent. Thanks!${xp}`);
      if (res.points) xpFly(res.points, btn);
      refreshStats();
      onDone?.();
    } finally { btn.disabled = false; paint(); }
  });
}
