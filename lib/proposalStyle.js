/** Proposal style guide: brand fonts, palette and button treatment applied to every template. */

export const STYLE_COLOR_KEYS = ['ink', 'white', 'cream', 'soft', 'green', 'lime', 'lilac', 'peach'];
export const STYLE_ACCENTS = ['green', 'lime', 'lilac', 'peach'];
export const STYLE_HEROES = ['ink', 'cream', 'green', 'lime', 'lilac', 'peach'];
export const STYLE_SHAPES = ['pill', 'rounded', 'square'];
const FONT_HOSTS = ['use.typekit.net', 'fonts.googleapis.com', 'fonts.bunny.net'];

export const DEFAULT_STYLE = {
  fonts: { heading: 'Ivy Presto Display', body: 'DM Sans', stylesheetUrl: '', headingWeight: 400 },
  colors: {
    ink: '#111111', white: '#ffffff', cream: '#f6f3eb', soft: '#f5f3ea',
    green: '#c2e7b2', lime: '#ecff95', lilac: '#edc0ff', peach: '#ffae86',
  },
  hero: 'ink',
  buttons: { shape: 'pill', arrow: true, primaryHover: 'lilac', altHover: 'peach' },
};

const cleanFont = (value, fallback) => {
  const text = String(value ?? '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9 _-]{0,59}$/.test(text) ? text : fallback;
};
const cleanHex = (value, fallback) => {
  const text = String(value ?? '').trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback;
};
const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

// Only well-known font hosts: this URL is injected as a stylesheet on client-facing pages.
function cleanStylesheetUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && FONT_HOSTS.includes(url.hostname) ? url.toString().slice(0, 400) : '';
  } catch { return ''; }
}

export function sanitizeStyle(input) {
  const src = input && typeof input === 'object' ? input : {};
  const d = DEFAULT_STYLE;
  const colors = {};
  for (const key of STYLE_COLOR_KEYS) colors[key] = cleanHex(src.colors?.[key], d.colors[key]);
  const weight = Number(src.fonts?.headingWeight);
  return {
    fonts: {
      heading: cleanFont(src.fonts?.heading, d.fonts.heading),
      body: cleanFont(src.fonts?.body, d.fonts.body),
      stylesheetUrl: cleanStylesheetUrl(src.fonts?.stylesheetUrl),
      headingWeight: [400, 500, 600].includes(weight) ? weight : d.fonts.headingWeight,
    },
    colors,
    hero: pick(src.hero, STYLE_HEROES, d.hero),
    buttons: {
      shape: pick(src.buttons?.shape, STYLE_SHAPES, d.buttons.shape),
      arrow: src.buttons?.arrow === undefined ? d.buttons.arrow : src.buttons.arrow === true,
      primaryHover: pick(src.buttons?.primaryHover, STYLE_ACCENTS, d.buttons.primaryHover),
      altHover: pick(src.buttons?.altHover, STYLE_ACCENTS, d.buttons.altHover),
    },
  };
}

export async function getCurrentStyle(sql) {
  const rows = await sql`SELECT style FROM proposal_style WHERE id = 1`;
  return sanitizeStyle(rows[0]?.style);
}
