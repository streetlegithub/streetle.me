// app.js: site-wide bootstrapping

window.addEventListener('DOMContentLoaded', () => {
  initNowPlaying();
  initCustomCursor();
  initSteamPlaying();
  initUkTime();
  initCopyDiscord();
  initMicroBio();
  // Ensure bottom content isn't obscured by fixed widgets
  queueReserveUpdate(true);
  window.addEventListener('resize', () => queueReserveUpdate(), { passive: true });
  // Position the mobile-only note under the brand hero
  setupMobileNote();
  initMenu();
});

/* ── Widget reserve (bottom spacing) ── */

let _reserveScheduled = false;
function queueReserveUpdate(delayUntilLoad = false) {
  const run = () => {
    if (_reserveScheduled) return;
    _reserveScheduled = true;
    requestAnimationFrame(() => {
      updateWidgetReserve();
      _reserveScheduled = false;
    });
  };
  if (delayUntilLoad && document.readyState !== 'complete') {
    window.addEventListener('load', run, { once: true });
  } else {
    run();
  }
}

function updateWidgetReserve() {
  try {
    const overlays = [];
    const np = document.getElementById('nowPlaying');
    const sp = document.getElementById('steamPlaying');
    const mb = document.querySelector('.micro-bio');
    if (np && !np.classList.contains('now-playing--hidden')) overlays.push(np);
    if (sp && !sp.classList.contains('steam-playing--hidden')) overlays.push(sp);
    if (mb) overlays.push(mb);
    if (overlays.length === 0) {
      document.documentElement.style.setProperty('--widget-reserve', '0px');
      return;
    }
    let minTop = Number.POSITIVE_INFINITY;
    overlays.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      if (rect.top < minTop) minTop = rect.top;
    });
    if (!isFinite(minTop)) {
      document.documentElement.style.setProperty('--widget-reserve', '0px');
      return;
    }
    const reserve = Math.max(0, Math.round(window.innerHeight - minTop + 12));
    document.documentElement.style.setProperty('--widget-reserve', reserve + 'px');
  } catch (_) {
    // noop
  }
}

/* ── Mobile note positioning ── */

function setupMobileNote() {
  const note = document.getElementById('mobileNote');
  const hero = document.querySelector('.brand-hero');
  if (!note || !hero) return;
  const apply = () => {
    if (window.matchMedia('(max-width: 520px)').matches) {
      const r = hero.getBoundingClientRect();
      const top = Math.max(8, r.bottom + 10);
      const left = Math.max(8, r.left);
      note.style.top = `${top}px`;
      note.style.left = `${left}px`;
    }
  };
  const schedule = () => requestAnimationFrame(apply);
  schedule();
  if (document.readyState !== 'complete') {
    window.addEventListener('load', schedule, { once: true });
  }
  window.addEventListener('resize', schedule, { passive: true });
}

/* ── Spotify Now Playing ── */

function initNowPlaying() {
  const endpoint = 'https://spotify-worker.streetle.workers.dev/';
  const el = document.getElementById('nowPlaying');
  if (!el) return;
  const cover = el.querySelector('.now-playing__cover');
  const title = document.getElementById('npTitle');
  const artist = document.getElementById('npArtist');
  const bar = document.getElementById('npBar');
  const openBtn = document.getElementById('npOpen');

  let lastTrackId = null;
  let progressTimer = null;
  let trackDuration = 0;
  let startedAt = 0;
  let entered = false;

  el.addEventListener('animationend', (e) => {
    if (e.animationName === 'npEnter') {
      entered = true;
      if (el.dataset.bgPending === '1') {
        requestAnimationFrame(() => {
          el.classList.add('now-playing--bg-ready');
          delete el.dataset.bgPending;
        });
      }
    }
  });

  setTimeout(() => {
    if (!entered) {
      entered = true;
      if (el.dataset.bgPending === '1') {
        el.classList.add('now-playing--bg-ready');
        delete el.dataset.bgPending;
      }
    }
  }, 2200);

  const fetchData = async () => {
    try {
      const r = await fetch(endpoint, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      updateWidget(data);
    } catch (err) {
      el.classList.add('now-playing--hidden');
      queueReserveUpdate();
    }
  };

  function updateWidget(data) {
    if (!data || !data.item || data.currently_playing_type !== 'track') {
      el.classList.add('now-playing--hidden');
      queueReserveUpdate();
      return;
    }
    const track = data.item;
    const isPlaying = data.is_playing;
    const trackId = track.id;
    trackDuration = track.duration_ms;
    startedAt = Date.now() - (data.progress_ms || 0);

    title.textContent = track.name;
    artist.textContent = track.artists.map(a => a.name).join(', ');
    const images = track.album.images || [];
    const smallest = images[images.length - 1];
    const medium = images[Math.floor(images.length / 2)];
    cover.src = (smallest && smallest.url) || (medium && medium.url) || '';
    if (medium || smallest) {
      const bgUrl = (medium && medium.url) || (smallest && smallest.url);
      const newVal = `url("${bgUrl}")`;
      const current = el.style.getPropertyValue('--np-bg');
      if (current !== newVal) {
        el.style.setProperty('--np-bg', newVal);
        if (entered) {
          if (!el.classList.contains('now-playing--bg-ready')) {
            requestAnimationFrame(() => el.classList.add('now-playing--bg-ready'));
          }
        } else {
          el.classList.remove('now-playing--bg-ready');
          el.dataset.bgPending = '1';
        }
      } else if (entered && !el.classList.contains('now-playing--bg-ready')) {
        requestAnimationFrame(() => el.classList.add('now-playing--bg-ready'));
      }
    } else {
      el.style.setProperty('--np-bg', 'none');
      el.classList.remove('now-playing--bg-ready');
      delete el.dataset.bgPending;
    }
    openBtn.onclick = () => window.open(track.external_urls.spotify, '_blank', 'noopener');

    if (isPlaying) {
      el.classList.remove('now-playing--hidden');
    } else {
      el.classList.add('now-playing--hidden');
      queueReserveUpdate();
      return;
    }

    queueReserveUpdate();

    if (trackId !== lastTrackId) {
      lastTrackId = trackId;
      bar.style.width = ((data.progress_ms / trackDuration) * 100).toFixed(2) + '%';
    }
    if (progressTimer) cancelAnimationFrame(progressTimer);
    progressLoop();
  }

  function progressLoop() {
    const elapsed = Date.now() - startedAt;
    const pct = Math.min(100, (elapsed / trackDuration) * 100);
    bar.style.width = pct.toFixed(2) + '%';
    if (pct < 100) progressTimer = requestAnimationFrame(progressLoop);
  }

  const MIN_POLL_MS = 30000;
  function scheduleNextPoll() {
    let delay = MIN_POLL_MS;
    if (trackDuration && startedAt) {
      const elapsed = Date.now() - startedAt;
      const remaining = trackDuration - elapsed;
      if (remaining > 0 && remaining + 2500 < MIN_POLL_MS) {
        delay = Math.max(4000, remaining + 1200);
      }
    }
    setTimeout(poll, delay);
  }

  async function poll() {
    await fetchData();
    scheduleNextPoll();
  }

  poll();

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => queueReserveUpdate());
    ro.observe(el);
  }
}

