/* Shared sidebar + auth bootstrap for the i3 Sales workspace.
   Usage on each page:
     <body class="sq"><div class="app"><aside class="sidebar" id="sqSidebar"></aside>
       <main class="app-main"> ... page content ... </main></div>
     <script src="/sales-app.js"></script>
     <script> SQ.init((caps, user) => { ...gate page controls...; loadThing(); }); </script>
*/
(function () {
  const ICONS = {
    board: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
    opportunities: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M2 13h20"/></svg>',
    calls: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.8 19.8 0 0 1 11.2 18.8 19.5 19.5 0 0 1 5.2 12.8 19.8 19.8 0 0 1 2.08 4.11 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.12.9.34 1.79.65 2.64a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6.27 6.27l1.26-1.26a2 2 0 0 1 2.11-.45c.85.31 1.74.53 2.64.65A2 2 0 0 1 22 16.92z"/></svg>',
    inbound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 17V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10"/><path d="M4 17h16"/><path d="M12 3v10"/><path d="m8 9 4 4 4-4"/></svg>',
    waves: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2 2 2 4 2"/><path d="M2 12c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2 2 2 4 2"/><path d="M2 18c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2 2 2 4 2"/></svg>',
    reports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="7" rx="1"/><rect x="12" y="6" width="3" height="11" rx="1"/><rect x="17" y="13" width="3" height="4" rx="1"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>',
    market: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.2 15.9A10 10 0 1 1 8 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>',
    podium: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21V9h6v12"/><path d="M3 21v-7h6"/><path d="M15 21v-5h6v5"/><path d="M2 21h20"/><path d="m12 3 .9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3z"/></svg>',
    collapse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    chevrons: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3a2 2 0 0 1-2 3.5"/><path d="M7 5H4a2 2 0 0 0 2 3.5"/></svg>',
    team: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M17 8.5a3 3 0 0 1 0 5"/><path d="M18.5 20a5.2 5.2 0 0 0-2.5-4.4"/></svg>',
    insights: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v6"/><path d="M5.6 7.2 9.8 10"/><path d="M18.4 7.2 14.2 10"/><circle cx="12" cy="14" r="7"/><path d="m9 14 2 2 4-4"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    campaigns: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>',
  };

  const NAV = [
    { key: 'calls', group: 'sell', label: 'Call list', href: '/call-list-zen', match: ['/call-list', '/call-list-zen'], cap: null },
    { key: 'board', group: 'sell', label: 'Outbound', href: '/outbound', match: ['/outbound', '/sales-queue', '/queue'], cap: 'isAdmin' },
    { key: 'opportunities', group: 'sell', label: 'Opportunities', href: '/opportunities', match: ['/opportunities'], cap: null },
    { key: 'inbound', group: 'sell', label: 'Inbound', href: '/inbound', match: ['/inbound'], cap: null },
    { key: 'calendar', group: 'sell', label: 'Calendar', href: '/calendar', match: ['/calendar'], cap: null },
    { key: 'campaigns', group: 'engage', label: 'Campaigns', href: '/campaigns', match: ['/campaigns'], cap: 'isAdmin' },
    { key: 'email', group: 'engage', label: 'Email copy', href: '/email-templates', match: ['/email-templates'], cap: null },
    { key: 'waves', group: 'engage', label: 'Waves', href: '/wave-1', match: ['/wave-1', '/wave-2', '/wave-3', '/backup'], cap: 'viewWaves' },
    { key: 'reports', group: 'insight', label: 'Reports', href: '/sales-queue-report', match: ['/sales-queue-report', '/queue-report'], cap: 'viewReports' },
    { key: 'podium', group: 'insight', label: 'Leaderboard', href: '/weekly-dashboard', match: ['/weekly-dashboard'], cap: null },
    { key: 'trophy', group: 'insight', label: 'Achievements', href: '/achievements', match: ['/achievements'], cap: null },
    { key: 'market', group: 'insight', label: 'Market size', href: '/market-size', match: ['/market-size'], cap: null },
    { key: 'insights', group: 'insight', label: 'AI insights', href: '/admin-insights', match: ['/admin-insights'], cap: 'manageUsers' },
    { key: 'team', group: 'admin', label: 'Team', href: '/sq-admin', match: ['/sq-admin'], cap: 'manageUsers' },
    { key: 'settings', group: 'admin', label: 'My settings', href: '/settings', match: ['/settings'], cap: null },
  ];
  const GROUPS = [['sell', 'Sell'], ['engage', 'Engage'], ['insight', 'Insights'], ['admin', 'Workspace']];
  const COLLAPSE_KEY = 'sq-sidebar-collapsed';
  const LOGO_KEY = 'sq-logo-variant';
  const LOGOS = { clean: '/brand/stream-clean.svg', container: '/brand/stream-container.svg' };
  function logoVariant() {
    try { const saved = localStorage.getItem(LOGO_KEY); return LOGOS[saved] ? saved : 'clean'; } catch { return 'clean'; }
  }
  try { if (localStorage.getItem(COLLAPSE_KEY) === '1') document.body.classList.add('sb-collapsed'); } catch { /* storage disabled */ }

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function initials(name, email) {
    const src = (name || email || '?').trim();
    const parts = src.split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return src.slice(0, 2).toUpperCase();
  }

  // Render an avatar face from a profile: photo, emoji, or initials on a colour.
  function avatarInner(profile) {
    const avatar = profile && profile.avatar ? String(profile.avatar) : '';
    if (avatar.startsWith('data:')) {
      return `<img src="${esc(avatar)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit" />`;
    }
    if (avatar) return esc(avatar);
    return esc(initials(profile && profile.name, profile && profile.email));
  }

  const SQ = {
    me: null,
    caps: {},
    user: {},

    adminImpersonationKey: 'sq-admin-impersonation-owner',

    getAdminImpersonationOwner() {
      try {
        return sessionStorage.getItem(this.adminImpersonationKey) || '';
      } catch {
        return '';
      }
    },

    setAdminImpersonationOwner(ownerId) {
      if (!ownerId) {
        try { sessionStorage.removeItem(this.adminImpersonationKey); } catch {}
        return;
      }
      try { sessionStorage.setItem(this.adminImpersonationKey, String(ownerId)); } catch {}
    },

    clearAdminImpersonation() {
      this.setAdminImpersonationOwner('');
      window.location.reload();
    },

    async impersonateOwner(ownerId) {
      const target = String(ownerId || '').trim();

      if (!target) {
        try {
          const res = await fetch('/api/sq-auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ action: 'stop-impersonating' }),
          });
          if (res.ok) {
            this.setAdminImpersonationOwner('');
            window.location.reload();
          }
        } catch {}
        return;
      }

      try {
        const res = await fetch('/api/sq-auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ action: 'impersonate-user', ownerId: target }),
        });
        if (res.ok) {
          this.setAdminImpersonationOwner(target);
          window.location.reload();
        }
      } catch {}
    },

    redirectLogin() { location.href = '/login?next=' + encodeURIComponent(location.pathname); },

    async logout() {
      try {
        await fetch('/api/sq-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action: 'logout' }) });
      } catch { /* ignore */ }
      location.href = '/login';
    },

    async loadAdminUserOptions() {
      if (!this.caps || !this.caps.isAdmin) return [];
      try {
        const res = await fetch('/api/sq-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action: 'list-users' }) });
        if (!res.ok) return [];
        const data = await res.json();
        if (!data || !data.success || !Array.isArray(data.users)) return [];
        return data.users
          .filter((u) => u && (u.role === 'rep' || u.role === 'manager' || u.role === 'admin'))
          .map((u) => ({ id: String(u.ghlOwnerId || u.id || ''), label: u.name || u.email || 'User' }))
          .filter((u) => u.id)
          .sort((a, b) => a.label.localeCompare(b.label));
      } catch {
        return [];
      }
    },

    async init(onReady) {
      let data;
      try {
        const res = await fetch('/api/sq-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action: 'me' }) });
        if (!res.ok) return this.redirectLogin();
        data = await res.json();
      } catch { return this.redirectLogin(); }
      if (!data || !data.success) return this.redirectLogin();
      const impersonatedOwner = this.getAdminImpersonationOwner();
      const baseUser = data.user || {};
      this.me = data; this.caps = data.caps || {}; this.user = baseUser;
      if (baseUser.impersonating && baseUser.original) {
        this.setAdminImpersonationOwner(baseUser.ghlOwnerId || '');
      } else if (this.caps.isAdmin && impersonatedOwner) {
        this.setAdminImpersonationOwner(impersonatedOwner);
      }
      this.mountSidebar();
      if (typeof onReady === 'function') onReady(this.caps, this.user);
    },

    openQuickAction(kind) {
      const action = String(kind || '').toLowerCase();
      const fnName = action === 'activity' ? 'openManualActivityLog' : '';
      const fn = window[fnName];
      if (typeof fn === 'function') {
        try {
          fn();
          return;
        } catch {
          // Fall through to route navigation.
        }
      }
      location.href = '/call-list?quickAction=manual-activity';
    },

    mountSidebar() {
      const mount = document.getElementById('sqSidebar');
      if (!mount) return;
      const path = location.pathname.replace(/\/+$/, '') || '/';
      const visible = NAV.filter((n) => !n.cap || this.caps[n.cap]);
      const current = visible.find((n) => n.match.some((m) => path === m || path.startsWith(m + '/')));
      const groups = GROUPS.map(([key, label]) => {
        const items = visible.filter((n) => n.group === key);
        if (!items.length) return '';
        const links = items.map((n) => {
          const active = n === current;
          return `<a class="sb-link${active ? ' active' : ''}" href="${n.href}" title="${esc(n.label)}"${active ? ' aria-current="page"' : ''}>${ICONS[n.key]}<span>${esc(n.label)}</span></a>`;
        }).join('');
        return `<div class="sb-group"><div class="sb-section">${esc(label)}</div>${links}</div>`;
      }).join('');

      const overrideOwner = this.getAdminImpersonationOwner();
      const isImpersonating = !!this.user.impersonating && !!this.user.original;
      const name = this.user.name || this.user.email || 'User';
      const avatarStyle = this.user.avatarColor ? ` style="background:${esc(this.user.avatarColor)};color:#fff"` : '';
      const adminSwapHtml = this.caps.isAdmin ? `
        <label class="sb-viewas" title="View the workspace as another rep">
          ${ICONS.eye}<span class="sb-viewas-label">View as</span>
          <select id="sqAdminSwitch" aria-label="View the workspace as"><option value="">My account</option></select>
        </label>` : '';

      const logo = logoVariant();
      const logoImg = `<img class="sb-logo" data-sb-logo-img src="${LOGOS[logo]}" alt="Stream" />`;
      mount.innerHTML = `
        <div class="sb-mobilebar">
          <button type="button" class="sb-icon-btn" data-sb="open" aria-label="Open menu" aria-expanded="false" aria-controls="sqSidebarPanel">${ICONS.menu}</button>
          <a class="sb-brand-mini" href="/call-list-zen" aria-label="Stream home">${logoImg}</a>
          <span class="sb-mobile-title">${esc(current ? current.label : '')}</span>
        </div>
        <div class="sb-scrim" data-sb="close"></div>
        <div class="sb-panel" id="sqSidebarPanel">
          <div class="sb-brand">
            <a class="sb-brand-link" href="/call-list-zen" aria-label="Stream home">${logoImg}</a>
            <button type="button" class="sb-icon-btn sb-collapse" data-sb="collapse" aria-label="Collapse sidebar" title="Collapse sidebar">${ICONS.collapse}</button>
            <button type="button" class="sb-icon-btn sb-close" data-sb="close" aria-label="Close menu">${ICONS.close}</button>
          </div>
          <div class="sb-logo-switch" role="group" aria-label="Logo preview">
            ${Object.keys(LOGOS).map((key) => `<button type="button" data-sb="logo" data-variant="${key}" class="${key === logo ? 'on' : ''}" aria-pressed="${key === logo}">${key === 'clean' ? 'Clean' : 'Container'}</button>`).join('')}
          </div>
          <button type="button" class="sb-action" onclick="SQ.openQuickAction('activity')" title="Log activity">${ICONS.plus}<span>Log activity</span></button>
          <nav class="sb-nav" aria-label="Main">${groups}</nav>
          <div class="sb-foot">
            ${adminSwapHtml}
            <details class="sb-user-menu">
              <summary class="sb-user" title="${esc(name)}">
                <span class="sb-avatar"${avatarStyle}>${avatarInner(this.user)}</span>
                <span class="sb-userinfo"><b>${esc(name)}</b><span>${esc(isImpersonating ? `Viewing as · ${this.caps.role || ''}` : (this.caps.role || ''))}</span></span>
                <span class="sb-chev">${ICONS.chevrons}</span>
              </summary>
              <div class="sb-pop" role="menu">
                <div class="sb-pop-head"><b>${esc(name)}</b><span>${esc(this.user.email || '')}</span></div>
                <a role="menuitem" href="/settings">${ICONS.settings}My settings</a>
                ${isImpersonating ? `<button type="button" role="menuitem" data-sb="swap-back">${ICONS.eye}Swap back to my account</button>` : ''}
                <button type="button" role="menuitem" class="danger" onclick="SQ.logout()">${ICONS.logout}Sign out</button>
              </div>
            </details>
          </div>
        </div>`;

      if (!this.sidebarBound) {
        this.sidebarBound = true;
        const setOpen = (open) => {
          mount.classList.toggle('open', open);
          document.body.classList.toggle('sb-drawer-open', open);
          mount.querySelector('[data-sb="open"]')?.setAttribute('aria-expanded', String(open));
        };
        mount.addEventListener('click', (event) => {
          const control = event.target.closest('[data-sb]');
          if (!control) return;
          const action = control.dataset.sb;
          if (action === 'open') setOpen(true);
          if (action === 'close') setOpen(false);
          if (action === 'swap-back') this.impersonateOwner('');
          if (action === 'logo') {
            const variant = LOGOS[control.dataset.variant] ? control.dataset.variant : 'clean';
            try { localStorage.setItem(LOGO_KEY, variant); } catch { /* storage disabled */ }
            mount.querySelectorAll('[data-sb-logo-img]').forEach((img) => { img.src = LOGOS[variant]; });
            mount.querySelectorAll('[data-sb="logo"]').forEach((btn) => {
              const on = btn.dataset.variant === variant;
              btn.classList.toggle('on', on);
              btn.setAttribute('aria-pressed', String(on));
            });
          }
          if (action === 'collapse') {
            const collapsed = document.body.classList.toggle('sb-collapsed');
            try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* storage disabled */ }
            control.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
            control.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
          }
        });
        document.addEventListener('click', (event) => {
          const menu = mount.querySelector('.sb-user-menu[open]');
          if (menu && !menu.contains(event.target)) menu.removeAttribute('open');
        });
        document.addEventListener('keydown', (event) => {
          if (event.key !== 'Escape') return;
          mount.querySelector('.sb-user-menu[open]')?.removeAttribute('open');
          if (mount.classList.contains('open')) setOpen(false);
        });
      }
      if (document.body.classList.contains('sb-collapsed')) {
        const toggle = mount.querySelector('[data-sb="collapse"]');
        toggle.setAttribute('aria-label', 'Expand sidebar');
        toggle.title = 'Expand sidebar';
      }

      if (this.caps.isAdmin) {
        const adminSelect = document.getElementById('sqAdminSwitch');
        if (adminSelect) {
          this.loadAdminUserOptions().then((users) => {
            const choices = users.length ? users : [];
            const current = overrideOwner || '';
            const options = ['<option value="">My account</option>']
              .concat(choices.map((u) => `<option value="${esc(u.id)}" ${current === u.id ? 'selected' : ''}>${esc(u.label)}</option>`))
              .join('');
            adminSelect.innerHTML = options;
            adminSelect.value = current ? current : '';
          });
          adminSelect.addEventListener('change', (event) => {
            const value = event.target.value || '';
            this.impersonateOwner(value);
          });
        }
      }

      const existingSwapBack = document.getElementById('sqSwapBackBtn');
      if (isImpersonating && !existingSwapBack) {
        const swapBack = document.createElement('button');
        swapBack.id = 'sqSwapBackBtn';
        swapBack.className = 'sq-swapback';
        swapBack.type = 'button';
        swapBack.textContent = 'Swap back';
        swapBack.setAttribute('aria-label', 'Swap back to your own account');
        swapBack.onclick = () => this.impersonateOwner('');
        document.body.appendChild(swapBack);
      }
      if (existingSwapBack && !isImpersonating) {
        existingSwapBack.remove();
      }
    },
  };

  window.SQ = SQ;
  window.SQ.avatarInner = avatarInner;
  window.logout = () => SQ.logout();
})();
