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
  document.querySelectorAll('[data-personalise-first-name-prefix]').forEach((n) => { n.textContent = first ? `${first}, ` : ''; });
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
  const pageSource = `click-pages/${slug}${utmSource ? `:${utmSource}` : ''}`;
  let bookingToken = params.get('t') || '';

  function addBookingPicker(form) {
    if (!bookingToken || form.querySelector('[data-booking-picker]')) return null;
    const picker = document.createElement('div');
    picker.className = 'booking-picker';
    picker.dataset.bookingPicker = 'true';
    picker.innerHTML = '<div class="booking-head"><div><p class="booking-kicker">Step 2 of 2</p><p class="booking-title">Choose a time</p><p class="booking-owner" data-booking-owner></p></div><button type="button" class="booking-back" data-booking-back>Back</button></div><p class="booking-help">Choose a day first, then pick any available 30-minute slot.</p><div class="booking-days" data-booking-days></div><p class="booking-selected-label" data-booking-selected-label></p><div class="booking-slots" data-booking-slots></div>';
    form.querySelector('[data-form-status]')?.before(picker);
    picker.querySelector('[data-booking-back]').addEventListener('click', () => {
      form.classList.remove('booking-active');
      picker.classList.remove('show');
      form.querySelector('[data-form-status]').textContent = '';
      form.querySelector('button[type="submit"]').disabled = false;
    });
    return picker;
  }

  async function loadBookingSlots(form, picker, payload) {
    const status = form.querySelector('[data-form-status]');
    const days = picker.querySelector('[data-booking-days]');
    const slots = picker.querySelector('[data-booking-slots]');
    const selectedLabel = picker.querySelector('[data-booking-selected-label]');
    status.textContent = 'Loading your rep\'s available times...';
    picker.classList.add('show');
    try {
      const response = await fetch(`/api/landing-availability?t=${encodeURIComponent(bookingToken)}&days=14`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Availability is not available');
      picker.querySelector('[data-booking-owner]').textContent = `Booking with ${result.owner.name}`;
      const available = result.availability.filter((day) => day.slots.length);
      if (!available.length) throw new Error('There are no available times in the next two weeks');
      form.classList.add('booking-active');
      days.innerHTML = available.map((day, index) => `<button type="button" class="booking-day${index === 0 ? ' selected' : ''}" data-day="${day.date}"><strong>${new Date(`${day.date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })}</strong><span>${new Date(`${day.date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span><small>${day.slots.length} time${day.slots.length === 1 ? '' : 's'}</small></button>`).join('');
      const renderSlots = (date) => {
        const day = available.find((item) => item.date === date) || available[0];
        selectedLabel.textContent = new Date(`${day.date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
        slots.innerHTML = day.slots.map((slot) => `<button type="button" class="booking-slot" data-slot="${slot}">${new Date(slot).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</button>`).join('');
        slots.querySelectorAll('[data-slot]').forEach((button) => button.addEventListener('click', () => bookSlot(form, picker, payload, button.dataset.slot)));
      };
      days.querySelectorAll('[data-day]').forEach((button) => button.addEventListener('click', () => {
        days.querySelectorAll('[data-day]').forEach((dayButton) => dayButton.classList.remove('selected'));
        button.classList.add('selected');
        renderSlots(button.dataset.day);
      }));
      renderSlots(available[0].date);
      status.textContent = 'Select a time below.';
    } catch (error) {
      picker.classList.remove('show');
      form.classList.remove('booking-active');
      status.textContent = error.message;
      status.className = 'form-status err';
    }
  }

  async function bookSlot(form, picker, payload, slot) {
    const status = form.querySelector('[data-form-status]');
    picker.querySelectorAll('[data-slot]').forEach((button) => { button.disabled = true; });
    status.className = 'form-status';
    status.textContent = 'Booking your time...';
    try {
      const response = await fetch('/api/landing-book-meeting', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, token: bookingToken, slot }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'That time is no longer available');
      form.reset();
      picker.classList.remove('show');
      status.textContent = `Booked with ${result.owner}. We will be in touch to confirm the details.`;
    } catch (error) {
      status.className = 'form-status err';
      status.textContent = error.message;
      picker.querySelectorAll('[data-slot]').forEach((button) => { button.disabled = false; });
    }
  }

  // Wire up every landing form on the page
  const formSelectors = ['[data-landing-form]', '[data-landing-form-footer]', '[data-landing-form-footer2]'];
  formSelectors.forEach((sel) => {
    const form = document.querySelector(sel);
    if (!form) return;
    const status = form.querySelector('[data-form-status]');
    const submit = form.querySelector('button[type="submit"]');
    const picker = addBookingPicker(form);

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
      payload.referrer = attribution.original_referrer || document.referrer || '';
      payload.referral_page = attribution.original_landing_page || window.location.href;
      attributionKeys.forEach((key) => { payload[key] = attribution[key] || ''; });
      // Expand select "message" field back to a string
      if (payload.message === '' || payload.message === undefined) delete payload.message;
      try {
        if (bookingToken && picker) {
          await loadBookingSlots(form, picker, payload);
          if (submit) submit.disabled = false;
          return;
        }
        const response = await fetch('/api/landing-lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to send the form');
        if (result.bookingToken) {
          bookingToken = result.bookingToken;
          const bookingPicker = addBookingPicker(form);
          await loadBookingSlots(form, bookingPicker, payload);
          if (submit) submit.disabled = false;
          return;
        }
        form.reset();
        if (status) { status.className = 'form-status'; status.textContent = 'Done — we will be in touch shortly.'; }
      } catch (error) {
        if (status) { status.className = 'form-status err'; status.textContent = error.message || 'Something went wrong. Please try again.'; }
        if (submit) submit.disabled = false;
      }
    });
  });
})();
