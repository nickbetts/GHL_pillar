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
    opportunities: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h7v4H3z"/><path d="M14 4h7v8h-7z"/><path d="M3 14h7v6H3z"/><path d="M14 16h7v4h-7z"/></svg>',
    calls: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.8 19.8 0 0 1 11.2 18.8 19.5 19.5 0 0 1 5.2 12.8 19.8 19.8 0 0 1 2.08 4.11 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.12.9.34 1.79.65 2.64a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6.27 6.27l1.26-1.26a2 2 0 0 1 2.11-.45c.85.31 1.74.53 2.64.65A2 2 0 0 1 22 16.92z"/></svg>',
    inbound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 17V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10"/><path d="M4 17h16"/><path d="M12 3v10"/><path d="m8 9 4 4 4-4"/></svg>',
    waves: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2 2 2 4 2"/><path d="M2 12c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2 2 2 4 2"/><path d="M2 18c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2 2 2 4 2"/></svg>',
    reports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="7" rx="1"/><rect x="12" y="6" width="3" height="11" rx="1"/><rect x="17" y="13" width="3" height="4" rx="1"/></svg>',
    weekly: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l3-3 3 2 4-5"/><circle cx="7" cy="14" r="1"/><circle cx="10" cy="11" r="1"/><circle cx="13" cy="13" r="1"/><circle cx="17" cy="8" r="1"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>',
    market: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l3-3 3 2 4-5"/><circle cx="7" cy="14" r="1"/><circle cx="10" cy="11" r="1"/><circle cx="13" cy="13" r="1"/><circle cx="17" cy="8" r="1"/></svg>',
    email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3a2 2 0 0 1-2 3.5"/><path d="M7 5H4a2 2 0 0 0 2 3.5"/></svg>',
    team: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M17 8.5a3 3 0 0 1 0 5"/><path d="M18.5 20a5.2 5.2 0 0 0-2.5-4.4"/></svg>',
    insights: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v6"/><path d="M5.6 7.2 9.8 10"/><path d="M18.4 7.2 14.2 10"/><circle cx="12" cy="14" r="7"/><path d="m9 14 2 2 4-4"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  };

  const NAV = [
    { key: 'calls', label: 'Call list', href: '/call-list', match: ['/call-list', '/sales-queue', '/queue', '/outbound'], cap: null },
    { key: 'board', label: 'Outbound', href: '/outbound', match: ['/outbound', '/sales-queue', '/queue'], cap: 'isAdmin' },
    { key: 'opportunities', label: 'Opportunities', href: '/opportunities', match: ['/opportunities'], cap: null },
    { key: 'weekly', label: 'Leaderboard', href: '/weekly-dashboard', match: ['/weekly-dashboard'], cap: null },
    { key: 'calendar', label: 'Calendar', href: '/calendar', match: ['/calendar'], cap: null },
    { key: 'email', label: 'Email copy', href: '/email-templates', match: ['/email-templates'], cap: null },
    { key: 'trophy', label: 'Achievements', href: '/achievements', match: ['/achievements'], cap: null },
    { key: 'market', label: 'Market Size', href: '/market-size', match: ['/market-size'], cap: null },
    { key: 'inbound', label: 'Inbound', href: '/inbound', match: ['/inbound'], cap: null },
    { key: 'waves', label: 'Waves', href: '/wave-1', match: ['/wave-1', '/wave-2', '/wave-3', '/backup'], cap: 'viewWaves' },
    { key: 'reports', label: 'Reports', href: '/sales-queue-report', match: ['/sales-queue-report', '/queue-report'], cap: 'viewReports' },
    { key: 'team', label: 'Team', href: '/sq-admin', match: ['/sq-admin'], cap: 'manageUsers' },
    { key: 'insights', label: 'AI Insights', href: '/admin-insights', match: ['/admin-insights'], cap: 'manageUsers' },
    { key: 'settings', label: 'My Settings', href: '/settings', match: ['/settings'], cap: null },
  ];

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

    redirectLogin() { location.href = '/login?next=' + encodeURIComponent(location.pathname); },

    async logout() {
      try {
        await fetch('/api/sq-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action: 'logout' }) });
      } catch { /* ignore */ }
      location.href = '/login';
    },

    async init(onReady) {
      let data;
      try {
        const res = await fetch('/api/sq-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action: 'me' }) });
        if (!res.ok) return this.redirectLogin();
        data = await res.json();
      } catch { return this.redirectLogin(); }
      if (!data || !data.success) return this.redirectLogin();
      this.me = data; this.caps = data.caps || {}; this.user = data.user || {};
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
      const links = NAV
        .filter((n) => !n.cap || this.caps[n.cap])
        .map((n) => {
          const active = n.match.some((m) => path === m || path.startsWith(m + '/'));
          return `<a class="sb-link ${active ? 'active' : ''}" href="${n.href}">${ICONS[n.key]}<span>${esc(n.label)}</span></a>`;
        }).join('');

      mount.innerHTML = `
        <div class="sb-brand">
          <div class="sb-mark">i3</div>
          <div class="sb-brandtext"><b>i3 Sales</b><span>Workspace</span></div>
        </div>
        <div class="sb-section">Menu</div>
        <nav class="sb-nav">${links}</nav>
        <div class="sb-foot">
          <div class="sb-quick-actions">
            <button class="sb-quick" onclick="SQ.openQuickAction('activity')">Log activity block</button>
          </div>
          <div class="sb-user">
            <div class="sb-avatar"${this.user.avatarColor ? ` style="background:${esc(this.user.avatarColor)};color:#fff;overflow:hidden"` : ''}>${avatarInner(this.user)}</div>
            <div class="sb-userinfo"><b>${esc(this.user.name || this.user.email || 'User')}</b><span>${esc(this.caps.role || '')}</span></div>
          </div>
          <button class="sb-signout" onclick="SQ.logout()">Sign out</button>
        </div>`;
    },
  };

  window.SQ = SQ;
  window.SQ.avatarInner = avatarInner;
  window.logout = () => SQ.logout();
})();