/* ── Steam Playing ── */

function initSteamPlaying() {
  const endpoint = 'https://steam-worker.streetle.workers.dev/';
  const el = document.getElementById('steamPlaying');
  if (!el) return;
  const art = el.querySelector('.steam-playing__art');
  const title = document.getElementById('spTitle');
  const open = document.getElementById('spOpen');
  let lastGameId = null;
  let observerAttached = false;

  function reposition() {
    const music = document.getElementById('nowPlaying');
    if (!music || music.classList.contains('now-playing--hidden')) {
      el.style.bottom = 'clamp(1.2rem,3vh,2rem)';
      return;
    }
    const rect = music.getBoundingClientRect();
    const height = rect.height || 90;
    const gap = 14;
    const safe = 'env(safe-area-inset-bottom, 0px)';
    el.style.bottom = `calc(max(clamp(1.2rem,3vh,2rem), ${safe}) + ${height + gap}px)`;
  }

  async function fetchSteam() {
    try {
      const r = await fetch(endpoint, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      updateSteam(data);
    } catch (e) {
      el.classList.add('steam-playing--hidden');
    }
  }

  function updateSteam(data) {
    if (!data || !data.game || !data.game.id) {
      el.classList.add('steam-playing--hidden');
      reposition();
      queueReserveUpdate();
      return;
    }
    const g = data.game;
    title.textContent = g.name || 'Unknown Game';
    if (g.icon) art.src = g.icon; else art.removeAttribute('src');
    open.href = g.id ? `https://store.steampowered.com/app/${g.id}` : '#';
    el.classList.remove('steam-playing--hidden');
    if (g.icon) {
      const bgUrl = g.icon;
      const newVal = `url("${bgUrl}")`;
      if (el.style.getPropertyValue('--sp-bg') !== newVal) {
        el.classList.remove('sp-bg-ready');
        el.style.setProperty('--sp-bg', newVal);
        requestAnimationFrame(() => el.classList.add('sp-bg-ready'));
      }
    } else {
      el.style.setProperty('--sp-bg', 'none');
      el.classList.remove('sp-bg-ready');
    }
    reposition();
    queueReserveUpdate();
    if (g.id !== lastGameId) {
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
      lastGameId = g.id;
    }
    if (!observerAttached) {
      const music = document.getElementById('nowPlaying');
      if (window.ResizeObserver && music) {
        const ro = new ResizeObserver(() => { reposition(); queueReserveUpdate(); });
        ro.observe(music);
      }
      window.addEventListener('resize', () => { reposition(); queueReserveUpdate(); }, { passive: true });
      observerAttached = true;
    }
  }

  const BASE = 45000;
  function schedule() { setTimeout(loop, BASE); }
  async function loop() { await fetchSteam(); schedule(); }
  fetchSteam(); schedule();

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => queueReserveUpdate());
    ro.observe(el);
  }
}

/* ── Custom Cursor (minimal smoothing) ── */

