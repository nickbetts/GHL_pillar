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
    waves: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2 2 2 4 2"/><path d="M2 12c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2 2 2 4 2"/><path d="M2 18c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2 2 2 4 2"/></svg>',
    reports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="7" rx="1"/><rect x="12" y="6" width="3" height="11" rx="1"/><rect x="17" y="13" width="3" height="4" rx="1"/></svg>',
    team: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M17 8.5a3 3 0 0 1 0 5"/><path d="M18.5 20a5.2 5.2 0 0 0-2.5-4.4"/></svg>',
  };

  const NAV = [
    { key: 'board', label: 'Board', href: '/sales-queue', match: ['/sales-queue', '/queue'], cap: null },
    { key: 'waves', label: 'Waves', href: '/wave-1', match: ['/wave-1', '/wave-2', '/wave-3', '/backup'], cap: 'viewWaves' },
    { key: 'reports', label: 'Reports', href: '/sales-queue-report', match: ['/sales-queue-report', '/queue-report'], cap: 'viewReports' },
    { key: 'team', label: 'Team', href: '/sq-admin', match: ['/sq-admin'], cap: 'manageUsers' },
  ];

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function initials(name, email) {
    const src = (name || email || '?').trim();
    const parts = src.split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return src.slice(0, 2).toUpperCase();
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
          <div class="sb-user">
            <div class="sb-avatar">${esc(initials(this.user.name, this.user.email))}</div>
            <div class="sb-userinfo"><b>${esc(this.user.name || this.user.email || 'User')}</b><span>${esc(this.caps.role || '')}</span></div>
          </div>
          <button class="sb-signout" onclick="SQ.logout()">Sign out</button>
        </div>`;
    },
  };

  window.SQ = SQ;
  window.logout = () => SQ.logout();
})();
