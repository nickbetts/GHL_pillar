(function () {
  document.documentElement.style.visibility = 'hidden';
  const next = location.pathname + location.search + location.hash;

  fetch('/api/sq-auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ action: 'me' }),
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (!data?.success || !data.caps?.isManager) {
        location.replace(`/login?next=${encodeURIComponent(next)}`);
        return;
      }
      document.documentElement.style.visibility = '';
      document.dispatchEvent(new CustomEvent('legacy-authenticated', { detail: data }));
    })
    .catch(() => location.replace(`/login?next=${encodeURIComponent(next)}`));
})();
