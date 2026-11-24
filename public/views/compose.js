// Feed posts on the phone: the "Share an update" composer, the note-and-photo sheet for something you
// did, and the full-size photo viewer. Photos are shrunk and re-encoded here before upload, which also
// drops EXIF and GPS (a photo taken at home would otherwise say where you live).
import { $, API_BASE, api, esc, guard, haptic, sheet, toast } from '../core.js';

export const POST_MAX = 500;
const MAX_EDGE = 1280;
const MAX_BYTES = 400 * 1024;

export const CAMERA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l1.6-2.4A1 1 0 0 1 9.4 5h5.2a1 1 0 0 1 .8.6L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>';
export const PEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14 8l3 3"/></svg>';

export const mediaUrl = (src) => (src && src.startsWith('/api/') ? API_BASE + src : src);

// ---------- photo prep ----------
async function decode(file) {
  // createImageBitmap applies the EXIF rotation, so the picture comes out upright.
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back below */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type, q));
const toBase64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]);
  r.onerror = rej;
  r.readAsDataURL(blob);
});

/** Shrink to 1280px, re-encode as WebP (or JPEG) under 400 KB. Returns { data, w, h, url }. */
export async function prepImage(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Pick a photo.');
  const src = await decode(file).catch(() => { throw new Error("Couldn't open that photo. Try another one."); });
  let scale = Math.min(1, MAX_EDGE / Math.max(src.width, src.height));
  for (let tries = 0; tries < 6; tries++) {
    const w = Math.max(1, Math.round(src.width * scale));
    const h = Math.max(1, Math.round(src.height * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(src, 0, 0, w, h);
    for (const q of [0.82, 0.7, 0.58]) {
      let blob = await toBlob(c, 'image/webp', q);
      if (!blob || blob.type !== 'image/webp') blob = await toBlob(c, 'image/jpeg', q);
      if (blob && blob.size <= MAX_BYTES) {
        src.close?.();
        return { data: await toBase64(blob), w, h, url: URL.createObjectURL(blob) };
      }
    }
    scale *= 0.8;
  }
  throw new Error('That photo is too big. Try another one.');
}

// ---------- the editor (text + one photo), used by the composer and the note sheet ----------
export function editorHtml({ id, body = '', image = null, placeholder = 'Share an update…', submit = 'Post', extra = '' }) {
  return `<form class="composer" id="${id}" novalidate>
    <label class="sr-only" for="${id}-body">${esc(placeholder)}</label>
    <textarea id="${id}-body" name="body" rows="2" maxlength="${POST_MAX}" placeholder="${esc(placeholder)}">${esc(body)}</textarea>
    <div class="composer-photo" ${image ? '' : 'hidden'}>
      <img alt="Photo to post" src="${esc(mediaUrl(image) || '')}">
      <button type="button" class="composer-x" aria-label="Remove photo">&times;</button>
    </div>
    <div class="composer-bar">
      <label class="btn sm quiet composer-pick">${CAMERA}<span>Photo</span>
        <input type="file" accept="image/*" class="sr-only" tabindex="-1"></label>
      <span class="tiny muted composer-count" aria-live="polite"></span>
      ${extra}
      <button class="btn sm go" type="submit">${esc(submit)}</button>
    </div>
  </form>`;
}

/** Wire an editor. onSubmit({ body, image, removeImage }) does the saving; return false to keep the text. */
export function wireEditor(form, { onSubmit, hadImage = false, allowEmpty = false }) {
  const ta = $('textarea', form);
  const box = $('.composer-photo', form);
  const img = $('img', box);
  const count = $('.composer-count', form);
  const btn = $('button[type=submit]', form);
  const file = $('input[type=file]', form);
  let photo = null;
  let removed = false;
  const update = () => {
    const left = POST_MAX - ta.value.length;
    count.textContent = left <= 80 ? `${left} left` : '';
    btn.disabled = !allowEmpty && !ta.value.trim() && !photo && (removed || !hadImage);
  };
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 260)}px`;
    update();
  });
  file.onchange = guard(async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    btn.disabled = true;
    count.textContent = 'Getting the photo ready';
    try {
      photo = await prepImage(f);
      img.src = photo.url;
      box.hidden = false;
      removed = false;
    } finally { update(); }
  });
  $('.composer-x', form).onclick = () => {
    if (photo) URL.revokeObjectURL(photo.url);
    photo = null;
    removed = true;
    box.hidden = true;
    img.removeAttribute('src');
    update();
  };
  form.onsubmit = guard(async (e) => {
    e.preventDefault();
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const ok = await onSubmit({
        body: ta.value.trim(),
        image: photo && { data: photo.data, w: photo.w, h: photo.h },
        removeImage: removed && !photo,
      });
      if (ok !== false) {
        ta.value = '';
        ta.style.height = '';
        if (photo) URL.revokeObjectURL(photo.url);
        photo = null;
        box.hidden = true;
      }
    } finally { update(); }
  });
  update();
}

// ---------- a note or photo on something you did ----------
/**
 * Sheet to add or edit the note and photo on one of your activities.
 * onSaved(post) gets { id, body, image, imageW, imageH } or null when both were removed.
 */
export function noteSheet({ activityId, post = null, title = 'Add a note or photo', lead = '', onSaved, later = false }) {
  const s = sheet(`<h2>${esc(title)}</h2>
    ${lead ? `<p class="muted">${esc(lead)}</p>` : ''}
    ${editorHtml({ id: 'noteForm', body: post?.body || '', image: post?.image || null, placeholder: 'How did it go?', submit: post ? 'Save' : 'Add to feed',
      extra: later ? '<button type="button" class="link-btn composer-later">Not now</button>' : '' })}
    <p class="tiny muted composer-note">Shows on your feed item to the people who can see it. No extra points.</p>`);
  const form = $('#noteForm', s.el);
  if (later) $('.composer-later', form).onclick = s.close;
  wireEditor(form, {
    hadImage: !!post?.image,
    allowEmpty: !!post,
    onSubmit: async (v) => {
      const r = await api(`/activity/${activityId}/post`, { method: 'PUT', body: v });
      haptic('success');
      toast(r.post ? (post ? 'Saved' : 'Added to the feed') : 'Removed');
      s.close();
      onSaved?.(r.post);
    },
  });
  setTimeout(() => $('textarea', form).focus(), 50);
  return s;
}

/** After logging or checking in: offer to add a note or photo to the feed item. */
export function offerFeedNote(activityId, what = '') {
  if (!activityId) return;
  setTimeout(() => noteSheet({
    activityId, later: true,
    title: 'Add a note or photo to the feed?',
    lead: what ? `Tell people how ${what} went, or add a picture.` : 'Tell people how it went, or add a picture.',
  }), 900);
}

// ---------- full-size photo ----------
export function openImage(src, alt = '') {
  const bd = document.createElement('div');
  bd.className = 'photo-view';
  bd.setAttribute('role', 'dialog');
  bd.setAttribute('aria-modal', 'true');
  bd.setAttribute('aria-label', 'Photo');
  bd.innerHTML = `<img src="${esc(mediaUrl(src))}" alt="${esc(alt)}"><button class="photo-close" aria-label="Close">&times;</button>`;
  const close = () => { bd.remove(); removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  bd.onclick = close;
  addEventListener('keydown', onKey);
  document.body.append(bd);
  $('.photo-close', bd).focus();
}
