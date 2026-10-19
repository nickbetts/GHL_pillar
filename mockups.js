/* Mockups: upload a website folder (admins), get a password-protected live link, manage the files. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
  const when = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const ICON = {
    site: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M7 6.5h.01M10 6.5h.01"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    lock: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  };

  const S = { sites: [], isAdmin: false, limits: { maxFileBytes: 20 * 1048576, maxSiteBytes: 120 * 1048576, maxFiles: 3000, minPassword: 6 }, used: 0 };
  const U = { prep: null, replaceId: null, name: '', password: '', busy: false, done: 0, total: 0, error: '', status: '', open: false };

  // ── Folder handling ─────────────────────────────────────────────────────
  const IGNORED_DIRS = new Set(['.git', 'node_modules', '__macosx', '.svn', '.idea', '.vscode']);
  function ignored(path) {
    const parts = path.split('/');
    const base = parts[parts.length - 1].toLowerCase();
    return parts.slice(0, -1).some((s) => IGNORED_DIRS.has(s.toLowerCase())) || base === '.ds_store' || base === 'thumbs.db' || base === 'desktop.ini' || base.startsWith('.env');
  }

  /** Turns a picked folder into the files to upload: drops junk, strips the wrapping folder, flags oversized files. */
  function prepareFiles(list, limits) {
    const skipped = [];
    let items = list.map(({ file, path }) => ({ file, path: String(path).replace(/\\/g, '/').replace(/^\/+/, '') }))
      .filter((it) => it.path && !ignored(it.path))
      .filter((it) => {
        if (it.file.size > limits.maxFileBytes) { skipped.push({ path: it.path, reason: `over ${Math.round(limits.maxFileBytes / 1048576)} MB` }); return false; }
        return true;
      });
    let folderName = '';
    const tops = new Set(items.map((i) => i.path.split('/')[0]));
    if (items.length && items.every((i) => i.path.includes('/')) && tops.size === 1) {
      folderName = [...tops][0];
      items = items.map((i) => ({ ...i, path: i.path.slice(folderName.length + 1) }));
    }
    // A build folder (dist/, public/...) holding the only index.html: serve that as the site root.
    if (!items.some((i) => i.path === 'index.html') && !items.some((i) => /^[^/]+\.html?$/i.test(i.path))) {
      const dirs = new Set(items.filter((i) => /^[^/]+\/index\.html$/.test(i.path)).map((i) => i.path.split('/')[0]));
      if (dirs.size === 1) {
        const dir = [...dirs][0];
        items = items.filter((i) => i.path.startsWith(`${dir}/`)).map((i) => ({ ...i, path: i.path.slice(dir.length + 1) }));
      }
    }
    return { items, skipped, folderName, totalBytes: items.reduce((s, i) => s + i.file.size, 0), hasIndex: items.some((i) => i.path === 'index.html') };
  }
  window.__mockupsPrepare = prepareFiles;

  async function filesFromDrop(dataTransfer) {
    const entries = [...dataTransfer.items].map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
    const out = [];
    const walk = async (entry, prefix) => {
      if (entry.isFile) {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        out.push({ file, path: prefix + entry.name });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
          for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
        } while (batch.length);
      }
    };
    for (const entry of entries) await walk(entry, '');
    return out;
  }

  // ── API ─────────────────────────────────────────────────────────────────
  async function api(body) {
    const res = await fetch('/api/mockups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
    return res.json().catch(() => ({ success: false, error: 'Request failed' }));
  }

  async function sendChunk(params, blob) {
    const q = new URLSearchParams({ action: 'upload', ...params }).toString();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const res = await fetch(`/api/mockups?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, credentials: 'same-origin', body: blob });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) return;
        if (res.status === 413 || res.status === 403 || res.status === 409) throw new Error(data.error || `Upload refused (${res.status})`);
      } catch (error) {
        if (attempt === 3 || /refused|limit|incomplete|open/.test(error.message)) throw error;
      }
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
    throw new Error('Upload failed after retries');
  }

  async function runUpload() {
    const prep = U.prep;
    U.error = '';
    if (!prep || !prep.items.length) { U.error = 'Choose a website folder first.'; return render(); }
    if (!U.replaceId && !U.name.trim()) { U.error = 'Give the site a name.'; return render(); }
    if ((!U.replaceId || U.password) && U.password.length < S.limits.minPassword) { U.error = `Password must be at least ${S.limits.minPassword} characters.`; return render(); }
    if (prep.totalBytes > S.limits.maxSiteBytes) { U.error = `That folder is ${bytes(prep.totalBytes)}, over the ${bytes(S.limits.maxSiteBytes)} limit.`; return render(); }
    if (prep.items.length > S.limits.maxFiles) { U.error = `That folder has ${prep.items.length} files; the limit is ${S.limits.maxFiles}.`; return render(); }

    U.busy = true; U.done = 0; U.total = prep.totalBytes || 1; U.status = 'Preparing…';
    render();
    const begin = await api({ action: 'begin', siteId: U.replaceId || undefined, name: U.name.trim(), password: U.password, folderName: prep.folderName });
    if (!begin.success) { U.busy = false; U.error = begin.error || 'Could not start the upload.'; return render(); }
    const { siteId, version, chunkBytes } = begin;
    try {
      const queue = prep.items.slice();
      let count = 0;
      const worker = async () => {
        while (queue.length) {
          const { file, path } = queue.shift();
          const total = Math.max(1, Math.ceil(file.size / chunkBytes));
          for (let seq = 0; seq < total; seq += 1) {
            const blob = file.slice(seq * chunkBytes, Math.min(file.size, (seq + 1) * chunkBytes));
            await sendChunk({ siteId, version, path, seq, total, size: file.size }, blob);
            U.done += blob.size;
          }
          count += 1;
          U.status = `Uploaded ${count} of ${prep.items.length} files`;
          renderProgress();
        }
      };
      await Promise.all(Array.from({ length: 5 }, worker));
      U.status = 'Finishing…'; renderProgress();
      const fin = await api({ action: 'finalize', siteId, version, expectedFiles: prep.items.length });
      if (!fin.success) throw new Error(fin.error || 'Could not finish the upload.');
      Object.assign(U, { prep: null, replaceId: null, name: '', password: '', busy: false, open: false, status: '' });
      await load();
      toast(`${fin.site.name} is live`);
    } catch (error) {
      await api({ action: 'abort', siteId, version });
      U.busy = false; U.error = error.message || 'The upload failed. Nothing was changed.';
      render();
    }
  }

  // ── Rendering ───────────────────────────────────────────────────────────
  function toast(message) {
    const el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:9999;padding:10px 14px;border-radius:8px;background:#111827;color:#fff;font:500 13px Inter,system-ui,sans-serif;box-shadow:0 8px 24px rgba(17,24,39,.2)';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  function uploadPanel() {
    if (!S.isAdmin || !U.open) return '';
    const replacing = U.replaceId ? S.sites.find((s) => s.id === U.replaceId) : null;
    const prep = U.prep;
    const summary = prep ? `<div class="mk-sum"><div><b>${prep.folderName ? esc(prep.folderName) : 'Selected folder'}</b>: ${prep.items.length} files, ${bytes(prep.totalBytes)}</div>
        <div>${prep.hasIndex ? 'Home page: index.html' : '<span class="warn">No index.html found at the top level. Check you picked the website folder itself.</span>'}</div>
        ${prep.skipped.length ? `<div class="warn">${prep.skipped.length} file${prep.skipped.length === 1 ? '' : 's'} skipped: ${esc(prep.skipped.slice(0, 3).map((s) => `${s.path} (${s.reason})`).join(', '))}${prep.skipped.length > 3 ? '…' : ''}</div>` : ''}</div>` : '';
    const progress = U.busy ? `<div class="mk-prog"><div class="mk-bar"><i style="width:${Math.min(100, Math.round((U.done / U.total) * 100))}%"></i></div><div id="mkStatus">${esc(U.status)}</div></div>` : '';
    return `<section class="mk-card mk-up">
      <div class="mk-head"><h2>${replacing ? `Replace the files for ${esc(replacing.name)}` : 'Upload a website'}</h2><button type="button" class="ghost" id="mkCancel" ${U.busy ? 'disabled' : ''}>Cancel</button></div>
      <div class="mk-drop" id="mkDrop">${ICON.folder}<b>Drop the website folder here</b><span>or</span>
        <button type="button" class="ghost" id="mkPick" ${U.busy ? 'disabled' : ''}>Choose folder</button>
        <span>The folder needs an index.html. Up to ${bytes(S.limits.maxSiteBytes)} per site, ${bytes(S.limits.maxFileBytes)} per file.</span>
        <input type="file" id="mkInput" webkitdirectory multiple hidden /></div>
      ${summary}
      <div class="mk-form">
        ${replacing ? '' : `<label>Site name<input id="mkName" value="${esc(U.name)}" maxlength="80" placeholder="e.g. Northwind homepage redesign" ${U.busy ? 'disabled' : ''} /></label>`}
        <label>${replacing ? 'New password (leave blank to keep the current one)' : 'Password for the link'}<div class="mk-pw"><input id="mkPw" type="text" value="${esc(U.password)}" autocomplete="off" placeholder="At least ${S.limits.minPassword} characters" ${U.busy ? 'disabled' : ''} /><button type="button" class="ghost" id="mkGen" ${U.busy ? 'disabled' : ''}>Generate</button></div></label>
      </div>
      ${U.error ? `<div class="mk-err" role="alert">${esc(U.error)}</div>` : ''}
      ${progress}
      <div class="mk-row"><button type="button" id="mkGo" ${U.busy || !prep ? 'disabled' : ''}>${U.busy ? 'Uploading…' : replacing ? 'Replace files' : 'Upload and create link'}</button>
        <span class="mk-note">Replacing never breaks the live link: the new files go live only once every file has uploaded.</span></div>
    </section>`;
  }

  function siteCard(site) {
    const fullUrl = `${location.origin}${site.url}`;
    const admin = S.isAdmin ? `
        <button type="button" class="ghost" data-act="replace" data-id="${site.id}">Replace files</button>
        <button type="button" class="ghost" data-act="password" data-id="${site.id}">Password</button>
        <button type="button" class="ghost" data-act="rename" data-id="${site.id}">Rename</button>
        <button type="button" class="ghost mk-btn-danger" data-act="delete" data-id="${site.id}">Delete</button>` : '';
    return `<article class="mk-card mk-site">
      <div class="mk-main"><div class="mk-ico">${ICON.site}</div>
        <div style="min-width:0"><h3 class="mk-name" title="${esc(site.name)}">${esc(site.name)}</h3>
          <div class="mk-meta"><span>${site.fileCount} files · ${bytes(site.totalBytes)}</span><span>${site.viewCount} view${site.viewCount === 1 ? '' : 's'}</span><span>Added ${esc(when(site.createdAt))}${site.createdByName ? ` by ${esc(site.createdByName)}` : ''}</span></div>
          <div class="mk-link"><span class="mk-lock">${ICON.lock}Password protected</span><code title="${esc(fullUrl)}">${esc(fullUrl)}</code></div></div></div>
      <div class="mk-acts">
        <a class="btn" href="${esc(site.url)}" target="_blank" rel="noopener">Open</a>
        <button type="button" class="ghost" data-act="copy" data-id="${site.id}">Copy link</button>
        <button type="button" class="ghost" data-act="files" data-id="${site.id}">Files</button>${admin}
      </div></article>`;
  }

  function render() {
    $('mkNew').hidden = !S.isAdmin || U.open;
    const list = S.sites.length
      ? `<div class="mk-list">${S.sites.map(siteCard).join('')}</div>`
      : `<div class="mk-card mk-empty">No mockups yet.${S.isAdmin ? ' Use “Upload a website” to add the first one.' : ''}</div>`;
    $('mkBody').innerHTML = `<div class="mk-view">${uploadPanel()}
      <div class="mk-head"><h2>Live mockups</h2><span class="mk-note">${S.sites.length} site${S.sites.length === 1 ? '' : 's'} · ${bytes(S.used)} stored</span></div>${list}</div>`;
    bindUpload();
  }
  function renderProgress() {
    const bar = document.querySelector('.mk-bar i'); if (bar) bar.style.width = `${Math.min(100, Math.round((U.done / U.total) * 100))}%`;
    const st = $('mkStatus'); if (st) st.textContent = U.status;
  }

  function bindUpload() {
    const drop = $('mkDrop'); if (!drop) return;
    const accept = (list) => { U.prep = prepareFiles(list, S.limits); if (!U.name && U.prep.folderName && !U.replaceId) U.name = U.prep.folderName; U.error = U.prep.items.length ? '' : 'No website files found in that folder.'; render(); };
    $('mkPick').addEventListener('click', () => $('mkInput').click());
    $('mkInput').addEventListener('change', (e) => accept([...e.target.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name }))));
    ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', async (e) => { const dt = e.dataTransfer; accept(await filesFromDrop(dt)); });
    $('mkName')?.addEventListener('input', (e) => { U.name = e.target.value; });
    $('mkPw').addEventListener('input', (e) => { U.password = e.target.value; });
    $('mkGen').addEventListener('click', () => { U.password = generatePassword(); $('mkPw').value = U.password; });
    $('mkGo').addEventListener('click', runUpload);
    $('mkCancel').addEventListener('click', () => { Object.assign(U, { open: false, prep: null, replaceId: null, name: '', password: '', error: '' }); render(); });
  }

  function generatePassword() {
    const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const buf = new Uint32Array(12); crypto.getRandomValues(buf);
    return [...buf].map((n) => alphabet[n % alphabet.length]).join('');
  }

  // ── Dialogs ─────────────────────────────────────────────────────────────
  function dialog(title, inner, onMount) {
    const wrap = document.createElement('div');
    wrap.className = 'mk-modal';
    wrap.innerHTML = `<div class="mk-modal-box" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${inner}</div>`;
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
    document.body.appendChild(wrap);
    onMount?.(wrap, close);
    return wrap;
  }

  async function onAction(act, id) {
    const site = S.sites.find((s) => s.id === id);
    if (!site) return;
    if (act === 'copy') {
      try { await navigator.clipboard.writeText(`${location.origin}${site.url}`); toast('Link copied'); } catch { toast('Copy failed, select the link and copy it'); }
    } else if (act === 'files') {
      dialog(`${site.name}: files`, '<div class="mk-note">Loading…</div><div class="mk-row"><button type="button" class="ghost" data-close>Close</button></div>', async (wrap) => {
        const data = await api({ action: 'files', id });
        const list = data.success ? data.files.map((f) => `<div><span>${esc(f.path)}</span><span>${bytes(f.size)}</span></div>`).join('') : '';
        wrap.querySelector('.mk-note').outerHTML = data.success ? `<div class="mk-files">${list || '<div>No files</div>'}</div>` : `<div class="mk-err">${esc(data.error || 'Could not load files')}</div>`;
      });
    } else if (act === 'replace') {
      Object.assign(U, { open: true, replaceId: id, prep: null, name: '', password: '', error: '' }); render(); window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (act === 'password') {
      dialog(`New password for ${site.name}`, `<p>Anyone who has the old password will need the new one. Existing sessions are signed out.</p>
        <label>New password<div class="mk-pw"><input id="mkNewPw" type="text" autocomplete="off" placeholder="At least ${S.limits.minPassword} characters" /><button type="button" class="ghost" id="mkNewGen">Generate</button></div></label>
        <div class="mk-err" id="mkDlgErr"></div><div class="mk-row"><button type="button" id="mkSavePw">Save password</button><button type="button" class="ghost" data-close>Cancel</button></div>`, (wrap, close) => {
        wrap.querySelector('#mkNewGen').addEventListener('click', () => { wrap.querySelector('#mkNewPw').value = generatePassword(); });
        wrap.querySelector('#mkSavePw').addEventListener('click', async () => {
          const r = await api({ action: 'set-password', id, password: wrap.querySelector('#mkNewPw').value });
          if (r.success) { close(); toast('Password updated'); } else wrap.querySelector('#mkDlgErr').textContent = r.error || 'Could not save';
        });
      });
    } else if (act === 'rename') {
      dialog('Rename', `<label>Site name<input id="mkRn" value="${esc(site.name)}" maxlength="80" /></label><div class="mk-err" id="mkDlgErr"></div>
        <div class="mk-row"><button type="button" id="mkSaveRn">Save</button><button type="button" class="ghost" data-close>Cancel</button></div>`, (wrap, close) => {
        wrap.querySelector('#mkSaveRn').addEventListener('click', async () => {
          const r = await api({ action: 'rename', id, name: wrap.querySelector('#mkRn').value });
          if (r.success) { close(); await load(); } else wrap.querySelector('#mkDlgErr').textContent = r.error || 'Could not save';
        });
      });
    } else if (act === 'delete') {
      dialog(`Delete ${site.name}?`, `<p>The link stops working straight away and all ${site.fileCount} files are removed. This can't be undone.</p><div class="mk-err" id="mkDlgErr"></div>
        <div class="mk-row"><button type="button" class="mk-btn-danger" id="mkDoDelete">Delete site</button><button type="button" class="ghost" data-close>Cancel</button></div>`, (wrap, close) => {
        wrap.querySelector('#mkDoDelete').addEventListener('click', async () => {
          const r = await api({ action: 'delete', id });
          if (r.success) { close(); await load(); toast('Deleted'); } else wrap.querySelector('#mkDlgErr').textContent = r.error || 'Could not delete';
        });
      });
    }
  }

  async function load() {
    const res = await fetch('/api/mockups', { credentials: 'same-origin' });
    if (res.status === 401) { location.href = '/login?next=/mockups'; return; }
    const data = await res.json().catch(() => ({ success: false }));
    if (!data.success) { $('mkBody').innerHTML = `<p class="mk-note">${esc(data.error || 'Could not load mockups')}</p>`; return; }
    Object.assign(S, { sites: data.sites, isAdmin: !!data.isAdmin, used: data.usedBytes || 0, limits: { ...S.limits, ...data.limits } });
    render();
  }

  SQ.init(() => {
    $('mkNew').addEventListener('click', () => { Object.assign(U, { open: true, replaceId: null, prep: null, name: '', password: '', error: '' }); render(); });
    $('mkBody').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) onAction(b.dataset.act, Number(b.dataset.id)); });
    load();
  });
})();
