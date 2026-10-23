/* Pitch Sites studio: list, new, brand board, live build, preview + share/tweak/activity/audit/versions. */
(function () {
  const $ = (id) => document.getElementById(id);
  const body = () => $('psBody');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u || ''; } };
  const ago = (iso) => {
    if (!iso) return '';
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };
  const dateLong = (iso) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const viewingNow = (s) => s.lastViewedAt && Date.now() - new Date(s.lastViewedAt).getTime() < 50000;

  const S = { sites: [], canSeeAll: false, isAdmin: false, reps: [], filterRep: '', q: '', d: null, page: 'home', device: 'desktop', gated: false, select: false, part: '', tab: 'share', poll: null, listPoll: null, busy: false, lastBuilt: '', stallSince: 0 };

  async function api(action, params = {}) {
    const qs = new URLSearchParams({ action, ...params });
    const r = await fetch(`/api/pitch-sites?${qs}`, { credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.success) throw new Error(d.error || `Request failed (${r.status})`);
    return d;
  }
  async function post(action, payload = {}) {
    const r = await fetch('/api/pitch-sites', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.success) throw new Error(d.error || `Request failed (${r.status})`);
    return d;
  }
  function toast(text, bad = false) {
    const t = document.createElement('div');
    t.textContent = text;
    t.style.cssText = `position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2000;background:${bad ? '#991b1b' : '#111827'};color:#fff;padding:10px 16px;border-radius:12px;font-size:13px;font-weight:600;box-shadow:0 12px 30px rgba(0,0,0,.25)`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }
  function modal(html, { wide = false } = {}) {
    const el = document.createElement('div');
    el.className = `overlay ps-modal${wide ? ' wide' : ''}`;
    el.innerHTML = `<div class="ps-card" role="dialog" aria-modal="true">${html}</div>`;
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) el.remove(); });
    document.body.appendChild(el);
    setTimeout(() => el.querySelector('input,textarea')?.focus(), 50);
    return el;
  }
  const svgData = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const logoSrc = (logo) => (logo?.url ? logo.url : logo?.svg ? svgData(logo.svg) : '');
  const thumbBg = (colors) => { const c = colors?.length ? colors : ['#6366f1', '#ec4899']; return `linear-gradient(135deg, ${c[0]} 0%, ${c[1] || c[0]} 60%, ${c[2] || c[0]} 100%)`; };

  function statusPill(s) {
    if (s.status === 'building') return `<span class="ps-pill blue"><span class="ps-spin" style="width:10px;height:10px"></span> Building${s.progress?.total ? ` ${Math.round((s.progress.done / s.progress.total) * 100)}%` : ''}</span>`;
    if (s.status === 'failed') return '<span class="ps-pill bad">Needs attention</span>';
    if (s.status === 'crawled') return '<span class="ps-pill warn">Ready to build</span>';
    if (s.expiresAt && new Date(s.expiresAt) < new Date()) return '<span class="ps-pill">Expired</span>';
    if (s.signups) return '<span class="ps-pill good">🚀 Sign-up request</span>';
    if (s.booked) return '<span class="ps-pill good">📅 Call booked</span>';
    if (s.sharedAt) return `<span class="ps-pill good">Shared · ${s.viewCount || 0} view${s.viewCount === 1 ? '' : 's'}</span>`;
    return '<span class="ps-pill blue">Ready to share</span>';
  }

  // ── Routing ────────────────────────────────────────────────────────────────
  function go(id) {
    const url = id ? `/pitch-sites?id=${id}` : '/pitch-sites';
    history.pushState({}, '', url);
    route();
  }
  function route() {
    clearInterval(S.poll);
    clearInterval(S.listPoll);
    const p = new URLSearchParams(location.search);
    const id = p.get('id');
    if (id) return openDetail(id);
    showList();
    if (p.get('new') === '1') newModal({ url: p.get('url') || '', leadId: p.get('lead') || '', clientName: p.get('name') || '' });
  }

  // ── List ───────────────────────────────────────────────────────────────────
  async function showList() {
    try {
      const d = await api('list');
      S.sites = d.sites; S.canSeeAll = d.canSeeAll; S.isAdmin = d.isAdmin;
      $('psSettings').hidden = !S.isAdmin;
    } catch (e) { body().innerHTML = `<p class="ps-err">${esc(e.message)}</p>`; return; }
    renderList();
    S.listPoll = setInterval(async () => {
      if (document.hidden || new URLSearchParams(location.search).get('id')) return;
      try { S.sites = (await api('list')).sites; renderList(); } catch { /* keep last */ }
    }, 20000);
  }

  function renderList() {
    const reps = [...new Map(S.sites.filter((s) => s.ownerName).map((s) => [s.ownerId, s.ownerName])).entries()];
    const q = S.q.toLowerCase();
    const list = S.sites.filter((s) => (!S.filterRep || s.ownerId === S.filterRep) && (!q || `${s.clientName} ${s.sourceUrl}`.toLowerCase().includes(q)));
    const hero = `<section class="ps-hero"><h2>Make their website ten times better, in minutes.</h2>
      <p>Paste a prospect's website. We read every page, pull their logo, colours and copy, research the best sites in their sector, then design a brand new homepage and inner page. Share the link and watch them open it.</p>
      <form id="psHeroForm"><input name="url" placeholder="e.g. smithsplumbing.co.uk" autocomplete="off" /><button type="submit">✨ Build their pitch site</button></form>
      <div class="ps-steps"><span><b>1.</b> We read their site</span><span><b>2.</b> AI researches their sector</span><span><b>3.</b> A redesign is built live</span><span><b>4.</b> Share, track and book the call</span></div></section>`;
    const cards = list.map((s) => {
      const logo = logoSrc(s.logo);
      const pct = s.progress?.total ? Math.round((s.progress.done / s.progress.total) * 100) : 0;
      return `<article class="ps-card ps-site" data-id="${s.id}">
        <div class="ps-thumb" style="background:${thumbBg(s.colors)}">${statusPill(s)}${viewingNow(s) ? '<span class="ps-pill live viewing">Viewing now</span>' : ''}
          ${logo ? `<img class="logo" src="${esc(logo)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()" />` : `<span class="initial">${esc((s.clientName || '?')[0])}</span>`}</div>
        <div class="ps-site-b"><b>${esc(s.clientName)}</b><span>${esc(host(s.sourceUrl))}${S.canSeeAll && s.ownerName ? ` · ${esc(s.ownerName)}` : ''}</span>
          ${s.status === 'building' ? `<div class="ps-mini-bar"><i style="width:${pct}%"></i></div>` : ''}
          <div class="ps-site-stats"><span>👀 ${s.viewCount || 0} <em>views</em></span>${s.lastViewedAt ? `<span><em>last</em> ${esc(ago(s.lastViewedAt))}</span>` : ''}${s.booked ? `<span>📅 ${s.booked}</span>` : ''}${s.signups ? `<span>🚀 ${s.signups}</span>` : ''}<span><em>made</em> ${esc(ago(s.createdAt))}</span></div></div>
      </article>`;
    }).join('');
    body().innerHTML = `${hero}
      ${S.sites.length ? `<div class="ps-tools"><input id="psQ" placeholder="Search clients" value="${esc(S.q)}" />${S.canSeeAll && reps.length > 1 ? `<select id="psRep"><option value="">All reps</option>${reps.map(([id, n]) => `<option value="${esc(id)}"${id === S.filterRep ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>` : ''}<span class="ps-note">${list.length} pitch site${list.length === 1 ? '' : 's'}</span></div>
      <div class="ps-grid">${cards || '<p class="ps-note">No matches.</p>'}</div>` : '<p class="ps-note" style="margin-top:16px">No pitch sites yet. Paste a website above to make your first one.</p>'}`;
    $('psHeroForm').addEventListener('submit', (e) => { e.preventDefault(); newModal({ url: e.target.url.value.trim() }); });
    $('psQ')?.addEventListener('input', (e) => { S.q = e.target.value; const pos = e.target.selectionStart; renderList(); const i = $('psQ'); i.focus(); i.setSelectionRange(pos, pos); });
    $('psRep')?.addEventListener('change', (e) => { S.filterRep = e.target.value; renderList(); });
    body().querySelectorAll('.ps-site').forEach((c) => c.addEventListener('click', () => go(c.dataset.id)));
  }

  // ── New ────────────────────────────────────────────────────────────────────
  async function newModal({ url = '', leadId = '', clientName = '' } = {}) {
    if (S.canSeeAll && !S.reps.length) { try { S.reps = (await api('reps')).reps; } catch { S.reps = []; } }
    const el = modal(`<h3 class="ps-h">✨ New pitch site</h3>
      <form id="psNewForm" style="display:grid;gap:12px">
        <label class="ps-field">Their website<input name="url" required value="${esc(url)}" placeholder="e.g. smithsplumbing.co.uk" autocomplete="off" /></label>
        <label class="ps-field">Business name (optional, we'll find it)<input name="clientName" value="${esc(clientName)}" /></label>
        ${S.canSeeAll ? `<label class="ps-field">Prepared by<select name="ownerId"><option value="">Me</option>${S.reps.map((r) => `<option value="${esc(r.ownerId)}">${esc(r.name)}</option>`).join('')}</select></label>` : ''}
        <label class="ps-field">Notes for the AI (optional)<textarea name="notes" placeholder="e.g. They want more loft conversion enquiries. Owner is called Dave. Very traditional brand."></textarea></label>
        <input type="hidden" name="leadId" value="${esc(leadId)}" />
        <div class="ps-err" id="psNewErr"></div>
        <div class="ps-row" style="justify-content:flex-end"><button type="button" class="ghost" data-close>Cancel</button><button type="submit">Read their website</button></div>
      </form>`);
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target).entries());
      const card = el.querySelector('.ps-card');
      card.innerHTML = `<div class="ps-crawl"><span class="ps-spin"></span><p><b>Reading ${esc(host(f.url.startsWith('http') ? f.url : `https://${f.url}`))}…</b></p><p class="ps-note" id="psCrawlMsg">Finding their logo, colours, pages and photos</p></div>`;
      const msgs = ['Finding their logo, colours, pages and photos', 'Reading their services and contact details', 'Looking for reviews and testimonials', 'Collecting their best photos'];
      let i = 0;
      const t = setInterval(() => { i += 1; const m = $('psCrawlMsg'); if (m) m.textContent = msgs[i % msgs.length]; }, 2500);
      try {
        const r = await post('create', f);
        clearInterval(t);
        el.remove();
        go(r.id);
      } catch (ex) {
        clearInterval(t);
        el.remove();
        toast(ex.message, true);
        newModal({ url: f.url, leadId: f.leadId, clientName: f.clientName });
      }
    });
  }

  // ── Detail ─────────────────────────────────────────────────────────────────
  async function load(id) {
    S.d = await api('get', { id });
    return S.d;
  }

  async function openDetail(id) {
    body().innerHTML = '<p class="ps-note"><span class="ps-spin"></span> Loading…</p>';
    try { await load(id); } catch (e) { body().innerHTML = `<p class="ps-err">${esc(e.message)}</p><button class="ghost" id="psBack">Back</button>`; $('psBack').onclick = () => go(null); return; }
    renderDetail();
  }

  function header() {
    const s = S.d.site;
    return `<div class="ps-top"><button type="button" class="ghost ps-back" id="psBack">← All pitch sites</button>
      <h2>${esc(s.clientName)}</h2><a class="host" href="${esc(s.sourceUrl)}" target="_blank" rel="noopener">${esc(host(s.sourceUrl))} ↗</a>${statusPill({ ...s, progress: S.d.progress })}
      ${viewingNow(s) ? '<span class="ps-pill live">Viewing now</span>' : ''}
      <span class="ps-grow"></span>
      ${s.hasDesign && s.status !== 'building' ? `<a class="btn ghost" href="${esc(S.d.publicUrl)}" target="_blank" rel="noopener">Open client view ↗</a>` : ''}
      <button type="button" class="ghost" id="psArchive" title="Remove this pitch site">Remove</button></div>`;
  }

  function renderDetail() {
    const s = S.d.site;
    clearInterval(S.poll);
    if (s.status === 'building') return renderBuild();
    if (!s.hasDesign) return renderBoard();
    return renderWork();
  }

  function bindHeader() {
    $('psBack').onclick = () => go(null);
    $('psArchive').onclick = async () => {
      if (!confirm(`Remove the pitch site for ${S.d.site.clientName}? The share link will stop working.`)) return;
      try { await post('archive', { id: S.d.site.id }); go(null); } catch (e) { toast(e.message, true); }
    };
  }

  // Brand board ───────────────────────────────────────────────────────────────
  function renderBoard() {
    const s = S.d.site;
    const b = s.brand || {};
    const logo = logoSrc(b.logo);
    const cands = (b.logoCandidates || []).map((c, i) => `<button type="button" class="ps-cand${(c.url && c.url === b.logo?.url) || (c.svg && c.svg === b.logo?.svg) ? ' on' : ''}" data-cand="${i}"><img src="${esc(logoSrc(c))}" alt="" referrerpolicy="no-referrer" /></button>`).join('');
    const colors = b.colors || [];
    const excluded = new Set(b.excludedImages || []);
    const checks = b.checks || {};
    const chk = (ok, label) => `<span class="${ok ? '' : 'bad'}">${esc(label)}</span>`;
    const failed = s.status === 'failed';
    body().innerHTML = `${header()}
      ${failed ? `<div class="ps-card" style="padding:14px 16px;border-color:#fecaca;background:#fef2f2;margin-bottom:14px"><b style="color:#991b1b">The build didn't finish.</b> <span class="ps-note">${esc(s.error || '')}</span></div>` : ''}
      <div class="ps-board">
        <div style="display:grid;gap:14px">
          <section class="ps-card"><div class="ps-row"><h3 class="ps-h ps-grow">Their brand</h3><span class="ps-note">Found ${b.pages?.length || 0} pages in ${Math.round((b.stats?.ms || 0) / 100) / 10}s</span></div>
            <label class="ps-field">Business name<input id="bName" value="${esc(b.name || s.clientName)}" /></label>
            <div class="ps-logo-box"><div>${logo ? `<img src="${esc(logo)}" alt="Logo" referrerpolicy="no-referrer" />` : '<span class="ps-note">No logo found</span>'}</div><div>${logo ? `<img src="${esc(logo)}" alt="" referrerpolicy="no-referrer" />` : ''}</div></div>
            ${cands ? `<div class="ps-field">Is this their logo? Pick another if not<div class="ps-cands">${cands}</div></div>` : ''}
            <label class="ps-field">Or paste a logo image URL<input id="bLogo" placeholder="https://…/logo.png" value="" /></label>
            <div class="ps-field">Brand colours (click to change)<div class="ps-swatches" id="bColors">${colors.map((c, i) => `<span class="ps-swatch"><input type="color" value="${esc(c)}" data-ci="${i}" /><button type="button" class="x" data-rm="${i}" aria-label="Remove">×</button>${esc(c)}</span>`).join('')}<button type="button" class="ps-addsw" id="bAdd" title="Add a colour">+</button></div></div>
            ${b.fonts?.length ? `<p class="ps-note">Fonts on their site: <b>${esc(b.fonts.join(', '))}</b></p>` : ''}
            <p class="ps-note">📞 ${esc((b.contact?.phones || []).join(', ') || 'No phone found')} · ✉️ ${esc((b.contact?.emails || []).join(', ') || 'No email found')}${b.testimonials?.length ? ` · ⭐ ${b.testimonials.length} testimonials` : ''}</p>
          </section>
          <section class="ps-card"><h3 class="ps-h">Second page to redesign</h3><p class="ps-note">We always do the homepage. Pick the inner page that matters most (usually services).</p>
            <div class="ps-pages">${(b.pages || []).slice(1).map((p) => `<label><input type="radio" name="bSecond" value="${esc(p.url)}"${p.url === b.secondaryUrl ? ' checked' : ''} /><span><b>${esc(p.navLabel || p.title || p.path)}</b><small>${esc(p.path)}</small></span></label>`).join('') || '<p class="ps-note">Only the homepage was found, so we\u2019ll design a services page from it.</p>'}</div>
          </section>
          <section class="ps-card"><h3 class="ps-h">Their photos</h3><p class="ps-note">Click any photo the AI shouldn't use (stock, blurry, irrelevant).</p>
            <div class="ps-photos" id="bPhotos">${(b.images || []).map((im) => `<div class="ps-photo${excluded.has(im.url) ? ' off' : ''}" data-url="${esc(im.url)}" title="${esc(im.alt || '')}"><img src="${esc(im.url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()" /></div>`).join('') || '<p class="ps-note">No photos found. The AI will use designed artwork instead.</p>'}</div>
          </section>
        </div>
        <div style="display:grid;gap:14px">
          <section class="ps-card"><h3 class="ps-h">Their site today</h3>
            <div id="bAudit">${auditBlock(s)}</div>
            <div class="ps-checks">${chk(checks.https, 'Secure (HTTPS)')}${chk(checks.mobileViewport, 'Mobile friendly tag')}${chk(checks.metaDescription, 'Google description')}${chk(checks.phoneOnHome, 'Phone on homepage')}${chk((checks.testimonialsFound || 0) > 0, 'Shows reviews')}${chk(!checks.copyrightYear || checks.copyrightYear >= new Date().getFullYear() - 1, `Up to date${checks.copyrightYear ? ` (© ${checks.copyrightYear})` : ''}`)}${chk((checks.imagesMissingAlt || 0) <= 3, `Image alt text (${checks.imagesMissingAlt || 0} missing)`)}${chk((checks.loadMs || 0) < 1500, `First response ${checks.loadMs || '?'} ms`)}</div>
          </section>
          <section class="ps-card"><h3 class="ps-h">Notes for the AI</h3>
            <label class="ps-field">Anything it should know or focus on?<textarea id="bNotes" placeholder="e.g. Push their emergency call-out service. They've just won a local award (Best Builder 2025).">${esc(b.notes || '')}</textarea></label>
            ${S.d.lead ? `<p class="ps-note">🔗 Linked to lead <b>${esc(S.d.lead.company_name || S.d.lead.name)}</b>. Views and bookings will show on their timeline.</p>` : '<p class="ps-note">Not linked to a lead yet. You can link one from the Share tab once it\u2019s built.</p>'}
          </section>
        </div>
      </div>
      <div class="ps-build-cta"><p><b style="color:#fff">Happy with the brand?</b> Building takes about 5 minutes. You can close this page; it keeps going.</p><button type="button" id="bBuild">${failed ? 'Try again' : '✨ Build it'}</button></div>`;
    bindHeader();
    const brand = { colors: [...colors], excludedImages: [...excluded] };
    const colorBox = $('bColors');
    colorBox.addEventListener('input', (e) => { const i = e.target.dataset.ci; if (i != null) { brand.colors[i] = e.target.value; e.target.parentNode.lastChild.textContent = e.target.value; } });
    colorBox.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rm]');
      if (rm) { brand.colors.splice(Number(rm.dataset.rm), 1); S.d.site.brand.colors = brand.colors; renderBoard(); }
      if (e.target.id === 'bAdd') { brand.colors.push('#888888'); S.d.site.brand.colors = brand.colors; renderBoard(); }
    });
    body().querySelectorAll('[data-cand]').forEach((c) => c.addEventListener('click', () => { S.d.site.brand.logo = b.logoCandidates[Number(c.dataset.cand)]; brand.logoSvgIndex = Number(c.dataset.cand); post('update-brand', { id: s.id, brand: { logoSvgIndex: brand.logoSvgIndex } }).catch(() => {}); renderBoard(); }));
    $('bPhotos').addEventListener('click', (e) => {
      const p = e.target.closest('.ps-photo');
      if (!p) return;
      p.classList.toggle('off');
      const u = p.dataset.url;
      if (p.classList.contains('off')) brand.excludedImages.push(u); else brand.excludedImages = brand.excludedImages.filter((x) => x !== u);
      S.d.site.brand.excludedImages = brand.excludedImages;
    });
    $('bBuild').onclick = async (e) => {
      const btn = e.target;
      btn.disabled = true;
      btn.textContent = 'Starting…';
      const second = body().querySelector('input[name=bSecond]:checked')?.value;
      const logoUrl = $('bLogo').value.trim();
      try {
        await post('update-brand', { id: s.id, brand: { name: $('bName').value, colors: brand.colors, excludedImages: brand.excludedImages, notes: $('bNotes').value, ...(second ? { secondaryUrl: second } : {}), ...(logoUrl ? { logoUrl } : {}) } });
        await post('build', { id: s.id });
        await load(s.id);
        renderDetail();
      } catch (ex) { toast(ex.message, true); btn.disabled = false; btn.textContent = '✨ Build it'; }
    };
    if (!s.audit) runAuditInBackground();
  }

  function auditBlock(s) {
    const a = s.audit;
    if (!a) return '<p class="ps-note"><span class="ps-spin"></span> Taking a snapshot of their current homepage…</p>';
    const m = a.mobile;
    return `${s.hasBefore ? `<img class="ps-before" src="/api/pitch-public?slug=${encodeURIComponent(s.slug)}&view=before" alt="Their current homepage" />` : '<p class="ps-note">No screenshot available.</p>'}
      ${m ? `<p class="ps-note">Google PageSpeed (mobile): speed <b>${m.performance}</b>, SEO <b>${m.seo}</b>, accessibility <b>${m.accessibility}</b>${m.lcp ? `, main content loads in <b>${esc(m.lcp)}</b>` : ''}</p>` : a.pagespeed === 'no-key' ? '<p class="ps-note">Speed scores are off (an admin can add a free Google PageSpeed key).</p>' : ''}`;
  }

  async function runAuditInBackground() {
    const id = S.d.site.id;
    try {
      const r = await post('audit', { id });
      if (S.d?.site.id !== id) return;
      S.d.site.audit = r.audit;
      S.d.site.hasBefore = r.hasBefore;
      const box = $('bAudit');
      if (box) box.innerHTML = auditBlock(S.d.site);
    } catch { const box = $('bAudit'); if (box) box.innerHTML = '<p class="ps-note">Couldn\u2019t snapshot their site. That\u2019s OK, the build still works.</p>'; }
  }

  // Build view ────────────────────────────────────────────────────────────────
  const FUN = ['Studying the best sites in their sector', 'Picking a font pairing that fits the brand', 'Sharpening their headline', 'Arranging their photos', 'Adding scroll animations', 'Making it look great on a phone', 'Polishing the call to action'];

  function renderBuild() {
    const { steps, progress } = S.d;
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 2;
    const r = 30;
    const len = 2 * Math.PI * r;
    const running = steps.filter((x) => x.status === 'running');
    const icon = (st) => (st.status === 'done' ? '✓' : st.status === 'failed' ? '!' : st.status === 'running' ? '<span class="ps-spin" style="width:12px;height:12px;border-width:2px"></span>' : '');
    const now = running.length ? running.map((x) => esc(x.label)).join('<br>') : progress.done === 0 ? 'Getting started…' : 'Waiting for the next step…';
    const existingFrame = $('psFrame');
    if (!existingFrame) {
      body().innerHTML = `${header()}<div class="ps-build"><aside class="ps-card ps-build-side" id="psBuildSide"></aside>
        <section class="ps-card ps-stage"><div class="ps-stage-bar">${pageSeg()}<span class="ps-grow"></span><span class="ps-note">Live preview: sections appear as they're built</span></div>
        <div class="ps-viewport"><iframe id="psFrame" class="ps-frame" sandbox="allow-scripts allow-popups" title="Preview"></iframe></div></section></div>`;
      bindHeader();
      bindPageSeg(() => refreshPreview(true));
      refreshPreview(true);
    }
    $('psBuildSide').innerHTML = `<div class="ps-ring"><svg viewBox="0 0 74 74"><circle cx="37" cy="37" r="${r}" stroke="#e0e7ff" stroke-width="8" fill="none"/><circle cx="37" cy="37" r="${r}" stroke="url(#g)" stroke-width="8" fill="none" stroke-linecap="round" stroke-dasharray="${(len * pct) / 100} ${len}" style="transition:stroke-dasharray .6s ease"/><defs><linearGradient id="g"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#ec4899"/></linearGradient></defs></svg>
        <div><b>${pct}%</b><span>Building ${esc(S.d.site.clientName)}'s new site</span></div></div>
      <div class="ps-now"><b>Now:</b> ${now}<br><span class="ps-note">${esc(FUN[Math.floor(Date.now() / 6000) % FUN.length])}…</span></div>
      <div class="ps-steplist">${steps.map((st) => `<div class="ps-step ${st.status}"><i>${icon(st)}</i><span>${esc(st.label)}${st.status === 'failed' ? `<br><small>${esc(st.error || '')}</small>` : st.status === 'pending' && st.error ? '<br><small>Retrying…</small>' : ''}</span>${st.status === 'failed' ? `<button type="button" data-retry="${st.id}">Retry</button>` : ''}</div>`).join('')}</div>
      <p class="ps-note">You can leave this page. The build carries on and the site will be waiting in your list.</p>`;
    $('psBuildSide').querySelectorAll('[data-retry]').forEach((b) => b.addEventListener('click', async () => { b.disabled = true; try { await post('retry-step', { id: S.d.site.id, stepId: b.dataset.retry }); } catch (e) { toast(e.message, true); } }));
    startBuildPolling();
  }

  function startBuildPolling() {
    clearInterval(S.poll);
    S.stallSince = Date.now();
    let lastDone = S.d.progress.done;
    S.poll = setInterval(async () => {
      if (document.hidden) return;
      const id = S.d?.site.id;
      let p;
      try { p = await api('progress', { id }); } catch { return; }
      if (S.d?.site.id !== id) return;
      S.d.steps = p.steps;
      S.d.progress = p.progress;
      if (p.status !== 'building') {
        clearInterval(S.poll);
        await load(id);
        if (p.status === 'ready') toast(`✨ ${S.d.site.clientName}'s pitch site is ready!`);
        body().innerHTML = '';
        renderDetail();
        return;
      }
      if (p.progress.done !== lastDone) { lastDone = p.progress.done; S.stallSince = Date.now(); refreshPreview(); }
      renderBuild();
      // Safety net: if the server-side workers have stalled (nothing running for a while), push a step from here.
      const running = p.steps.some((x) => x.status === 'running' && Date.now() - new Date(x.startedAt).getTime() < 340000);
      if (!running && Date.now() - S.stallSince > 25000 && !S.busy) {
        S.busy = true;
        S.stallSince = Date.now();
        post('run-step', { id }).catch(() => {}).finally(() => { S.busy = false; });
      }
    }, 3000);
  }

  // Workspace ─────────────────────────────────────────────────────────────────
  function pageSeg() {
    const sec = S.d.site.pages?.secondary;
    return `<div class="ps-seg" id="psPages"><button type="button" data-page="home" class="${S.page === 'home' ? 'on' : ''}">Home</button>${sec ? `<button type="button" data-page="secondary" class="${S.page === 'secondary' ? 'on' : ''}">${esc(sec.navLabel || sec.title || 'Page 2')}</button>` : ''}</div>`;
  }
  function bindPageSeg(after) {
    $('psPages')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-page]');
      if (!b || b.dataset.page === S.page) return;
      S.page = b.dataset.page;
      $('psPages').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      S.part = '';
      after();
    });
  }

  let previewSeq = 0;
  async function refreshPreview(force = false, scrollTo = '') {
    const frame = $('psFrame');
    if (!frame) return;
    const seq = ++previewSeq;
    const vp = frame.parentNode;
    let veil = vp.querySelector('.ps-veil');
    if (force && !veil) { veil = document.createElement('div'); veil.className = 'ps-veil'; veil.innerHTML = '<span><span class="ps-spin"></span> Rendering…</span>'; vp.appendChild(veil); }
    try {
      const r = await api('render', { id: S.d.site.id, page: S.page, gated: S.gated ? '1' : '0' });
      if (seq !== previewSeq) return;
      frame.srcdoc = r.html || `<div style="font:15px/1.5 system-ui;height:100vh;display:grid;place-items:center;text-align:center;color:#64748b;background:radial-gradient(600px 300px at 30% 20%,#eef2ff,transparent),#fff"><div><div style="font-size:42px">🔎</div><b style="color:#111827">${r.status === 'building' ? 'Researching their sector' : 'Nothing to show yet'}</b><br>${r.status === 'building' ? 'The preview fills in section by section once the plan is ready.' : ''}</div></div>`;
      if (scrollTo) frame.addEventListener('load', () => setTimeout(() => frame.contentWindow?.postMessage({ pitchParent: 1, type: 'scrollTo', part: scrollTo }, '*'), 700), { once: true });
      if (S.select) frame.addEventListener('load', () => frame.contentWindow?.postMessage({ pitchParent: 1, type: 'selectMode', on: true }, '*'), { once: true });
    } catch (e) { toast(e.message, true); }
    finally { setTimeout(() => vp.querySelector('.ps-veil')?.remove(), 400); }
  }

  function renderWork() {
    const s = S.d.site;
    body().innerHTML = `${header()}<div class="ps-work">
      <section class="ps-card ps-stage"><div class="ps-stage-bar">${pageSeg()}
        <div class="ps-seg" id="psDev"><button type="button" data-dev="desktop" class="${S.device === 'desktop' ? 'on' : ''}">Desktop</button><button type="button" data-dev="tablet" class="${S.device === 'tablet' ? 'on' : ''}">Tablet</button><button type="button" data-dev="mobile" class="${S.device === 'mobile' ? 'on' : ''}">Mobile</button></div>
        <span class="ps-grow"></span>
        <label class="ps-toggle" title="Show the fade and call-to-action your client sees"><input type="checkbox" id="psGated"${S.gated ? ' checked' : ''} /> Client view</label>
        <label class="ps-toggle" title="Click a section in the preview to edit it"><input type="checkbox" id="psSelect"${S.select ? ' checked' : ''} /> Click to edit</label></div>
        <div class="ps-viewport ${S.device}"><iframe id="psFrame" class="ps-frame" sandbox="allow-scripts allow-popups" title="Preview"></iframe></div></section>
      <aside class="ps-card ps-panel"><nav class="ps-tabs" id="psTabs">${[['share', 'Share'], ['tweak', 'Tweak'], ['activity', `Activity${s.viewCount ? ` (${s.viewCount})` : ''}`], ['audit', 'Audit & pitch'], ['versions', 'Versions']].map(([k, l]) => `<button type="button" data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</nav>
        <div class="ps-tab" id="psTab"></div></aside></div>`;
    bindHeader();
    bindPageSeg(() => { refreshPreview(true); renderTab(); });
    $('psDev').addEventListener('click', (e) => {
      const b = e.target.closest('[data-dev]');
      if (!b) return;
      S.device = b.dataset.dev;
      $('psDev').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      const vp = $('psFrame').parentNode;
      vp.className = `ps-viewport ${S.device}`;
    });
    $('psGated').onchange = (e) => { S.gated = e.target.checked; refreshPreview(true); };
    $('psSelect').onchange = (e) => {
      S.select = e.target.checked;
      $('psFrame').contentWindow?.postMessage({ pitchParent: 1, type: 'selectMode', on: S.select }, '*');
      if (S.select) { S.tab = 'tweak'; renderTabs(); renderTab(); toast('Click any section in the preview'); }
    };
    $('psTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; S.tab = b.dataset.tab; renderTabs(); renderTab(); });
    refreshPreview(true);
    renderTab();
    clearInterval(S.poll);
    S.poll = setInterval(async () => {
      if (document.hidden || S.busy) return;
      const id = S.d.site.id;
      try {
        const fresh = await api('get', { id });
        if (S.d?.site.id !== id) return;
        const changed = fresh.site.viewCount !== S.d.site.viewCount || fresh.events.length !== S.d.events.length;
        S.d = fresh;
        if (changed && (S.tab === 'activity' || S.tab === 'share')) renderTab();
        renderTabs();
      } catch { /* ignore */ }
    }, 20000);
  }

  function renderTabs() {
    const s = S.d.site;
    $('psTabs')?.querySelectorAll('[data-tab]').forEach((b) => {
      b.classList.toggle('on', b.dataset.tab === S.tab);
      if (b.dataset.tab === 'activity') b.textContent = `Activity${s.viewCount ? ` (${s.viewCount})` : ''}`;
    });
  }

  function renderTab() {
    const el = $('psTab');
    if (!el) return;
    ({ share: tabShare, tweak: tabTweak, activity: tabActivity, audit: tabAudit, versions: tabVersions }[S.tab] || tabShare)(el);
  }

  function tabShare(el) {
    const s = S.d.site;
    const share = s.share || {};
    const lead = S.d.lead;
    const first = (lead?.name || '').split(' ')[0];
    const rep = (s.ownerName || '').split(' ')[0];
    const days = share.expiresDays ?? S.d.expiryDays;
    el.innerHTML = `
      <div class="ps-field">Client link<div class="ps-copy"><input id="shLink" readonly value="${esc(S.d.publicUrl)}" /><button type="button" id="shCopy">Copy</button></div></div>
      <div class="ps-row"><a class="btn ghost" href="${esc(S.d.publicUrl)}" target="_blank" rel="noopener">Preview as client ↗</a><a class="btn ghost" id="shWa" href="https://wa.me/?text=${encodeURIComponent(`Hi${first ? ` ${first}` : ''}, I've put together a new look for ${s.clientName}'s website. Have a look: ${S.d.publicUrl}`)}" target="_blank" rel="noopener">WhatsApp</a></div>
      <p class="ps-note">${s.expiresAt ? `⏳ Reserved for them until <b>${esc(dateLong(s.expiresAt))}</b>.` : days ? `⏳ The ${days}-day countdown starts when you first share it.` : 'This link never expires.'} ${s.unlockedAt ? '🔓 Full site unlocked.' : '🔒 The page fades out 3/4 of the way down until they book or sign up.'}</p>
      <hr style="border:0;border-top:1px solid var(--line);margin:0" />
      <h4 class="ps-h" style="font-size:14px">Email it to them</h4>
      <label class="ps-field">To<input id="emTo" type="email" value="${esc(lead?.email || '')}" placeholder="client@business.co.uk" /></label>
      <label class="ps-field">Subject<input id="emSub" value="${esc(`${first ? `${first}, ` : ''}I redesigned ${s.clientName}'s website`)}" /></label>
      <label class="ps-field">Message<textarea id="emBody" style="min-height:150px">${esc(`Hi${first ? ` ${first}` : ''},\n\nI took a look at ${host(s.sourceUrl)} and had our team put together a fresh design for ${s.clientName}: a new homepage and ${s.pages?.secondary?.navLabel ? `${s.pages.secondary.navLabel.toLowerCase()} page` : 'an inner page'}, using your own branding and content.\n\nHave a look here, it's reserved for you:\n${S.d.publicUrl}\n\nHappy to walk you through it. There's a button on the page to grab 15 minutes with me.\n\nThanks,\n${rep}`)}</textarea></label>
      <div class="ps-row"><button type="button" id="emSend">Send email</button><span class="ps-err" id="emErr"></span></div>
      <hr style="border:0;border-top:1px solid var(--line);margin:0" />
      <h4 class="ps-h" style="font-size:14px">Settings</h4>
      <label class="ps-field">Link expires<select id="shExp">${[[7, '7 days'], [14, '14 days'], [30, '30 days'], [0, 'Never']].map(([v, l]) => `<option value="${v}"${Number(days) === v ? ' selected' : ''}>${l}${v && s.expiresAt ? ' from today' : ''}</option>`).join('')}</select></label>
      <label class="ps-field">Your direct number (shown to the client)<input id="shPhone" value="${esc(share.repPhone || '')}" placeholder="e.g. 01733 890836" /></label>
      <label class="ps-toggle"><input type="checkbox" id="shUnlock"${s.unlockedAt ? ' checked' : ''} /> Show them the full site (no fade)</label>
      <div class="ps-field">Linked lead${lead ? `<div class="ps-row"><b style="color:var(--ink)">${esc(lead.company_name || lead.name)}</b><span class="ps-note">${esc(lead.email || '')}</span><button type="button" class="ps-link" id="shUnlink">Unlink</button></div>` : ''}
        <input id="shLeadQ" placeholder="${lead ? 'Change lead…' : 'Search your leads to link this site'}" autocomplete="off" /><div class="ps-lead-results" id="shLeadRes"></div></div>
      <button type="button" class="ghost" id="shSave">Save settings</button>`;
    $('shCopy').onclick = async () => {
      try { await navigator.clipboard.writeText(S.d.publicUrl); } catch { $('shLink').select(); document.execCommand('copy'); }
      toast('Link copied. The countdown has started.');
      post('share', { id: s.id, channel: 'copy' }).then(() => load(s.id)).then(() => { if (S.tab === 'share') renderTab(); }).catch(() => {});
    };
    $('shWa').addEventListener('click', () => post('share', { id: s.id, channel: 'whatsapp' }).catch(() => {}));
    $('emSend').onclick = async (e) => {
      const btn = e.target;
      btn.disabled = true;
      btn.textContent = 'Sending…';
      $('emErr').textContent = '';
      try {
        await post('email', { id: s.id, to: $('emTo').value, subject: $('emSub').value, body: $('emBody').value });
        toast('Email sent ✉️');
        await load(s.id);
        renderTab();
      } catch (ex) { $('emErr').textContent = ex.message; btn.disabled = false; btn.textContent = 'Send email'; }
    };
    $('shSave').onclick = async () => {
      try {
        await post('update-share', { id: s.id, expiresDays: Number($('shExp').value), repPhone: $('shPhone').value, unlocked: $('shUnlock').checked });
        await load(s.id);
        toast('Saved');
        renderTab();
        if (S.gated) refreshPreview(true);
      } catch (ex) { toast(ex.message, true); }
    };
    $('shUnlink')?.addEventListener('click', async () => { await post('link-lead', { id: s.id, leadId: null }).catch((x) => toast(x.message, true)); await load(s.id); renderTab(); });
    let t;
    $('shLeadQ').addEventListener('input', (e) => {
      clearTimeout(t);
      const q = e.target.value.trim();
      t = setTimeout(async () => {
        if (q.length < 2) { $('shLeadRes').innerHTML = ''; return; }
        try {
          const r = await api('leads', { q });
          $('shLeadRes').innerHTML = r.leads.map((l) => `<button type="button" data-lead="${l.id}"><b>${esc(l.company_name || l.name)}</b>&nbsp;<span class="ps-note">${esc(l.email || '')}</span></button>`).join('') || '<span class="ps-note">No matching leads</span>';
        } catch { /* ignore */ }
      }, 250);
    });
    $('shLeadRes').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-lead]');
      if (!b) return;
      try { await post('link-lead', { id: s.id, leadId: b.dataset.lead }); await load(s.id); toast('Lead linked'); renderTab(); } catch (ex) { toast(ex.message, true); }
    });
  }

  const CHIPS = ['Make it bolder and more premium', 'More white space', 'Shorter, punchier copy', 'Darker, moodier hero', 'Add a strong call to action', 'Use more of their photos', 'Add trust badges and reviews', 'Make the headline bigger'];

  function tabTweak(el) {
    const s = S.d.site;
    const parts = s.parts?.[S.page] || [];
    if (!S.part || !parts.some((p) => p.key === S.part)) S.part = parts.find((p) => !['header', 'footer', 'styles'].includes(p.key))?.key || 'header';
    const isSection = !['header', 'footer', 'styles'].includes(S.part);
    const edits = S.d.events.filter((e) => e.kind === 'edited' && e.meta?.page === S.page && e.meta?.part === S.part).slice(0, 5);
    el.innerHTML = `
      <p class="ps-note">Tell the AI what to change. Tick <b>Click to edit</b> above the preview to pick a section by clicking it.</p>
      <label class="ps-field">Part of the page<select id="twPart">${parts.map((p) => `<option value="${esc(p.key)}"${p.key === S.part ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label class="ps-field">What should change?<textarea id="twText" placeholder="e.g. Make the hero full-screen with their van photo, a darker overlay and a bigger headline"></textarea></label>
      <div class="ps-chips">${CHIPS.map((c) => `<button type="button" data-chip="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <div class="ps-row"><button type="button" id="twGo">✨ Apply change</button><span class="ps-err" id="twErr"></span></div>
      <div id="twWork"></div>
      ${isSection ? `<div class="ps-row"><button type="button" class="ghost" data-move="up">↑ Move up</button><button type="button" class="ghost" data-move="down">↓ Move down</button><button type="button" class="ghost" id="twRemove">Remove section</button></div>
      <label class="ps-field">Add a new section after this one<textarea id="twNew" style="min-height:60px" placeholder="e.g. A pricing section with three packages"></textarea></label>
      <button type="button" class="ghost" id="twAdd">+ Add section</button>` : ''}
      ${edits.length ? `<div><h4 class="ps-h" style="font-size:13px;margin-bottom:6px">Recent changes here</h4><div class="ps-feed">${edits.map((e) => `<div>${esc(e.meta.instruction)}<em>${esc(ago(e.created_at))}</em></div>`).join('')}</div></div>` : ''}`;
    $('twPart').onchange = (e) => { S.part = e.target.value; renderTab(); $('psFrame').contentWindow?.postMessage({ pitchParent: 1, type: 'scrollTo', part: S.part }, '*'); };
    el.querySelectorAll('[data-chip]').forEach((b) => b.addEventListener('click', () => { const t = $('twText'); t.value = t.value ? `${t.value}. ${b.dataset.chip}` : b.dataset.chip; t.focus(); }));
    const working = (on, text) => {
      S.busy = on;
      el.querySelectorAll('button,textarea,select').forEach((x) => { x.disabled = on; });
      $('twWork').innerHTML = on ? `<div class="ps-working"><span class="ps-spin"></span>${esc(text)}</div>` : '';
    };
    $('twGo').onclick = async () => {
      const instruction = $('twText').value.trim();
      if (!instruction) { $('twErr').textContent = 'Say what you want changed'; return; }
      working(true, 'Redesigning this part. This takes about a minute…');
      try {
        const r = await post('edit', { id: s.id, page: S.page, part: S.part, instruction });
        await load(s.id);
        toast(r.summary ? `Done: ${r.summary.slice(0, 80)}` : 'Done');
        working(false);
        renderTab();
        refreshPreview(true, S.part);
      } catch (ex) { working(false); $('twErr').textContent = ex.message; }
    };
    el.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', async () => {
      try { await post('move-section', { id: s.id, page: S.page, key: S.part, dir: b.dataset.move }); await load(s.id); renderTab(); refreshPreview(true, S.part); } catch (ex) { toast(ex.message, true); }
    }));
    $('twRemove')?.addEventListener('click', async () => {
      if (!confirm('Remove this section? You can get it back from Versions.')) return;
      try { await post('remove-section', { id: s.id, page: S.page, key: S.part }); S.part = ''; await load(s.id); renderTab(); refreshPreview(true); } catch (ex) { toast(ex.message, true); }
    });
    $('twAdd')?.addEventListener('click', async () => {
      const instruction = $('twNew').value.trim();
      if (!instruction) return;
      working(true, 'Designing a new section. About a minute…');
      try {
        const r = await post('add-section', { id: s.id, page: S.page, after: S.part, instruction });
        await load(s.id);
        S.part = r.part;
        working(false);
        renderTab();
        refreshPreview(true, r.part);
      } catch (ex) { working(false); toast(ex.message, true); }
    });
  }

  const EVENT_LABEL = {
    open: '👀 Opened the site', gate: '🌫️ Scrolled to the fade', cta: '👆 Clicked a call to action', nav: '📄 Switched page', before_after: '↔️ Looked at before & after',
    booked: '📅 Booked a walkthrough', signup: '🚀 Asked to sign up', shared: '🔗 Link shared', edited: '✏️ Edited', built: '✨ Built', created: '🌱 Created', build_started: '⚙️ Build started',
  };

  function tabActivity(el) {
    const { visits, events, site: s } = S.d;
    const uniq = new Set(visits.map((v) => v.visitor)).size;
    const secs = visits.reduce((t, v) => t + (v.seconds || 0), 0);
    const deepest = visits.reduce((m, v) => Math.max(m, v.max_depth || 0), 0);
    const count = (k) => events.filter((e) => e.kind === k).length;
    const mins = secs >= 60 ? `${Math.round(secs / 60)}m` : `${secs}s`;
    const booked = events.find((e) => e.kind === 'booked');
    const signup = events.find((e) => e.kind === 'signup');
    el.innerHTML = `
      ${viewingNow(s) ? '<div class="ps-working" style="background:#dcfce7;color:#166534">🟢 They\u2019re looking at it right now. Great time to call!</div>' : ''}
      ${signup ? `<div class="ps-gap" style="background:#f0fdf4;border-color:#bbf7d0"><b>🚀 ${esc(signup.meta?.name)} wants to sign up</b><p>${esc(signup.meta?.email)} · ${esc(signup.meta?.phone)}${signup.meta?.notes ? `<br>"${esc(signup.meta.notes)}"` : ''}</p><small>${esc(ago(signup.created_at))}</small></div>` : ''}
      ${booked ? `<div class="ps-gap" style="background:#eff6ff;border-color:#bfdbfe"><b>📅 ${esc(booked.meta?.name)} booked a walkthrough</b><p>${esc(new Date(booked.meta?.slot).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</p><small>${esc(booked.meta?.email || '')} ${esc(booked.meta?.phone || '')}</small></div>` : ''}
      <div class="ps-stats">
        <div class="ps-stat"><b>${s.viewCount || 0}</b><span>visits</span></div><div class="ps-stat"><b>${uniq}</b><span>people</span></div><div class="ps-stat"><b>${mins}</b><span>time on site</span></div>
        <div class="ps-stat"><b>${deepest}%</b><span>furthest scroll</span></div><div class="ps-stat"><b>${count('gate')}</b><span>reached the fade</span></div><div class="ps-stat"><b>${count('cta')}</b><span>CTA clicks</span></div>
      </div>
      ${s.firstViewedAt ? `<p class="ps-note">First opened ${esc(ago(s.firstViewedAt))}, last seen ${esc(ago(s.lastViewedAt))}.</p>` : `<p class="ps-note">${s.sharedAt ? 'Not opened yet. You\u2019ll get an email and a note on their timeline the moment they do.' : 'Share the link to start tracking.'}</p>`}
      <div class="ps-feed">${events.filter((e) => !['heartbeat'].includes(e.kind)).slice(0, 40).map((e) => `<div>${esc(EVENT_LABEL[e.kind] || e.kind)}${e.kind === 'cta' && e.meta?.detail ? ` <span class="ps-note">(${esc(e.meta.detail.split(':')[0])})</span>` : ''}${e.kind === 'shared' && e.meta?.channel ? ` <span class="ps-note">(${esc(e.meta.channel)})</span>` : ''}<em>${esc(ago(e.created_at))}</em></div>`).join('') || '<p class="ps-note">No activity yet.</p>'}</div>`;
  }

  function tabAudit(el) {
    const s = S.d.site;
    const br = s.brief || {};
    el.innerHTML = `
      ${(br.gaps || []).length ? `<h4 class="ps-h" style="font-size:14px">3 gaps in their current site</h4>${br.gaps.map((g, i) => `<div class="ps-gap"><b>${i + 1}. ${esc(g.title)}</b><p>${esc(g.detail)}</p>${g.evidence ? `<small>${esc(g.evidence)}</small>` : ''}</div>`).join('')}` : ''}
      ${(br.talkingPoints || []).length ? `<h4 class="ps-h" style="font-size:14px">Say this on the call</h4><ul class="ps-list">${br.talkingPoints.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      ${br.positioning ? `<p class="ps-note"><b>Positioning:</b> ${esc(br.positioning)}<br><b>Sector:</b> ${esc(br.sector)} · <b>Audience:</b> ${esc(br.audience)}</p>` : ''}
      ${(br.research || []).length ? `<h4 class="ps-h" style="font-size:14px">What the best sites in their sector do</h4><ul class="ps-list">${br.research.map((r) => `<li>${esc(r.insight)}${r.source ? ` <span class="ps-note">(${esc(r.source)})</span>` : ''}</li>`).join('')}</ul>` : ''}
      <h4 class="ps-h" style="font-size:14px">Their site today</h4>${auditBlock(s)}
      <button type="button" class="ghost" id="auRe">Re-run snapshot</button>`;
    $('auRe').onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Running…'; try { const r = await post('audit', { id: s.id }); s.audit = r.audit; s.hasBefore = r.hasBefore; renderTab(); } catch (ex) { toast(ex.message, true); } };
  }

  function tabVersions(el) {
    const v = S.d.versions;
    el.innerHTML = `<p class="ps-note">Every change saves a copy first, so you can always go back.</p>
      <div class="ps-vers">${v.map((x) => `<div><b>v${x.version}</b><span class="ps-grow">${esc(x.note || '')}<br><span class="ps-note">${esc(ago(x.created_at))}${x.created_by && x.created_by !== 'pitch-worker' ? ` · ${esc(x.created_by)}` : ''}</span></span><button type="button" class="ghost" data-v="${x.version}">Restore</button></div>`).join('') || '<p class="ps-note">No versions yet.</p>'}</div>
      <hr style="border:0;border-top:1px solid var(--line);margin:0" />
      <p class="ps-note">Want a completely different take? Rebuilding keeps a copy of this version.</p><button type="button" class="ghost" id="vRebuild">Rebuild from scratch</button>`;
    el.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`Restore version ${b.dataset.v}? The current version is saved first.`)) return;
      try { await post('restore', { id: S.d.site.id, version: b.dataset.v }); await load(S.d.site.id); toast('Restored'); refreshPreview(true); renderTab(); } catch (ex) { toast(ex.message, true); }
    }));
    $('vRebuild').onclick = async () => {
      if (!confirm('Rebuild this pitch site from scratch? The current design is saved as a version.')) return;
      try { await post('build', { id: S.d.site.id }); await load(S.d.site.id); body().innerHTML = ''; renderDetail(); } catch (ex) { toast(ex.message, true); }
    };
  }

  // Preview → studio messages (section picking, page links)
  window.addEventListener('message', (e) => {
    const f = $('psFrame');
    if (!f || e.source !== f.contentWindow) return;
    const m = e.data || {};
    if (!m.pitch) return;
    if (m.type === 'select' && m.part) {
      S.part = m.part;
      S.tab = 'tweak';
      renderTabs();
      renderTab();
      $('twText')?.focus();
    }
    if (m.type === 'nav' && (m.to === 'home' || m.to === 'secondary') && m.to !== S.page && S.d.site.pages?.[m.to]) {
      S.page = m.to;
      $('psPages')?.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.page === S.page));
      refreshPreview(true);
      if ($('psTab')) renderTab();
    }
  });

  // ── Settings (admin) ─────────────────────────────────────────────────────────
  async function settingsModal() {
    let cfg;
    try { cfg = (await api('settings')).config; } catch (e) { toast(e.message, true); return; }
    const g = cfg.gate;
    const el = modal(`<h3 class="ps-h">Pitch Sites settings</h3>
      <label class="ps-field">House prompt (how the AI designs every pitch site)<textarea id="stPrompt" style="min-height:240px;font-family:ui-monospace,Menlo,monospace;font-size:12px">${esc(cfg.housePrompt)}</textarea></label>
      <h4 class="ps-h" style="font-size:14px">The fade and call to action clients see</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label class="ps-field">Small label<input id="stEyebrow" value="${esc(g.eyebrow)}" /></label><label class="ps-field">Price shown<input id="stPrice" value="${esc(g.price)}" /></label>
        <label class="ps-field" style="grid-column:1/-1">Headline<input id="stHeadline" value="${esc(g.headline)}" /></label>
        <label class="ps-field" style="grid-column:1/-1">Text ({rep} = rep's first name)<input id="stSub" value="${esc(g.sub)}" /></label>
        <label class="ps-field">Booking button<input id="stBook" value="${esc(g.bookLabel)}" /></label><label class="ps-field">Sign-up button<input id="stSignup" value="${esc(g.signupLabel)}" /></label>
        <label class="ps-field">Default link expiry (days, 0 = never)<input id="stExp" type="number" min="0" max="365" value="${esc(cfg.expiryDays)}" /></label>
      </div>
      <div class="ps-row" style="justify-content:space-between"><button type="button" class="ps-link" id="stReset">Reset the prompt to default</button><span><button type="button" class="ghost" data-close>Cancel</button> <button type="button" id="stSave">Save</button></span></div>`, { wide: true });
    el.querySelector('#stReset').onclick = () => { el.querySelector('#stPrompt').value = ''; toast('Save to restore the default prompt'); };
    el.querySelector('#stSave').onclick = async () => {
      const v = (id) => el.querySelector(id).value;
      try {
        await post('settings-save', { config: { housePrompt: v('#stPrompt'), expiryDays: v('#stExp'), gate: { eyebrow: v('#stEyebrow'), price: v('#stPrice'), headline: v('#stHeadline'), sub: v('#stSub'), bookLabel: v('#stBook'), signupLabel: v('#stSignup') } } });
        el.remove();
        toast('Settings saved');
      } catch (e) { toast(e.message, true); }
    };
  }

  // ── Boot ─────────────────────────────────────────────────────────────────────
  function init() {
    $('psNew').onclick = () => newModal();
    $('psSettings').onclick = settingsModal;
    window.addEventListener('popstate', route);
    route();
  }
  if (window.SQ?.init) window.SQ.init(() => init()); else init();
})();
