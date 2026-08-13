(() => {
  const params = new URLSearchParams(window.location.search);
  const firstName = params.get('firstName') || params.get('first_name') || params.get('name');
  const companyName = params.get('companyName') || params.get('company') || params.get('organisation');
  const safeText = (value) => value ? value.replace(/[<>]/g, '').trim().slice(0, 120) : '';
  const first = safeText(firstName);
  const company = safeText(companyName);

  document.querySelectorAll('[data-personalise="first-name"]').forEach((node) => {
    if (first) node.textContent = first;
  });
  document.querySelectorAll('[data-personalise="company-name"]').forEach((node) => {
    if (company) node.textContent = company;
  });

  const form = document.querySelector('[data-landing-form]');
  if (!form) return;
  const status = form.querySelector('[data-form-status]');
  const submit = form.querySelector('button[type="submit"]');
  const source = params.get('utm_source') || '';
  const campaign = params.get('utm_campaign') || '';
  const medium = params.get('utm_medium') || '';

  form.querySelector('[name="source"]').value = `click-pages/charity-marketing${source ? `:${source}` : ''}`;
  form.querySelector('[name="campaign"]').value = campaign;
  form.querySelector('[name="medium"]').value = medium;
  if (first && !form.elements.first_name.value) form.elements.first_name.value = first;
  if (company && !form.elements.company.value) form.elements.company.value = company;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = 'Sending your request...';
    submit.disabled = true;
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      const response = await fetch('/api/landing-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to send the form');
      form.reset();
      status.textContent = 'Thanks. We will be in touch shortly.';
    } catch (error) {
      status.textContent = error.message || 'Something went wrong. Please try again.';
      submit.disabled = false;
    }
  });
})();
