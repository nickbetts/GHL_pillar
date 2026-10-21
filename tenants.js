/* Tenants: owner admins create and manage company workspaces. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'never');
  const BASE = 'streamcrm.co.uk';
  const S = { tenants: [] };

  async function api(body) {
    const res = await fetch('/api/tenants', { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401) { location.href = '/login?next=/tenants'; return { success: false }; }
    return res.json().catch(() => ({ success: false, error: 'Unexpected response' }));
  }

  function dialog(html, wire) {
    const modal = document.createElement('div');
    modal.className = 'mk-modal';
    modal.innerHTML = `<div class="mk-modal-box" role="dialog" aria-modal="true">${html}</div>`;
    const close = () => modal.remove();
    modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-close]')) close(); });
    document.body.appendChild(modal);
    wire(modal, close);
  }

  const slugify = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

  function showCredentials(title, url, admin) {
    dialog(`<h3>${esc(title)}</h3>
      <p>Share these sign-in details with the admin. The password is shown once and is not stored anywhere you can read it again.</p>
      <label>Address<input readonly value="${esc(url)}" /></label>
      <label>Email<input readonly value="${esc(admin.email)}" /></label>
      <label>Temporary password<input readonly id="tnPw" value="${esc(admin.password)}" /></label>
      <div class="mk-row"><button type="button" id="tnCopy">Copy details</button><button type="button" class="ghost" data-close>Done</button></div>`, (wrap) => {
      wrap.querySelector('#tnCopy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(`Address: ${url}\nEmail: ${admin.email}\nTemporary password: ${admin.password}`); wrap.querySelector('#tnCopy').textContent = 'Copied'; } catch { wrap.querySelector('#tnPw').select(); }
      });
    });
  }

  function openCreate() {
    dialog(`<h3>New tenant</h3>
      <label>Company name<input id="tnName" maxlength="80" autocomplete="off" /></label>
      <label>Address<div class="mk-pw"><input id="tnSlug" maxlength="32" autocomplete="off" placeholder="acme" /><span class="mk-note" style="align-self:center">.${BASE}</span></div></label>
      <label>First admin's name<input id="tnAdminName" maxlength="80" autocomplete="off" /></label>
      <label>First admin's email<input id="tnAdminEmail" type="email" autocomplete="off" /></label>
      <div class="mk-err" id="tnErr"></div>
      <div class="mk-row"><button type="button" id="tnCreate">Create tenant</button><button type="button" class="ghost" data-close>Cancel</button></div>`, (wrap, close) => {
      let edited = false;
      wrap.querySelector('#tnSlug').addEventListener('input', () => { edited = true; });
      wrap.querySelector('#tnName').addEventListener('input', (e) => { if (!edited) wrap.querySelector('#tnSlug').value = slugify(e.target.value); });
      wrap.querySelector('#tnCreate').addEventListener('click', async (e) => {
        const btn = e.currentTarget; btn.disabled = true;
        const r = await api({ action: 'create', name: wrap.querySelector('#tnName').value, slug: wrap.querySelector('#tnSlug').value, adminName: wrap.querySelector('#tnAdminName').value, adminEmail: wrap.querySelector('#tnAdminEmail').value });
        btn.disabled = false;
        if (!r.success) { wrap.querySelector('#tnErr').textContent = r.error || 'Could not create the tenant'; return; }
        close(); await load(); showCredentials(`${r.tenant.name} is ready`, r.tenant.url, r.admin);
      });
    });
  }

  function render() {
    $('tnBody').innerHTML = `<div class="mk-view"><div class="mk-list">${S.tenants.map((t) => `
      <div class="mk-card mk-site">
        <div>
          <div class="mk-main"><span class="mk-ico">${t.is_owner ? '★' : t.name.slice(0, 1).toUpperCase()}</span><div style="min-width:0">
            <p class="mk-name">${esc(t.name)} ${t.is_owner ? '<span class="mk-lock">Owner</span>' : ''} ${t.status === 'suspended' ? '<span class="mk-lock" style="color:#92400e;background:#fffbeb;border-color:#fde68a">Suspended</span>' : ''}</p>
            <div class="mk-meta"><span>${esc(t.slug)}.${BASE}</span>${t.is_owner ? '' : `<span>${t.users} user${t.users === 1 ? '' : 's'}</span><span>Last sign-in ${when(t.last_login_at)}</span><span>Created ${when(t.created_at)}</span>`}</div>
          </div></div>
        </div>
        <div class="mk-acts">
          <a class="ghost" href="${esc(t.url)}" target="_blank" rel="noopener">Open</a>
          ${t.is_owner ? '' : `<button type="button" class="ghost" data-act="reset" data-id="${t.id}">Reset admin password</button>
          <button type="button" class="ghost ${t.status === 'active' ? 'mk-btn-danger' : ''}" data-act="status" data-id="${t.id}">${t.status === 'active' ? 'Suspend' : 'Reactivate'}</button>`}
        </div>
      </div>`).join('')}</div>
      <p class="mk-note">New workspaces can sign in now. Their data modules switch on once per-tenant data separation is finished, so they cannot see i3MEDIA's data.</p></div>`;
  }

  async function onAction(act, id) {
    const t = S.tenants.find((x) => x.id === String(id) || Number(x.id) === id);
    if (!t) return;
    if (act === 'status') {
      const next = t.status === 'active' ? 'suspended' : 'active';
      if (next === 'suspended' && !confirm(`Suspend ${t.name}? Their users will not be able to sign in.`)) return;
      const r = await api({ action: 'set-status', id: t.id, status: next });
      if (r.success) await load(); else alert(r.error || 'Could not update');
    } else if (act === 'reset') {
      dialog(`<h3>Reset admin password for ${esc(t.name)}</h3><label>Admin email<input id="tnRe" type="email" autocomplete="off" /></label><div class="mk-err" id="tnErr"></div>
        <div class="mk-row"><button type="button" id="tnDoReset">Reset password</button><button type="button" class="ghost" data-close>Cancel</button></div>`, (wrap, close) => {
        wrap.querySelector('#tnDoReset').addEventListener('click', async () => {
          const r = await api({ action: 'reset-admin', id: t.id, email: wrap.querySelector('#tnRe').value });
          if (!r.success) { wrap.querySelector('#tnErr').textContent = r.error || 'Could not reset'; return; }
          close(); showCredentials('New temporary password', t.url, r.admin);
        });
      });
    }
  }

  async function load() {
    const data = await api();
    if (!data.success) { $('tnBody').innerHTML = `<p class="mk-note">${esc(data.error || 'Could not load tenants')}</p>`; return; }
    S.tenants = data.tenants; render();
  }

  SQ.init((caps) => {
    if (!caps.manageTenants) { $('tnBody').innerHTML = '<p class="mk-note">Only i3MEDIA admins can manage tenants.</p>'; $('tnNew').hidden = true; return; }
    $('tnNew').addEventListener('click', openCreate);
    $('tnBody').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) onAction(b.dataset.act, Number(b.dataset.id)); });
    load();
  });
})();
