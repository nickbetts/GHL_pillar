// Shared by brand/stream-wave-playground.html and scripts/build-stream-wave-logo.mjs; a classic script so it loads from file://.
(function (root) {
  const DEFAULTS = {
    amplitude: 4, wavelength: 32, duration: 2.4, direction: 1, speedVariation: 0,
    shape: 'sine', sharpness: 3,
    layer2Amount: 0, layer2Scale: 0.5, layer2Speed: 1,
    pinned: true, falloff: 1, taper: 0, twist: 0, pieces: 'middle',
    segmentColor: '#ffffff', tileColor: '#4463ff', shimmer: 0, shimmerSize: 40,
    frames: 24, density: 8,
  };
  const CHOICES = { shape: ['sine', 'triangle', 'square', 'peaks'], pieces: ['middle', 'all'], direction: [1, -1] };
  const PATH_RE = /<path\b[^>]*?\bd="([^"]+)"[^>]*?\bfill="([^"]+)"[^>]*?\/>/g;

  function normalize(input = {}) {
    const s = {};
    for (const [key, fallback] of Object.entries(DEFAULTS)) {
      const value = input[key];
      if (CHOICES[key]) s[key] = CHOICES[key].find((choice) => String(choice) === String(value)) ?? fallback;
      else if (typeof fallback === 'boolean') s[key] = value === undefined ? fallback : Boolean(value);
      else if (typeof fallback === 'number') s[key] = Number.isFinite(Number(value)) && value !== '' && value !== null ? Number(value) : fallback;
      else s[key] = /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value).toLowerCase() : fallback;
    }
    s.wavelength = Math.max(1, s.wavelength);
    s.layer2Scale = Math.max(0.05, s.layer2Scale);
    s.layer2Speed = Math.max(1, Math.round(s.layer2Speed));
    s.frames = Math.max(2, Math.round(s.frames));
    s.density = Math.max(1, Math.round(s.density));
    s.duration = Math.max(0.1, s.duration);
    return s;
  }

  function sample(d, perCurve) {
    const tokens = d.match(/[MCLZ]|-?\d*\.?\d+/g);
    const points = [];
    let i = 0;
    let cur = null;
    const num = () => Number(tokens[i++]);
    while (i < tokens.length) {
      const cmd = tokens[i++];
      if (cmd === 'M') { cur = [num(), num()]; points.push(cur); }
      else if (cmd === 'L') {
        const end = [num(), num()];
        for (let step = 1; step <= 4; step++) points.push([cur[0] + (end[0] - cur[0]) * step / 4, cur[1] + (end[1] - cur[1]) * step / 4]);
        cur = end;
      } else if (cmd === 'C') {
        const a = [num(), num()]; const b = [num(), num()]; const end = [num(), num()];
        for (let step = 1; step <= perCurve; step++) {
          const u = step / perCurve; const v = 1 - u;
          points.push([0, 1].map((k) => v * v * v * cur[k] + 3 * v * v * u * a[k] + 3 * v * u * u * b[k] + u * u * u * end[k]));
        }
        cur = end;
      } else if (cmd === 'Z') break;
    }
    points.pop();
    return points;
  }

  function whitePaths(source) {
    return [...source.matchAll(PATH_RE)].map((m) => ({ tag: m[0], d: m[1], fill: m[2] })).filter((p) => p.fill.toLowerCase() === 'white');
  }

  function prepare(source, settings) {
    const s = normalize(settings);
    const whites = whitePaths(source);
    const pieces = (s.pieces === 'all' ? whites : whites.slice(0, 1)).map((p) => ({ ...p, points: sample(p.d, s.density) }));
    const all = pieces.flatMap((p) => p.points);
    const xs = all.map(([x]) => x);
    const ys = all.map(([, y]) => y);
    return { s, whites, pieces, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }

  function wave(t, s) {
    if (s.shape === 'sine') return Math.sin(2 * Math.PI * t);
    const x = t - Math.floor(t);
    if (s.shape === 'triangle') return 1 - 4 * Math.abs(((x + 0.25) % 1) - 0.5);
    const v = Math.sin(2 * Math.PI * x);
    if (s.shape === 'square') return Math.tanh(s.sharpness * v) / Math.tanh(s.sharpness);
    return Math.sign(v) * Math.pow(Math.abs(v), s.sharpness);
  }

  const round = (v) => Math.round(v * 100) / 100;

  function shapeAt(model, phase) {
    const { s, minX, maxX, minY, maxY } = model;
    const p = phase + (s.speedVariation / (2 * Math.PI)) * Math.sin(2 * Math.PI * phase);
    return model.pieces.map(({ points }) => `M${points.map(([x, y]) => {
      const ny = (y - minY) / (maxY - minY);
      const nx = maxX > minX ? (x - minX) / (maxX - minX) : 0;
      const envelope = s.pinned ? Math.pow(Math.sin(Math.PI * ny), s.falloff) : 1;
      const taper = 1 + s.taper * (2 * ny - 1);
      const main = wave((y - minY) / s.wavelength + s.twist * nx - p * s.direction, s);
      const extra = s.layer2Amount ? s.layer2Amount * wave((y - minY) / (s.wavelength * s.layer2Scale) - p * s.direction * s.layer2Speed, s) : 0;
      return `${round(x + s.amplitude * envelope * taper * (main + extra))} ${round(y)}`;
    }).join('L')}Z`);
  }

  function mix(a, b, amount) {
    const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [ca, cb] = [channels(a), channels(b)];
    return `#${ca.map((c, i) => Math.round(c + (cb[i] - c) * amount).toString(16).padStart(2, '0')).join('')}`;
  }

  function shimmerStops(s) {
    return { base: s.segmentColor, tint: mix(s.segmentColor, s.tileColor, s.shimmer * 0.6) };
  }

  function build(source, settings) {
    const model = prepare(source, settings);
    const { s } = model;
    const frames = Array.from({ length: s.frames + 1 }, (_, k) => shapeAt(model, (k % s.frames) / s.frames));
    let out = source;
    model.pieces.forEach((piece, index) => {
      const values = frames.map((set) => set[index]);
      out = out.replace(piece.tag, `<path d="${values[0]}" fill="white">\n  <animate attributeName="d" dur="${s.duration}s" repeatCount="indefinite" calcMode="linear" values="${values.join(';')}"/>\n</path>`);
    });
    let defs = '';
    if (s.shimmer > 0) {
      const { base, tint } = shimmerStops(s);
      defs = `\n<defs><linearGradient id="stream-shimmer" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${s.shimmerSize}" spreadMethod="repeat"><stop offset="0" stop-color="${base}"/><stop offset=".5" stop-color="${tint}"/><stop offset="1" stop-color="${base}"/><animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="0 ${s.shimmerSize * s.direction}" dur="${s.duration}s" repeatCount="indefinite"/></linearGradient></defs>`;
      out = out.replaceAll('fill="white"', 'fill="url(#stream-shimmer)"');
    } else if (s.segmentColor !== '#ffffff') {
      out = out.replaceAll('fill="white"', `fill="${s.segmentColor}"`);
    }
    out = out.replace(/(<rect\b[^>]*\bfill=")[^"]+(")/, (match, start, end) => (s.tileColor === '#4463ff' ? match : `${start}${s.tileColor}${end}`));
    return out
      .replace('<svg ', '<svg role="img" aria-labelledby="stream-title" ')
      .replace(/(<svg[^>]*>)/, `$1\n<title id="stream-title">Stream logo with flowing mark</title>${defs}`);
  }

  root.StreamWave = { DEFAULTS, CHOICES, normalize, prepare, shapeAt, shimmerStops, build };
})(globalThis);
