(() => {
  const params = new URLSearchParams(window.location.search);
  const safeText = (v) => v ? v.replace(/[<>]/g, '').trim().slice(0, 120) : '';
  const attributionKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'msclkid'];
  const storageKey = 'i3_click_attribution_v1';
  const consentKey = 'i3_cookie_consent_v1';
  const consentValue = (() => { try { return localStorage.getItem(consentKey); } catch { return null; } })();
  const readAttribution = () => {
    try { return JSON.parse(sessionStorage.getItem(storageKey) || '{}'); } catch { return {}; }
  };
  const writeAttribution = (data) => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(data)); } catch { /* storage may be unavailable */ }
  };
  const storedAttribution = consentValue ? readAttribution() : {};
  const currentAttribution = Object.fromEntries(attributionKeys
    .filter((key) => params.get(key))
    .map((key) => [key, params.get(key).slice(0, 240)]));
  const attribution = { ...storedAttribution, ...currentAttribution };
  if (!attribution.original_landing_page && Object.keys(currentAttribution).length) attribution.original_landing_page = window.location.href.slice(0, 1000);
  if (!attribution.original_referrer && document.referrer) attribution.original_referrer = document.referrer.slice(0, 1000);
  if (consentValue === 'accepted') writeAttribution(attribution);
  const banner = document.querySelector('[data-consent-banner]');
  const setConsent = (value) => {
    try { localStorage.setItem(consentKey, value); } catch { /* local storage may be unavailable */ }
    banner?.setAttribute('hidden', '');
    if (value === 'accepted') writeAttribution(attribution);
  };
  if (banner && !consentValue) {
    banner.removeAttribute('hidden');
    banner.querySelector('[data-consent-accept]')?.addEventListener('click', () => setConsent('accepted'));
    banner.querySelector('[data-consent-essential]')?.addEventListener('click', () => setConsent('essential'));
  }
  const first = safeText(params.get('firstName') || params.get('first_name') || params.get('name'));
  const company = safeText(params.get('companyName') || params.get('company') || params.get('organisation'));

  document.querySelectorAll('[data-personalise="first-name"]').forEach((n) => { if (first) n.textContent = first; });
  document.querySelectorAll('[data-personalise="company-name"]').forEach((n) => { if (company) n.textContent = company; });
  document.querySelectorAll('[data-personalise-first-name-prefix]').forEach((n) => { n.textContent = first ? `${first},\u00a0` : ''; });
  document.querySelectorAll('[data-personalise-first-name-headline]').forEach((n) => { n.textContent = first ? 'make' : 'Make'; });
  document.querySelectorAll('[data-personalise-business]').forEach((n) => { if (company) n.textContent = company; });

  // Inject footer greeting when first name is present
  const greetingEl = document.querySelector('[data-personalise-greeting]');
  if (greetingEl && first) {
    greetingEl.textContent = `Hi ${first},`;
    greetingEl.style.cssText = 'font-weight:700;font-size:.95rem;color:var(--gold);margin:0 0 6px;font-family:"Bricolage Grotesque",sans-serif;';
  }

  // Derive page slug from pathname for source tagging
  const slug = window.location.pathname
    .replace(/^\/click-pages\//, '').replace(/\.html$/, '').replace(/^\//, '') || 'landing';
  const utmSource = attribution.utm_source || '';
  const campaign = attribution.utm_campaign || '';
  const medium = attribution.utm_medium || '';
  const pageSource = slug === 'growth' ? 'inbound' : `click-pages/${slug}${utmSource ? `:${utmSource}` : ''}`;

  // Wire up every landing form on the page
  const formSelectors = ['[data-landing-form]', '[data-landing-form-footer]', '[data-landing-form-footer2]'];
  formSelectors.forEach((sel) => {
    const form = document.querySelector(sel);
    if (!form) return;
    const status = form.querySelector('[data-form-status]');
    const submit = form.querySelector('button[type="submit"]');

    const srcField = form.querySelector('[name="source"]');
    if (srcField) srcField.value = pageSource;
    const campField = form.querySelector('[name="campaign"]');
    if (campField) campField.value = slug === 'growth' ? 'I3 Growth LP' : campaign;
    const medField = form.querySelector('[name="medium"]');
    if (medField) medField.value = medium;

    const fnField = form.elements.first_name;
    if (first && fnField && !fnField.value) fnField.value = first;
    const coField = form.elements.company;
    if (company && coField && !coField.value) coField.value = company;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (status) status.textContent = 'Sending…';
      if (submit) submit.disabled = true;
      const payload = {};
      new FormData(form).forEach((v, k) => { payload[k] = v; });
      payload.referrer = attribution.original_referrer || document.referrer || '';
      payload.referral_page = attribution.original_landing_page || window.location.href;
      attributionKeys.forEach((key) => { payload[key] = attribution[key] || ''; });
      // Expand select "message" field back to a string
      if (payload.message === '' || payload.message === undefined) delete payload.message;
      try {
        const response = await fetch('/api/landing-lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to send the form');
        form.reset();
        if (status) { status.className = 'form-status'; status.textContent = 'Thank you. We have received your details and will be in touch shortly.'; }
      } catch (error) {
        if (status) { status.className = 'form-status err'; status.textContent = error.message || 'Something went wrong. Please try again.'; }
        if (submit) submit.disabled = false;
      }
    });
  });
})();
