// Feed: everything people are getting done, ranked by impact and how close it is to you.
// The server does the ranking (src/engine/community.js); this page pages through it as you scroll.
import { $, api, esc, state } from '../core.js';
import { bindCheers, feedItemHtml } from './crew.js';

const n = (x) => Number(x || 0).toLocaleString('en-US');

function togetherHtml(t) {
  if (!t) return '';
  const parts = [[t.doors, 'doors knocked'], [t.calls, 'calls made'], [t.events, 'meetings and shifts'], [t.posts, 'posts shared']].filter(([v]) => v > 0);
  return `<section class="muster" aria-label="${esc(t.label)} in the last 30 days">
    <p class="muster-head">${esc(t.label)}, last 30 days</p>
    <div class="muster-figs">${parts.map(([v, l]) => `<div><b class="num">${n(v)}</b><span>${l}</span></div>`).join('')}</div>
    <p class="muster-foot">${n(t.active)} neighbors showed up. Every door counts.</p>
  </section>`;
}

export async function render(el) {
  el.innerHTML = `<div class="feed-page">
    <h1>Feed</h1>
    <div id="together"></div>
    <div id="feedList" class="panel flush"><div class="skeleton"></div></div>
    <div id="feedMore" class="feed-more" aria-live="polite"></div>
  </div>`;
  const list = $('#feedList', el);
  const moreEl = $('#feedMore', el);
  api('/together').then((t) => { const box = $('#together', el); if (box) box.innerHTML = togetherHtml(t); }).catch(() => {});

  let cursor = 0;
  let loading = false;
  let first = true;
  const load = async () => {
    if (loading || cursor === null) return;
    loading = true;
    moreEl.textContent = first ? '' : 'Loading more';
    try {
      const page = await api(`/feed?cursor=${cursor}`);
      if (first) list.innerHTML = '';
      first = false;
      if (!page.items.length && !list.children.length) {
        list.outerHTML = `<div class="panel empty"><h2>Nothing yet</h2>
          <p>When people near you knock doors, make calls or show up to a meeting, it shows up here.</p>
          <a class="btn go" href="#/today">Find something to do</a></div>`;
      } else {
        const box = document.createElement('div');
        box.innerHTML = page.items.map(feedItemHtml).join('');
        bindCheers(box);
        list.append(...box.children);
      }
      cursor = page.next;
      moreEl.textContent = cursor === null && list.children.length > 4 ? "You're all caught up." : '';
    } catch (e) {
      moreEl.innerHTML = `<button class="btn quiet sm" id="retry">Try again</button>`;
      $('#retry', moreEl).onclick = load;
    } finally {
      loading = false;
    }
  };
  await load();
  // Infinite scroll: load the next page when the bottom comes into view.
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) load(); }, { rootMargin: '600px 0px' });
  io.observe(moreEl);
  // Stop watching once this page is gone.
  const stop = () => { io.disconnect(); window.removeEventListener('hashchange', stop); };
  window.addEventListener('hashchange', stop);
  if (!state.me?.onLeaderboards)
    moreEl.insertAdjacentHTML('beforebegin', '<p class="tiny muted feed-privacy">Others don\'t see your actions here. <a href="#/me">Show me to others</a></p>');
}
