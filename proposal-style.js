/* Proposal style guide runtime: validates a style object, sets the CSS variables and loads the fonts. */
(function () {
  const COLOR_KEYS = ['ink', 'white', 'cream', 'soft', 'green', 'lime', 'lilac', 'peach'];
  const ACCENTS = ['green', 'lime', 'lilac', 'peach'];
  const HEROES = ['ink', 'cream', 'green', 'lime', 'lilac', 'peach'];
  const SHAPES = { pill: { btn: '999px', card: '22px' }, rounded: { btn: '14px', card: '14px' }, square: { btn: '3px', card: '3px' } };
  const FONT_HOSTS = ['use.typekit.net', 'fonts.googleapis.com', 'fonts.bunny.net'];

  const DEFAULT = {
    fonts: { heading: 'Ivy Presto Display', body: 'DM Sans', stylesheetUrl: '', headingWeight: 400 },
    colors: { ink: '#111111', white: '#ffffff', cream: '#f6f3eb', soft: '#f5f3ea', green: '#c2e7b2', lime: '#ecff95', lilac: '#edc0ff', peach: '#ffae86' },
    hero: 'ink',
    buttons: { shape: 'pill', arrow: true, primaryHover: 'lilac', altHover: 'peach' },
  };

  const font = (v, d) => (/^[A-Za-z0-9][A-Za-z0-9 _-]{0,59}$/.test(String(v ?? '').trim()) ? String(v).trim() : d);
  const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v ?? '').trim()) ? String(v).trim().toLowerCase() : d);
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  function sheet(v) {
    try { const u = new URL(String(v || '').trim()); return u.protocol === 'https:' && FONT_HOSTS.includes(u.hostname) ? u.toString() : ''; } catch { return ''; }
  }

  function normalize(input) {
    const s = input && typeof input === 'object' ? input : {};
    const colors = {};
    COLOR_KEYS.forEach((k) => { colors[k] = hex(s.colors && s.colors[k], DEFAULT.colors[k]); });
    const w = Number(s.fonts && s.fonts.headingWeight);
    return {
      fonts: {
        heading: font(s.fonts && s.fonts.heading, DEFAULT.fonts.heading),
        body: font(s.fonts && s.fonts.body, DEFAULT.fonts.body),
        stylesheetUrl: sheet(s.fonts && s.fonts.stylesheetUrl),
        headingWeight: [400, 500, 600].includes(w) ? w : 400,
      },
      colors,
      hero: pick(s.hero, HEROES, DEFAULT.hero),
      buttons: {
        shape: pick(s.buttons && s.buttons.shape, Object.keys(SHAPES), 'pill'),
        arrow: !s.buttons || s.buttons.arrow === undefined ? true : s.buttons.arrow === true,
        primaryHover: pick(s.buttons && s.buttons.primaryHover, ACCENTS, 'lilac'),
        altHover: pick(s.buttons && s.buttons.altHover, ACCENTS, 'peach'),
      },
    };
  }

  function luminance(h) {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  const onColor = (h) => (luminance(h) > 0.42 ? '#111111' : '#ffffff');

  const SERIF = /ivy|presto|playfair|garamond|georgia|serif|times|cormorant|lora|merriweather|caslon|baskerville|didot|bodoni/i;
  function stack(name, role) {
    const names = [`"${name}"`];
    if (/ivy\s*presto/i.test(name)) names.push('"ivypresto-display"', '"Playfair Display"');
    return `${names.join(', ')}, ${role === 'head' && SERIF.test(name) ? 'Georgia, serif' : 'system-ui, sans-serif'}`;
  }

  function apply(el, input) {
    const s = normalize(input);
    const set = (k, v) => el.style.setProperty(k, v);
    COLOR_KEYS.forEach((k) => { set(`--${k}`, s.colors[k]); set(`--on-${k}`, onColor(s.colors[k])); });
    set('--hero-bg', s.colors[s.hero]);
    set('--on-hero', onColor(s.colors[s.hero]));
    set('--font-head', stack(s.fonts.heading, 'head'));
    set('--font-body', stack(s.fonts.body, 'body'));
    set('--head-weight', String(s.fonts.headingWeight));
    set('--btn-radius', SHAPES[s.buttons.shape].btn);
    set('--card-radius', SHAPES[s.buttons.shape].card);
    set('--btn-hover', s.colors[s.buttons.primaryHover]);
    set('--on-btn-hover', onColor(s.colors[s.buttons.primaryHover]));
    set('--btn-alt-hover', s.colors[s.buttons.altHover]);
    set('--on-alt-hover', onColor(s.colors[s.buttons.altHover]));
    document.documentElement.dataset.arrow = s.buttons.arrow ? 'on' : 'off';
    loadFonts(s);
    return s;
  }

  function link(id, href) {
    let el = document.getElementById(id);
    if (el && el.getAttribute('href') === href) return;
    if (!el) { el = document.createElement('link'); el.id = id; el.rel = 'stylesheet'; document.head.appendChild(el); }
    el.href = href;
  }
  function loadFonts(s) {
    [['body', s.fonts.body], ['head', s.fonts.heading]].forEach(([role, name]) => {
      if (/ivy\s*presto/i.test(name)) return;
      link(`ps-font-${role}`, `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, '+')}:wght@400;500;600;700&display=swap`);
    });
    link('ps-font-fallback', 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600&display=swap');
    if (s.fonts.stylesheetUrl) link('ps-font-custom', s.fonts.stylesheetUrl);
    else document.getElementById('ps-font-custom')?.remove();
  }

  window.ProposalStyle = { DEFAULT, COLOR_KEYS, ACCENTS, HEROES, normalize, apply, onColor };
}());
