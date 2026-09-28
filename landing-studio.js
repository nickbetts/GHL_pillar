const $ = (id) => document.getElementById(id);
const state = { pages:[], slug:'', html:'', publishedHtml:'', version:0, history:[], busy:false };
let previewTimer;
let noticeTimer;

async function request(action, { slug = state.slug, ...body } = {}, method = 'GET') {
  const params = new URLSearchParams({ action, slug });
  if (action === 'revision') params.set('version', String(body.version));
  const url = `/api/landing-studio?${params}`;
  const response = await fetch(method === 'GET' ? url : '/api/landing-studio', {
    method,
    credentials:'same-origin',
    headers:method === 'POST' ? { 'Content-Type':'application/json' } : {},
    ...(method === 'POST' ? { body:JSON.stringify({ action, slug, ...body }) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function notice(text, error = false) {
  clearTimeout(noticeTimer);
  $('studioStatus').textContent = text;
  $('studioStatus').classList.toggle('error', error);
  noticeTimer = setTimeout(() => { $('studioStatus').textContent = ''; }, 5500);
}

function busy(value) {
  state.busy = value;
  $('pageSelect').disabled = value;
  $('htmlEditor').disabled = value;
  $('sendBtn').disabled = value;
  $('revisionSelect').disabled = value;
  updateDirty();
}

function updateDirty() {
  const dirty = state.html !== state.publishedHtml;
  $('dirtyFlag').hidden = !dirty;
  $('publishBtn').disabled = state.busy || !dirty;
  $('version').textContent = `${state.version ? `Published v${state.version}` : 'Source page'}${dirty ? ' · draft' : ''}`;
}

function renderPreview() {
  $('previewFrame').srcdoc = state.html;
}

function setHtml(html) {
  state.html = html;
  $('htmlEditor').value = html;
  updateDirty();
  renderPreview();
}

function addMessage(kind, text) {
  $('chatLog').querySelector('.studio-empty')?.remove();
  const message = document.createElement('div');
  message.className = `studio-message ${kind}`;
  message.textContent = text;
  $('chatLog').appendChild(message);
  message.scrollIntoView({ block:'end' });
}

function confirmDiscard() {
  return state.html === state.publishedHtml || confirm('Discard your unpublished changes to this page?');
}

async function openPage(slug) {
  const page = state.pages.find((item) => item.slug === slug);
  if (!page) return;
  busy(true);
  try {
    const data = await request('get', { slug });
    state.slug = slug;
    state.version = data.version;
    state.publishedHtml = data.html;
    state.history = [];
    $('chatLog').replaceChildren();
    addMessage('assistant', `Editing ${page.name}. Changes stay in your draft until you publish.`);
    $('pageSelect').value = slug;
    $('previewTitle').textContent = page.name;
    $('liveLink').href = `https://click.i3media.net${page.route}`;
    $('revisionSelect').innerHTML = `<option value="">Current ${data.version ? `(v${data.version})` : '(source)'}</option><option value="0">Original source</option>`;
    for (const revision of data.revisions || []) {
      const option = new Option(`v${revision.version} · ${new Date(revision.published_at).toLocaleDateString('en-GB')}`, String(revision.version));
      $('revisionSelect').add(option);
    }
    setHtml(data.html);
    history.replaceState(null, '', `/landing-studio?page=${encodeURIComponent(slug)}`);
  } catch (error) {
    notice(error.message, true);
    if (!state.slug) $('studioGate').textContent = `Could not load pages: ${error.message}`;
  } finally {
    busy(false);
  }
}

$('pageSelect').addEventListener('change', (event) => {
  const selected = event.target.value;
  if (!confirmDiscard()) { event.target.value = state.slug; return; }
  openPage(selected);
});

$('htmlEditor').addEventListener('input', (event) => {
  state.html = event.target.value;
  updateDirty();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 500);
});

document.querySelectorAll('[data-width]').forEach((button) => button.addEventListener('click', () => {
  const mobile = button.dataset.width === 'mobile';
  $('previewFrame').classList.toggle('mobile', mobile);
  document.querySelectorAll('[data-width]').forEach((item) => {
    const selected = item === button;
    item.classList.toggle('on', selected);
    item.setAttribute('aria-pressed', String(selected));
  });
}));

$('revisionSelect').addEventListener('change', async (event) => {
  const version = event.target.value;
  if (!confirmDiscard()) { event.target.value = ''; return; }
  if (!version) { setHtml(state.publishedHtml); return; }
  busy(true);
  try {
    const data = await request('revision', { slug:state.slug, version });
    setHtml(data.html);
    notice(`Loaded ${Number(version) === 0 ? 'original source' : `v${version}`} into your draft. Publish to restore it live.`);
  } catch (error) { notice(error.message, true); event.target.value = ''; }
  finally { busy(false); }
});

$('clearChat').addEventListener('click', () => {
  state.history = [];
  $('chatLog').innerHTML = '<p class="studio-empty">Chat cleared. Your HTML draft is unchanged.</p>';
});

$('chatForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const instruction = $('instruction').value.trim();
  if (!instruction || state.busy) return;
  addMessage('user', instruction);
  $('instruction').value = '';
  busy(true);
  $('sendBtn').textContent = 'Generating…';
  try {
    const data = await request('chat', { html:state.html, instruction, history:state.history }, 'POST');
    setHtml(data.html);
    state.history.push({ role:'user', content:instruction }, { role:'assistant', content:data.summary });
    addMessage('assistant', `${data.summary}\n\nUpdated the HTML draft and preview. Review before publishing.`);
  } catch (error) { addMessage('error', error.message); }
  finally { busy(false); $('sendBtn').textContent = 'Generate edit'; }
});

$('publishBtn').addEventListener('click', async () => {
  if (state.busy || state.html === state.publishedHtml) return;
  const page = state.pages.find((item) => item.slug === state.slug);
  if (!confirm(`Publish these HTML changes to ${page.name} (${page.route})? This updates the live landing page.`)) return;
  busy(true);
  try {
    const data = await request('publish', { html:state.html, baseVersion:state.version }, 'POST');
    state.publishedHtml = state.html;
    state.version = data.version;
    notice(`Published v${data.version}. The live page now uses this HTML.`);
    await openPage(state.slug);
  } catch (error) { notice(error.message, true); }
  finally { busy(false); }
});

window.addEventListener('beforeunload', (event) => {
  if (state.html && state.html !== state.publishedHtml) { event.preventDefault(); event.returnValue = ''; }
});

SQ.init(async (caps) => {
  if (!caps?.isAdmin || SQ.user?.impersonating) { $('studioGate').textContent = 'Admin access required.'; return; }
  try {
    const data = await request('list');
    state.pages = data.pages;
    $('pageSelect').innerHTML = '';
    data.pages.forEach((page) => $('pageSelect').add(new Option(page.name, page.slug)));
    $('studioGate').hidden = true;
    $('studio').hidden = false;
    const requested = new URLSearchParams(location.search).get('page');
    await openPage(data.pages.some((page) => page.slug === requested) ? requested : 'growth');
  } catch (error) { $('studioGate').textContent = `Could not open Landing Studio: ${error.message}`; }
});