/* Pitch Sites public viewer: intro, bar, sandboxed site frame, booking, sign-up, before/after and tracking. */
(function () {
  const slug = document.body.dataset.slug;
  const root = document.getElementById('pv-root');
  const API = '/api/pitch-public';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
  const ICON = {
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
    split: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></svg>',
    arrows: '<svg viewBox="0 0 24 24"><path d="M9 6l-6 6 6 6M15 6l6 6-6 6"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  };

  let visitor;
  try { visitor = localStorage.getItem('pv_vid') || rid(); localStorage.setItem('pv_vid', visitor); } catch { visitor = rid(); }
  const visit = rid();
  let data = null;
  let page = 'home';
  let frame = null;
  let veil = null;
  let readyResolve = null;

  async function getJson(url, opts) {
    const r = await fetch(url, opts);
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.success === false) { const e = new Error(d.error || `Request failed (${r.status})`); e.status = r.status; throw e; }
    return d;
  }
  const post = (body) => getJson(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, ...body }) });
  function track(kind, extra = {}) {
    if (!data || data.staff) return;
    const body = JSON.stringify({ slug, action: 'track', visitor, visit, kind, page, ...extra });
    if (kind === 'heartbeat' && navigator.sendBeacon && extra.beacon) { navigator.sendBeacon(API, new Blob([body], { type: 'application/json' })); return; }
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }

  function setTheme(d) {
    const p = d.brand?.palette;
    const c = d.brand?.colors || [];
    const s = document.documentElement.style;
    if (p?.primary || c[0]) s.setProperty('--pv-p', p?.primary || c[0]);
    if (p?.accent || c[1]) s.setProperty('--pv-a', p?.accent || c[1] || p?.primary);
    if (p?.dark) s.setProperty('--pv-d', p.dark);
  }

  function avatar(rep) {
    const a = rep?.avatar || '';
    if (a.startsWith('data:image') || /^https:\/\//.test(a)) return `<span class="pv-av"><img src="${esc(a)}" alt="" /></span>`;
    if (a && a.length <= 4) return `<span class="pv-av" style="font-size:20px">${esc(a)}</span>`;
    const ini = String(rep?.name || 'i3').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    return `<span class="pv-av"${rep?.avatarColor ? ` style="background:${esc(rep.avatarColor)}"` : ''}>${esc(ini)}</span>`;
  }

  const fmtDate = (iso, opts) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', ...opts });

  // ── Screens ────────────────────────────────────────────────────────────────
  function message({ title, text, actions = '' }) {
    root.innerHTML = `<div class="pv-msg"><div class="box">${data?.rep ? avatar(data.rep) : ''}<h1>${title}</h1><p>${text}</p>${actions}</div></div>`;
  }

  function contactActions() {
    const r = data?.rep || {};
    return [
      r.phone ? `<a class="pv-btn pv-main" href="tel:${esc(r.phone.replace(/\s+/g, ''))}">Call ${esc(r.firstName || 'us')}</a>` : '',
      r.email ? `<a class="pv-btn pv-ghost" href="mailto:${esc(r.email)}?subject=${encodeURIComponent(`Our website preview (${data.client})`)}">Email ${esc(r.firstName || 'us')}</a>` : '',
    ].join(' ');
  }

  function intro() {
    let skip = false;
    try { skip = sessionStorage.getItem(`pv_intro_${slug}`) === '1'; sessionStorage.setItem(`pv_intro_${slug}`, '1'); } catch { /* ignore */ }
    if (skip || matchMedia('(prefers-reduced-motion: reduce)').matches) return { done: Promise.resolve(), progress() {} };
    const words = (t, d0, cls = '') => t.split(' ').map((w, i) => `<span class="w"><span class="${cls}" style="animation-delay:${(d0 + i * 0.08).toFixed(2)}s">${esc(w)}</span></span>`).join(' ');
    const el = document.createElement('div');
    el.className = 'pv-intro';
    el.innerHTML = `<div class="pv-blob b1"></div><div class="pv-blob b2"></div><div class="pv-blob b3"></div><div class="pv-grain"></div>
      <div class="pv-intro-c">${data.brand?.logo?.url ? `<img class="pv-intro-logo" src="${esc(data.brand.logo.url)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()" />` : ''}
      <h1>${words(`${data.client},`, 0.35)}<br>${words('meet your new website.', 0.6, 'grad')}</h1>
      <p>Designed for you by ${esc(data.rep?.firstName || 'us')} at i3MEDIA</p><div class="pv-load"><i></i></div></div>
      <button type="button" class="pv-skip">Skip intro</button>`;
    document.body.appendChild(el);
    const bar = el.querySelector('.pv-load i');
    const started = Date.now();
    let finish;
    const done = new Promise((r) => { finish = r; });
    const close = () => { el.classList.add('out'); setTimeout(() => { el.remove(); finish(); }, 1100); };
    el.querySelector('.pv-skip').addEventListener('click', close);
    return {
      done,
      progress(p) { bar.style.width = `${Math.round(p * 100)}%`; if (p >= 1) setTimeout(close, Math.max(250, 2700 - (Date.now() - started))); },
    };
  }

  function bar() {
    const d = data;
    const reserved = d.expiresAt ? `<span class="pv-chip" title="This preview link expires then">⏳ Reserved for you until ${esc(fmtDate(d.expiresAt, { weekday: 'short', day: 'numeric', month: 'short' }))}</span>` : '';
    const tabs = d.pages.length > 1 ? `<nav class="pv-tabs" aria-label="Pages"><span class="pv-ink"></span>${d.pages.map((p) => `<button type="button" data-page="${p.key}" class="${p.key === page ? 'on' : ''}">${esc(p.title)}</button>`).join('')}</nav>` : '';
    return `<header class="pv-bar">
      <div class="pv-who">${avatar(d.rep)}<div class="pv-who-t"><b>Prepared for ${esc(d.client)}</b><span>by ${esc(d.rep?.name || 'i3MEDIA')} · i3MEDIA</span></div></div>
      ${tabs}
      <div class="pv-actions">${reserved}${d.hasBefore || d.gaps?.length ? `<button type="button" class="pv-btn pv-ghost" data-act="ba">${ICON.split}<span class="pv-lbl">Before &amp; after</span></button>` : ''}
        <button type="button" class="pv-btn pv-main" data-act="book">${ICON.cal}<span class="pv-lbl">Book a call</span></button></div>
    </header>`;
  }

  function moveInk() {
    const tabs = root.querySelector('.pv-tabs');
    const on = tabs?.querySelector('button.on');
    const ink = tabs?.querySelector('.pv-ink');
    if (!on || !ink) return;
    ink.style.left = `${on.offsetLeft}px`;
    ink.style.width = `${on.offsetWidth}px`;
  }

  async function loadPage(next, { first = false } = {}) {
    page = next;
    root.querySelectorAll('.pv-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.page === page));
    moveInk();
    veil.classList.remove('off');
    frame.classList.add('pv-hidden');
    const ready = new Promise((r) => { readyResolve = r; });
    try {
      const d = await getJson(`${API}?slug=${encodeURIComponent(slug)}&view=frame&page=${page}`);
      frame.srcdoc = d.html;
      data.unlocked = d.unlocked;
    } catch (e) {
      if (e.status === 410) { data.expired = true; return expired(); }
      veil.innerHTML = `<p style="color:#64748b">Couldn't load this page. <button class="pv-btn pv-ghost" style="color:#0f172a" onclick="location.reload()">Retry</button></p>`;
      return;
    }
    await Promise.race([ready, new Promise((r) => setTimeout(r, 9000))]);
    frame.classList.remove('pv-hidden');
    veil.classList.add('off');
    if (!first) track('nav', { detail: page });
  }

  function onFrameMessage(e) {
    if (!frame || e.source !== frame.contentWindow) return;
    const m = e.data || {};
    if (!m.pitch) return;
    if (m.type === 'ready') { readyResolve?.(); return; }
    if (m.type === 'depth') { track('depth', { value: m.value }); return; }
    if (m.type === 'gate') { track('gate'); root.querySelector('[data-act="book"]')?.classList.add('pv-pulse'); return; }
    if (m.type === 'cta') { track('cta', { detail: `${m.action}:${m.source || ''}` }); return m.action === 'signup' ? openSignup() : openBooking(); }
    if (m.type === 'nav' && (m.to === 'home' || m.to === 'secondary') && data.pages.some((p) => p.key === m.to) && m.to !== page) loadPage(m.to);
  }

  async function app() {
    root.innerHTML = `<div class="pv-app">${bar()}<main class="pv-stage"><iframe class="pv-frame pv-hidden" title="${esc(data.client)} website preview" sandbox="allow-scripts allow-popups"></iframe><div class="pv-veil"><div class="pv-spin"></div></div></main></div>${data.staff ? '<div class="pv-staff">Staff view: visits aren\u2019t tracked</div>' : ''}`;
    frame = root.querySelector('.pv-frame');
    veil = root.querySelector('.pv-veil');
    root.querySelector('.pv-bar').addEventListener('click', (e) => {
      const t = e.target.closest('[data-page],[data-act]');
      if (!t) return;
      if (t.dataset.page && t.dataset.page !== page) loadPage(t.dataset.page);
      if (t.dataset.act === 'book') { track('cta', { detail: 'book:bar' }); openBooking(); }
      if (t.dataset.act === 'ba') { track('before_after'); openBeforeAfter(); }
    });
    window.addEventListener('resize', moveInk);
    requestAnimationFrame(moveInk);
    const show = intro();
    show.progress(0.25);
    const loading = loadPage('home', { first: true });
    setTimeout(() => show.progress(0.6), 500);
    await loading;
    show.progress(1);
    track('open', { device: innerWidth < 640 ? 'mobile' : innerWidth < 1024 ? 'tablet' : 'desktop', referrer: document.referrer ? new URL(document.referrer).hostname : '' });
    let last = Date.now();
    const beat = (beacon) => { const s = Math.round((Date.now() - last) / 1000); last = Date.now(); if (s > 0) track('heartbeat', { value: Math.min(30, s), beacon }); };
    setInterval(() => { if (!document.hidden) beat(false); else last = Date.now(); }, 15000);
    addEventListener('pagehide', () => beat(true));
  }

  function expired() {
    message({
      title: 'This preview has expired',
      text: `The website preview made for ${esc(data.client)} was reserved for a limited time. Get in touch with ${esc(data.rep?.firstName || 'us')} and we'll reopen it for you.`,
      actions: contactActions(),
    });
  }

  // ── Modals ─────────────────────────────────────────────────────────────────
  function modal(html, { wide = false } = {}) {
    const el = document.createElement('div');
    el.className = 'pv-modal';
    el.innerHTML = `<div class="pv-card${wide ? ' wide' : ''}" role="dialog" aria-modal="true"><button type="button" class="pv-x" aria-label="Close">×</button>${html}</div>`;
    const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('.pv-x')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(el);
    setTimeout(() => el.querySelector('input,button.pv-day,button.pv-slot')?.focus(), 60);
    return { el, card: el.querySelector('.pv-card'), close };
  }

  const fields = (extra = '') => `
    <input class="pv-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" />
    <div class="row"><label>Your name<input name="name" required autocomplete="name" /></label><label>Business<input name="company" value="${esc(data.client)}" autocomplete="organization" /></label></div>
    <div class="row"><label>Email<input name="email" type="email" required autocomplete="email" /></label><label>Phone${extra}<input name="phone" type="tel" autocomplete="tel" /></label></div>`;

  function success(card, { title, text, cta = 'See your full website' }) {
    card.innerHTML = `<button type="button" class="pv-x" aria-label="Close">×</button><div class="pv-done"><div class="pv-check">${ICON.check}</div><h2 style="margin:0 0 8px">${title}</h2><p class="pv-sub" style="margin:0 auto 18px;max-width:420px">${text}</p>
      <button type="button" class="pv-btn pv-main pv-submit" data-full>${esc(cta)}</button></div>`;
    confetti();
    card.querySelector('[data-full]').addEventListener('click', () => { card.closest('.pv-modal').remove(); loadPage(page); });
  }

  async function openBooking() {
    if (data.expired) return expired();
    const m = modal(`<div class="pv-rep">${avatar(data.rep)}<div><b>${esc(data.rep?.name || 'i3MEDIA')}</b><span>${esc(data.rep?.title || '')}</span></div></div>
      <h2>Book a 15-minute walkthrough</h2><p class="pv-sub">${esc(data.rep?.firstName || 'We')} will walk you through your new website and answer any questions. No obligation.</p>
      <div class="pv-days" aria-label="Day"><div class="pv-spin" style="margin:14px auto"></div></div><div class="pv-slots" aria-label="Time"></div>
      <form class="pv-form" hidden>${fields()}<label>Anything you'd like us to focus on? (optional)<textarea name="notes"></textarea></label>
      <div class="pv-err" role="alert"></div><button type="submit" class="pv-btn pv-main pv-submit">Confirm booking</button><div class="pv-fine">Times are UK time.</div></form>`);
    const { card } = m;
    let days = [];
    try { days = (await getJson(`${API}?slug=${encodeURIComponent(slug)}&view=slots`)).days || []; } catch { days = []; }
    const dayEl = card.querySelector('.pv-days');
    const slotEl = card.querySelector('.pv-slots');
    const form = card.querySelector('form');
    let slot = null;
    if (!days.length) {
      dayEl.innerHTML = `<p class="pv-sub" style="margin:6px 0">No online slots right now. ${data.rep?.phone ? `Call ${esc(data.rep.firstName)} on <a href="tel:${esc(data.rep.phone)}">${esc(data.rep.phone)}</a>` : 'Leave your details and we\u2019ll call you'}.</p>`;
      return;
    }
    const pickDay = (i) => {
      dayEl.querySelectorAll('.pv-day').forEach((b, n) => b.classList.toggle('on', n === i));
      slot = null;
      form.hidden = true;
      slotEl.innerHTML = days[i].slots.map((s) => `<button type="button" class="pv-slot" data-slot="${s}">${esc(fmtDate(s, { hour: '2-digit', minute: '2-digit' }))}</button>`).join('');
    };
    dayEl.innerHTML = days.map((d, i) => `<button type="button" class="pv-day" data-i="${i}"><b>${esc(fmtDate(`${d.date}T12:00:00Z`, { weekday: 'short' }))}</b><span>${esc(fmtDate(`${d.date}T12:00:00Z`, { day: 'numeric' }))}</span><b>${esc(fmtDate(`${d.date}T12:00:00Z`, { month: 'short' }))}</b></button>`).join('');
    dayEl.addEventListener('click', (e) => { const b = e.target.closest('.pv-day'); if (b) pickDay(Number(b.dataset.i)); });
    slotEl.addEventListener('click', (e) => {
      const b = e.target.closest('.pv-slot');
      if (!b) return;
      slotEl.querySelectorAll('.pv-slot').forEach((x) => x.classList.toggle('on', x === b));
      slot = b.dataset.slot;
      form.hidden = false;
      form.querySelector('input[name=name]').focus();
    });
    pickDay(0);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form).entries());
      const err = form.querySelector('.pv-err');
      const btn = form.querySelector('[type=submit]');
      err.textContent = '';
      btn.disabled = true;
      btn.textContent = 'Booking…';
      try {
        const r = await post({ action: 'book', slot, visitor, ...f });
        success(card, { title: 'You\u2019re booked in!', text: `${esc(data.rep?.firstName || 'We')} will see you on ${esc(fmtDate(r.scheduledFor, { weekday: 'long', day: 'numeric', month: 'long' }))} at ${esc(fmtDate(r.scheduledFor, { hour: '2-digit', minute: '2-digit' }))}. As a thank you, we've unlocked your full website preview.` });
      } catch (ex) {
        err.textContent = ex.message;
        btn.disabled = false;
        btn.textContent = 'Confirm booking';
      }
    });
  }

  function openSignup() {
    if (data.expired) return expired();
    const price = data.gate?.price || '£149';
    const m = modal(`<h2>Start your new website</h2><div class="pv-price"><b>${esc(price)}</b><span>/ month</span></div>
      <ul class="pv-ticks"><li>Your new website, built from this design for ${esc(data.client)}</li><li>${esc(data.rep?.firstName || 'We')} will call you to confirm everything before you pay a penny</li><li>No payment is taken today</li></ul>
      <form class="pv-form">${fields(' (so we can call you)')}<label>Anything we should know? (optional)<textarea name="notes" placeholder="e.g. we'd love it live before spring"></textarea></label>
      <div class="pv-err" role="alert"></div><button type="submit" class="pv-btn pv-main pv-submit">Yes, I want this website</button></form>`);
    const form = m.card.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form).entries());
      const err = form.querySelector('.pv-err');
      const btn = form.querySelector('[type=submit]');
      err.textContent = '';
      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        await post({ action: 'signup', visitor, ...f });
        success(m.card, { title: 'Brilliant, you\u2019re on your way!', text: `${esc(data.rep?.firstName || 'We')} will call you shortly to confirm the details. In the meantime, enjoy your full website preview.` });
      } catch (ex) {
        err.textContent = ex.message;
        btn.disabled = false;
        btn.textContent = 'Yes, I want this website';
      }
    });
  }

  function ring(label, v) {
    if (v == null) return '';
    const c = v >= 90 ? '#16a34a' : v >= 50 ? '#d97706' : '#dc2626';
    const r = 18;
    const len = 2 * Math.PI * r;
    return `<span class="pv-ring"><svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="${r}" stroke="#e2e8f0" stroke-width="5" fill="none"/><circle cx="22" cy="22" r="${r}" stroke="${c}" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="${(len * v) / 100} ${len}"/></svg><span><span class="t" style="color:${c}">${v}</span><br>${esc(label)}</span></span>`;
  }

  async function openBeforeAfter() {
    const gaps = (data.gaps || []).map((g, i) => `<div class="pv-gap"><i>${i + 1}</i><b>${esc(g.title)}</b><p>${esc(g.detail)}</p>${g.evidence ? `<small>${esc(g.evidence)}</small>` : ''}</div>`).join('');
    const s = data.scores;
    const scores = s ? `<div class="pv-scores"><b style="font-size:13px;color:#64748b">Your current site on Google PageSpeed (mobile):</b>${ring('Speed', s.performance)}${ring('SEO', s.seo)}${ring('Accessibility', s.accessibility)}</div>` : '';
    const m = modal(`<h2>Your website: before &amp; after</h2><p class="pv-sub">Drag the slider to compare your current homepage with the new design.</p>
      ${data.hasBefore ? `<div class="pv-ba"><iframe class="pv-ba-after" sandbox="allow-scripts" tabindex="-1" title="New design"></iframe><div class="pv-ba-before"><img alt="Your current website" src="${API}?slug=${encodeURIComponent(slug)}&view=before" /></div>
        <span class="pv-ba-tag l">Today</span><span class="pv-ba-tag r">New design</span><div class="pv-ba-handle" role="slider" aria-label="Compare" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" tabindex="0"><span class="pv-ba-knob">${ICON.arrows}</span></div></div>` : ''}
      ${gaps ? `<h3 style="margin:22px 0 0;font-size:17px">3 things holding your current website back</h3><div class="pv-gaps">${gaps}</div>` : ''}${scores}
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:20px"><button type="button" class="pv-btn pv-main" data-go="book">${ICON.cal} Talk it through with ${esc(data.rep?.firstName || 'us')}</button></div>`, { wide: true });
    m.card.querySelector('[data-go="book"]').addEventListener('click', () => { m.close(); openBooking(); });
    const ba = m.card.querySelector('.pv-ba');
    if (!ba) return;
    const after = ba.querySelector('.pv-ba-after');
    const before = ba.querySelector('.pv-ba-before');
    const handle = ba.querySelector('.pv-ba-handle');
    const fit = () => { after.style.transform = `scale(${ba.clientWidth / 1366})`; };
    fit();
    addEventListener('resize', fit);
    getJson(`${API}?slug=${encodeURIComponent(slug)}&view=frame&page=home`).then((d) => { after.srcdoc = d.html; }).catch(() => {});
    const set = (pct) => {
      const p = Math.max(0, Math.min(100, pct));
      before.style.clipPath = `inset(0 ${100 - p}% 0 0)`;
      handle.style.left = `${p}%`;
      handle.setAttribute('aria-valuenow', String(Math.round(p)));
    };
    let dragging = false;
    const at = (e) => { const r = ba.getBoundingClientRect(); set(((e.clientX - r.left) / r.width) * 100); };
    ba.addEventListener('pointerdown', (e) => { dragging = true; ba.setPointerCapture(e.pointerId); at(e); });
    ba.addEventListener('pointermove', (e) => { if (dragging) at(e); });
    ba.addEventListener('pointerup', () => { dragging = false; });
    handle.addEventListener('keydown', (e) => { const now = Number(handle.getAttribute('aria-valuenow')); if (e.key === 'ArrowLeft') set(now - 5); if (e.key === 'ArrowRight') set(now + 5); });
    // A little "wipe" so people notice it's interactive.
    let t = 0;
    const demo = setInterval(() => { t += 1; set(50 + Math.sin(t / 6) * 22); if (t > 38) { clearInterval(demo); set(50); } }, 30);
    ba.addEventListener('pointerdown', () => clearInterval(demo), { once: true });
  }

  function confetti() {
    const c = document.createElement('canvas');
    c.className = 'pv-confetti';
    document.body.appendChild(c);
    const ctx = c.getContext('2d');
    const W = (c.width = innerWidth * devicePixelRatio);
    const H = (c.height = innerHeight * devicePixelRatio);
    const cs = getComputedStyle(document.documentElement);
    const colors = [cs.getPropertyValue('--pv-p').trim(), cs.getPropertyValue('--pv-a').trim(), '#22c55e', '#facc15', '#ffffff', '#38bdf8'];
    const parts = Array.from({ length: 180 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.45, vx: (Math.random() - 0.5) * 26 * devicePixelRatio, vy: (-Math.random() * 26 - 8) * devicePixelRatio,
      s: (Math.random() * 7 + 5) * devicePixelRatio, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: colors[Math.floor(Math.random() * colors.length)],
    }));
    let frameN = 0;
    (function tick() {
      ctx.clearRect(0, 0, W, H);
      parts.forEach((p) => { p.vy += 0.7 * devicePixelRatio; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); });
      frameN += 1;
      if (frameN < 200) requestAnimationFrame(tick); else c.remove();
    })();
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  async function boot() {
    addEventListener('message', onFrameMessage);
    if (document.body.dataset.missing) {
      root.innerHTML = '<div class="pv-msg"><div class="box"><h1>Preview not found</h1><p>This link doesn\u2019t point to a website preview. Check the link you were sent.</p></div></div>';
      return;
    }
    try {
      data = await getJson(`${API}?slug=${encodeURIComponent(slug)}&view=data`);
    } catch (e) {
      root.innerHTML = `<div class="pv-msg"><div class="box"><h1>Something went wrong</h1><p>${esc(e.message)}</p><button class="pv-btn pv-main" onclick="location.reload()">Try again</button></div></div>`;
      return;
    }
    setTheme(data);
    document.title = `${data.client}: your new website preview`;
    if (data.expired && !data.staff) return expired();
    if (!data.ready) {
      return message({ title: 'Your preview is nearly ready', text: `We're putting the finishing touches to ${esc(data.client)}'s new website. Check back in a few minutes.`, actions: contactActions() });
    }
    app();
  }
  boot();
})();
