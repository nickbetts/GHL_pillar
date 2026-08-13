(() => {
  const params = new URLSearchParams(window.location.search);
  const safeText = (v) => v ? v.replace(/[<>]/g, '').trim().slice(0, 120) : '';
  const first = safeText(params.get('firstName') || params.get('first_name') || params.get('name'));
  const company = safeText(params.get('companyName') || params.get('company') || params.get('organisation'));

  document.querySelectorAll('[data-personalise="first-name"]').forEach((n) => { if (first) n.textContent = first; });
  document.querySelectorAll('[data-personalise="company-name"]').forEach((n) => { if (company) n.textContent = company; });

  // Inject footer greeting when first name is present
  const greetingEl = document.querySelector('[data-personalise-greeting]');
  if (greetingEl && first) {
    greetingEl.textContent = `Hi ${first},`;
    greetingEl.style.cssText = 'font-weight:700;font-size:.95rem;color:var(--gold);margin:0 0 6px;font-family:"Bricolage Grotesque",sans-serif;';
  }

  // Derive page slug from pathname for source tagging
  const slug = window.location.pathname
    .replace(/^\/click-pages\//, '').replace(/\.html$/, '').replace(/^\//, '') || 'landing';
  const utmSource = params.get('utm_source') || '';
  const campaign = params.get('utm_campaign') || '';
  const medium = params.get('utm_medium') || '';
  const pageSource = `click-pages/${slug}${utmSource ? `:${utmSource}` : ''}`;

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
    if (campField) campField.value = campaign;
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
        if (status) { status.className = 'form-status'; status.textContent = 'Done — we will be in touch shortly.'; }
      } catch (error) {
        if (status) { status.className = 'form-status err'; status.textContent = error.message || 'Something went wrong. Please try again.'; }
        if (submit) submit.disabled = false;
      }
    });
  });
})();