function initCustomCursor() {
  // Skip on touch devices
  if (window.matchMedia('(pointer: coarse)').matches) return;

  const layer = document.querySelector('.cursor-layer');
  if (!layer) return;
  const ring = layer.querySelector('.cursor-ring');
  if (!ring) return;

  let mx = window.innerWidth / 2;
  let my = window.innerHeight / 2;
  let rx = mx, ry = my;
  let hidden = false;
  let isDown = false;
  let isLink = false;

  // Very light smoothing — ring catches up in ~2 frames at 60fps
  const FOLLOW = 0.75;

  function tick() {
    rx += (mx - rx) * FOLLOW;
    ry += (my - ry) * FOLLOW;

    // Offset the ring by half its current size so it centers on the pointer
    const size = isLink ? 38 : (isDown ? 22 : 26);
    const half = size / 2;
    ring.style.transform = `translate3d(${rx - half}px, ${ry - half}px, 0)`;

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function show() {
    if (hidden) { document.body.classList.remove('cursor-hidden'); hidden = false; }
  }
  function hide() {
    if (!hidden) { document.body.classList.add('cursor-hidden'); hidden = true; }
  }

  window.addEventListener('mousemove', e => {
    mx = e.clientX;
    my = e.clientY;
    show();
  }, { passive: true });

  window.addEventListener('mouseenter', show);
  window.addEventListener('mouseleave', hide);

  window.addEventListener('mousedown', () => {
    isDown = true;
    document.body.classList.add('cursor-down');
  });
  window.addEventListener('mouseup', () => {
    isDown = false;
    document.body.classList.remove('cursor-down');
  });

  // Link / interactive hover state
  document.addEventListener('mouseover', e => {
    if (e.target.closest('a, button, [role="button"], .now-playing__open, .steam-playing__open')) {
      isLink = true;
      document.body.classList.add('cursor-link');
    }
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest('a, button, [role="button"], .now-playing__open, .steam-playing__open')) {
      isLink = false;
      document.body.classList.remove('cursor-link');
    }
  });

  // Brief hide while scrolling
  let scrollTimer;
  window.addEventListener('scroll', () => {
    hide();
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(show, 150);
  }, { passive: true });
}

/* ── Copy Discord username ── */

function initCopyDiscord() {
  const btn = document.getElementById('copyDiscord');
  if (!btn || !navigator.clipboard) return;
  const feedback = btn.querySelector('.copy-discord__feedback');
  const value = btn.getAttribute('data-copy') || 'streetle';
  let timer;
  btn.addEventListener('click', () => {
    navigator.clipboard.writeText(value).then(() => {
      btn.classList.add('copied');
      if (feedback) feedback.textContent = 'Copied Discord username';
      clearTimeout(timer);
      timer = setTimeout(() => {
        btn.classList.remove('copied');
        if (feedback) feedback.textContent = '';
      }, 1800);
    });
  });
}

/* ── UK Time ── */

function initUkTime() {
  const el = document.getElementById('ukTime');
  if (!el) return;
  const tz = 'Europe/London';
  const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
  let last = '';
  function tick() {
    const now = fmt.format(new Date());
    if (now !== last) {
      el.textContent = `It is currently ${now} for me`;
      last = now;
    }
    const ms = Date.now();
    const delay = 60000 - (ms % 60000) + 50;
    setTimeout(tick, delay);
  }
  tick();
}

/* ── Micro Bio (random quote) ── */

function initMicroBio() {
  const el = document.getElementById('microBio');
  if (!el) return;
  const textEl = el.querySelector('.micro-bio__text');
  fetch('data/quotes.json', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : [])
    .then(list => {
      if (!Array.isArray(list) || list.length === 0) return;
      const line = list[Math.floor(Math.random() * list.length)];
      if (textEl) textEl.textContent = line; else el.textContent = `fun fact: ${line}`;
    })
    .catch(() => { });
}

/* ── Hamburger Menu ── */

function initMenu() {
  const btn = document.getElementById('menuToggle');
  const menu = document.getElementById('siteMenu');
  if (!btn || !menu) return;

  const position = () => {
    const r = btn.getBoundingClientRect();
    const top = Math.round(r.bottom + 8);
    const right = Math.round(Math.max(16, window.innerWidth - r.right));
    menu.style.top = top + 'px';
    menu.style.right = right + 'px';
  };

  const open = () => {
    btn.setAttribute('aria-expanded', 'true');
    position();
    menu.classList.add('open');
    menu.removeAttribute('aria-hidden');
  };

  const close = () => {
    btn.setAttribute('aria-expanded', 'false');
    menu.classList.remove('open');
    menu.setAttribute('aria-hidden', 'true');
  };

  btn.addEventListener('click', () => {
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    expanded ? close() : open();
  });

  window.addEventListener('resize', () => {
    if (menu.classList.contains('open')) position();
  }, { passive: true });

  document.addEventListener('click', (e) => {
    if (!menu.classList.contains('open')) return;
    if (e.target === btn || btn.contains(e.target)) return;
    if (e.target === menu || menu.contains(e.target)) return;
    close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}
