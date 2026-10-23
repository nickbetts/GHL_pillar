/** The public viewer shell for /p/:slug. Static assets live in /pitch-view.css and /pitch-view.js. */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function shellHtml({ slug, clientName, found }) {
  const name = clientName || 'your business';
  const title = found ? `${name}: your new website preview` : 'Preview not found';
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex, nofollow" />
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(found ? `${name}, here\u2019s your new website` : title)}" />
<meta property="og:description" content="A redesign of your website, made for you by i3MEDIA. Tap to take a look." />
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary" />
<meta name="theme-color" content="#0b1020" />
<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" />
<link rel="stylesheet" href="/pitch-view.css" />
</head>
<body data-slug="${esc(slug)}"${found ? '' : ' data-missing="1"'}>
<div id="pv-root" aria-live="polite"></div>
<script src="/pitch-view.js" defer></script>
</body>
</html>`;
}
