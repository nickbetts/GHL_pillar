// Feature scenes, batch B: Insight + Workspace (reports, leaderboard, achievements, market size, AI insights, team, landing studio, settings, frenzy).
import { C, rect, circ, path_, G, A, an, card, bar, text, avatar, icon, chip, streamMark, blob, travel } from './svg-kit.mjs';

const COLS = [C.violet, C.pink, C.amber, C.mint, C.blue];
const livetoggle = (x, y, dur = 6, begin = 0) => `<g><rect x="${x}" y="${y}" width="30" height="17" rx="8.5" fill="${C.line}"><animate attributeName="fill" values="${C.line};${C.line};${C.blue};${C.blue};${C.line}" keyTimes="0;.3;.4;.85;1" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></rect><circle cy="${y + 8.5}" r="6.5" fill="#fff"><animate attributeName="cx" values="${x + 8.5};${x + 8.5};${x + 21.5};${x + 21.5};${x + 8.5}" keyTimes="0;.3;.4;.85;1" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></circle></g>`;

export const scenesB = {
  reports: {
    title: 'Reports: the numbers behind every call, meeting and deal',
    body: (() => {
      const kpi = [['Calls', '312', '+12%', C.blue], ['Meetings', '48', '+8%', C.violet], ['Won', '\u00a394k', '+21%', C.mint]].map(([l, v, d, c], i) => G(
        card(36 + i * 140, 30, 128, 70, { r: 14 }) + text(50 + i * 140, 52, l, { s: 10, f: C.mute, w: 700 }) + text(50 + i * 140, 82, v, { s: 24, w: 800 }) + chip(112 + i * 140, 38, d, { fill: i === 2 ? C.mint2 : C.blue4, color: i === 2 ? '#0E9F7E' : C.blue, h: 18, s: 9 }), A('rise', 0.1 + i * 0.2, 9, { dy: '-12px' }))).join('');
      const hs = [58, 84, 70, 112, 96, 132, 150];
      const bars = hs.map((h, i) => an(rect(62 + i * 54, 296 - h, 34, h, 8, i === 6 ? C.blue : C.blue3), A('grow b', 0.5 + i * 0.12, 9))).join('');
      const pts = hs.map((h, i) => `${79 + i * 54},${280 - h * 0.92 - 14}`);
      const line = 'M' + pts.join(' L');
      const grid = [0, 1, 2, 3].map((i) => bar(50, 150 + i * 44, 390, 1, C.line)).join('');
      return blob(240, 190, 175) + kpi + card(36, 118, 408, 196, { r: 18 }) + grid + bars
        + an(path_(line, { fill: 'none', stroke: C.ink, 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: 1 }), A('draw d', 1.2, 9))
        + G(circ(79 + 6 * 54, 280 - 150 * 0.92 - 14, 6, C.blue, { stroke: '#fff', 'stroke-width': 3 }), A('pulse', 2.4, 2));
    })(),
  },

  leaderboard: {
    title: 'Leaderboard: weekly points that make the team compete',
    body: (() => {
      const pod = [[140, 96, C.blue2, 2, 'JK', COLS[1], '980'], [222, 132, C.blue, 1, 'AM', COLS[0], '1,240'], [304, 68, C.blue3, 3, 'SR', COLS[3], '760']];
      const cols = pod.map(([x, h, f, r, ini, ac, pts], i) => an(rect(x, 300 - h, 76, h, 12, f), A('grow b', 0.2 + i * 0.25, 8))
        + G(text(x + 38, 300 - h + 42, String(r), { s: 30, f: '#fff', a: 'middle', w: 800 }) + text(x + 38, 300 - h + 62, `${pts} pts`, { s: 10, f: r === 3 ? C.navy : '#fff', a: 'middle', w: 700 }), A('fade', 0.5 + i * 0.25, 8)))
        .join('');
      const avs = pod.map(([x, h, , r, ini, ac], i) => G(circ(x + 38, 300 - h - 26, 22, ac, { stroke: '#fff', 'stroke-width': 4 }) + text(x + 38, 300 - h - 20, ini, { s: 14, f: '#fff', a: 'middle', w: 800 }), A('float', i * 0.4, 3, { dy: '-6px' }))).join('');
      const crown = G(icon('star', 247, 300 - 132 - 78, 26, C.amber, 2.4) , A('twinkle', 0, 2));
      const badge = G(circ(70, 92, 34, 'url(#s-g3)', { filter: 'url(#s-sh)' }) + text(70, 102, '2\u00d7', { s: 28, f: '#fff', a: 'middle', w: 800 }), A('pulse', 0, 1.8, { sc: 1.1 }));
      const pops = [['+120', 400, 190, 0.6], ['+240', 78, 218, 1.6], ['+80', 410, 120, 2.6]].map(([t, x, y, d]) => G(chip(x - 24, y, t, { fill: C.mint2, color: '#0E9F7E', h: 24, w: 52, s: 11 }), A('rise', d, 6, { dy: '16px' }))).join('');
      return blob(240, 190, 175) + cols + avs + crown + badge + pops + bar(110, 300, 280, 3, C.line);
    })(),
  },

  achievements: {
    title: 'Achievements: badges, streaks and milestones worth chasing',
    body: (() => {
      const conf = Array.from({ length: 14 }, (_, i) => G(rect(30 + ((i * 97) % 420), 10, 7, 11, 2, [C.blue, C.pink, C.amber, C.mint, C.violet][i % 5]), A('fall', (i * 0.37) % 3.5, 4.4, { dy: '330px' }))).join('');
      const bd = [[88, 96, 'rocket', C.pink], [392, 96, 'flame', C.amber], [88, 252, 'target', C.mint], [392, 252, 'star', C.violet]].map(([x, y, ic, c], i) => G(circ(x, y, 32, '#fff', { stroke: C.line, filter: 'url(#s-sh2)' }) + circ(x, y, 24, c) + icon(ic, x - 12, y - 12, 24, '#fff', 2.2), A('float', i * 0.5, 3.4, { dy: '-7px' }))).join('');
      return blob(240, 180, 180) + conf + bd
        + G(circ(240, 174, 104, 'none', { stroke: C.blue2, 'stroke-width': 2, 'stroke-dasharray': '2 10', 'stroke-linecap': 'round' }), A('spin', 0, 40))
        + G(circ(240, 174, 82, C.blue, { opacity: 0.12 }), A('pulse', 0, 3, { sc: 1.08 })) + circ(240, 174, 68, 'url(#s-g1)', { filter: 'url(#s-sh)' })
        + icon('trophy', 204, 138, 72, '#fff', 1.8)
        + G(chip(168, 280, 'Closer \u00b7 level 3', { fill: C.ink, color: '#fff', icon: 'trophy', h: 28, s: 11 }), A('rise', 0.6, 7, { dy: '12px' }))
        + G(rect(176, 322, 128, 8, 4, C.line) + an(rect(176, 322, 92, 8, 4, C.blue), A('growx l', 0.8, 7)), '');
    })(),
  },

  'market-size': {
    title: 'Market size: how much of your market have you actually touched?',
    body: (() => {
      const dots = [[120, 120], [150, 150], [200, 130], [170, 190], [120, 190], [210, 200], [150, 120], [190, 165], [135, 170], [175, 215], [100, 150], [215, 160]];
      const dd = dots.map(([x, y], i) => G(circ(x, y, 4.5, i % 3 ? C.blue : C.mint), A('pop', 0.4 + i * 0.25, 9))).join('');
      const legend = [['TAM', '48,200', 'All UK engineering firms', C.blue4, C.blue], ['SAM', '12,400', 'Within your target sectors', C.blue3, C.blue], ['SOM', '3,150', 'Already in your queue', C.blue, '#fff']].map(([k, v, d, bg, fg], i) => G(
        card(300, 64 + i * 84, 156, 72, { r: 14 }) + rect(312, 78 + i * 84, 34, 22, 7, bg === C.blue ? C.blue : bg) + text(329, 93 + i * 84, k, { s: 9.5, f: fg, a: 'middle', w: 800 }) + text(354, 95 + i * 84, v, { s: 17, w: 800 }) + text(312, 118 + i * 84, d, { s: 9, f: C.mute, w: 600 }), A('slide', 0.3 + i * 0.35, 9, { dx: '22px' }))).join('');
      return blob(200, 180, 180) + circ(170, 170, 128, C.blue4, { stroke: C.blue3, 'stroke-width': 1.5 }) + circ(170, 170, 88, C.blue3, { opacity: 0.9 }) + circ(170, 170, 48, C.blue)
        + an(path_('M170 42 A128 128 0 1 1 61 233', { fill: 'none', stroke: C.blue, 'stroke-width': 4, 'stroke-linecap': 'round', pathLength: 1 }), A('draw d', 0.2, 9))
        + dd + text(170, 176, 'You', { s: 13, f: '#fff', a: 'middle', w: 800 }) + legend;
    })(),
  },

  'ai-insights': {
    title: 'AI insights: ask your pipeline anything in plain English',
    body: (() => {
      const bars = [['Construction', 34, C.blue], ['Manufacturing', 26, C.violet], ['Industrial', 18, C.mint]].map(([l, v, c], i) => text(70, 168 + i * 24, l, { s: 10, f: C.ink2, w: 600 }) + rect(158, 158 + i * 24, 200, 9, 4.5, C.line) + an(rect(158, 158 + i * 24, 200 * v / 40, 9, 4.5, c), A('growx l', 1.4 + i * 0.3, 9)) + text(372, 167 + i * 24, `${v}%`, { s: 10, f: C.ink, w: 800 })).join('');
      const tw = [[40, 60], [450, 150], [430, 40], [24, 280], [455, 300]].map(([x, y], i) => G(icon('sparkles', x - 8, y - 8, 16, C.blue2, 2), A('twinkle', i * 0.5, 2.6))).join('');
      return blob(240, 190, 175) + tw
        + G(rect(150, 30, 296, 46, 18, C.ink) + text(168, 58, 'Which industry converts best?', { s: 12, f: '#fff', w: 700 }), A('slide', 0.1, 10, { dx: '24px' }))
        + G(card(34, 96, 360, 192, { r: 20 })
          + G(circ(62, 126, 16, 'url(#s-g2)') + icon('sparkles', 54, 118, 16, '#fff', 2), A('pulse', 0, 2.4)) + text(86, 124, 'Stream AI', { s: 11, w: 800 }) + text(86, 138, 'Based on 1,248 leads this month', { s: 9, f: C.mute, w: 600 })
          + bars + chip(70, 244, 'Focus Construction this week', { fill: C.blue4, color: C.blue, icon: 'target', h: 28, s: 10.5 }), A('rise', 0.9, 10, { dy: '14px' }))
        + G(circ(412, 322, 3.5, C.blue) + circ(424, 322, 3.5, C.blue2) + circ(436, 322, 3.5, C.blue3), A('blink', 0, 1.2));
    })(),
  },

  team: {
    title: 'Team & roles: the right access for every rep, manager and admin',
    body: (() => {
      const roles = [['Rep', C.blue, [1, 0, 0], ['Own queue', 'Reports', 'Team admin']], ['Manager', C.violet, [1, 1, 0], ['Own queue', 'Reports', 'Team admin']], ['Admin', C.mint, [1, 1, 1], ['Own queue', 'Reports', 'Team admin']]];
      const cards = roles.map(([name, col, perms, labels], i) => {
        const x = 22 + i * 152;
        return G(card(x, 56, 138, 236, { r: 18 })
          + chip(x + 14, 72, name, { fill: col, color: '#fff', h: 24, s: 11, w: 64 })
          + avatar(x + 24, 128, 14, COLS[i], ['AM', 'JK', 'SR'][i]) + avatar(x + 48, 128, 14, COLS[(i + 2) % 5]) + avatar(x + 72, 128, 14, COLS[(i + 3) % 5])
          + labels.map((l, k) => text(x + 14, 178 + k * 36, l, { s: 10, w: 700, f: C.ink2 }) + (perms[k] ? livetoggle(x + 94, 164 + k * 36, 6, i * 0.5) : rect(x + 94, 164 + k * 36, 30, 17, 8.5, C.line) + circ(x + 102.5, 172.5 + k * 36, 6.5, '#fff'))).join(''), A('rise', 0.1 + i * 0.3, 9));
      }).join('');
      return blob(240, 190, 175) + cards + G(icon('lock', 214, 12, 28, C.blue, 2), A('float', 0, 3, { dy: '-5px' })) + G(chip(150, 312, 'Invite sent \u00b7 jamie@team.co', { fill: C.ink, color: '#fff', icon: 'email', h: 28, s: 10.5 }), A('rise', 1.6, 9));
    })(),
  },

  'landing-studio': {
    title: 'Landing Studio: build pages that capture leads and book meetings',
    body: (() => {
      const dots = circ(56, 52, 4.5, C.pink) + circ(70, 52, 4.5, C.amber) + circ(84, 52, 4.5, C.mint);
      const palette = [0, 1, 2].map((i) => rect(52, 92 + i * 52, 46, 40, 9, C.blue4, { stroke: C.blue3 }) + icon(['studio', 'list', 'calendar'][i], 63, 102 + i * 52, 22, C.blue, 2)).join('');
      const hero = G(rect(116, 90, 308, 86, 12, C.ink) + an(bar(134, 110, 150, 10, '#fff'), A('growx l', 0.3, 8)) + an(bar(134, 130, 110, 6, '#AEB4CC'), A('growx l', 0.6, 8)) + rect(134, 148, 70, 18, 9, C.blue) , A('rise', 0.2, 8));
      const form = G(rect(116, 188, 148, 118, 12, '#fff', { stroke: C.line }) + [0, 1].map((i) => rect(128, 200 + i * 30, 124, 22, 7, C.blue4)).join('') + rect(128, 262, 124, 28, 9, C.blue) + text(190, 280, 'Book a meeting', { s: 10, f: '#fff', a: 'middle', w: 700 }), A('rise', 1, 8));
      const proof = G([0, 1, 2].map((i) => circ(304 + i * 40, 222, 15, COLS[i]) + bar(290 + i * 40, 250, 28, 5, C.line)).join('') + bar(290, 272, 120, 6, C.line) + bar(290, 286, 90, 6, C.line), A('rise', 1.7, 8));
      const cursor = `<g><animateTransform attributeName="transform" type="translate" values="76 190; 300 238; 300 238; 76 190" keyTimes="0;.4;.8;1" dur="8s" repeatCount="indefinite"/><path d="M0 0 L0 17 L5 13 L9 21 L12 19.5 L8 12 L14 12Z" fill="${C.ink}" stroke="#fff" stroke-width="1.5"/></g>`;
      return blob(240, 190, 180) + card(36, 30, 408, 300, { r: 20 }) + dots + rect(100, 44, 250, 16, 8, C.blue4) + text(225, 56, 'stream.page/northwind', { s: 8.5, f: C.mute, a: 'middle', w: 600 })
        + G(chip(372, 42, 'Publish', { fill: C.blue, color: '#fff', h: 20, w: 58, s: 9.5 }), A('pulse', 0, 2, { sc: 1.08 }))
        + palette + hero + form + proof + cursor;
    })(),
  },

  settings: {
    title: 'My settings: make the workspace yours',
    body: (() => {
      const rows = [['Email notifications', 0], ['Call reminders', 0.7], ['Weekly summary', 1.4]].map(([l, d], i) => text(76, 220 + i * 30, l, { s: 11, w: 700, f: C.ink2 }) + livetoggle(350, 207 + i * 30, 7, d)).join('');
      return blob(240, 190, 175) + card(48, 36, 384, 280, { r: 22 })
        + G(circ(240, 108, 48, 'none', { stroke: C.blue, 'stroke-width': 2.5, 'stroke-dasharray': '4 9', 'stroke-linecap': 'round' }), A('spin', 0, 18))
        + circ(240, 108, 38, C.violet) + text(240, 118, 'AM', { s: 28, f: '#fff', a: 'middle', w: 800 })
        + text(240, 178, 'Alex Morgan', { s: 14, a: 'middle', w: 800 }) + chip(206, 180, 'Sales rep', { fill: C.blue4, color: C.blue, h: 22, w: 68, s: 10 }) + rows
        + G(chip(60, 330, 'Profile saved', { fill: C.mint2, color: '#0E9F7E', icon: 'check', h: 26, s: 10.5 }), A('rise', 1.8, 8))
        + G(chip(350, 22, 'Availability', { fill: '#fff', stroke: C.line, color: C.ink2, icon: 'clock', h: 26, s: 10.5 }), A('float', 0, 3.4, { dy: '-5px' }));
    })(),
  },

  frenzy: {
    title: 'Double Point Frenzy: a closed deal doubles everyone\u2019s points for 48 hours',
    body: (() => {
      const secs = Array.from({ length: 6 }, (_, k) => `<text x="423" y="76" font-family="'Plus Jakarta Sans',system-ui,sans-serif" font-size="17" font-weight="800" fill="${C.ink}" text-anchor="middle" opacity="0"><animate attributeName="opacity" values="0;1;0;0" keyTimes="0;${(k / 6).toFixed(3)};${((k + 1) / 6).toFixed(3)};1" calcMode="discrete" dur="6s" repeatCount="indefinite"/>${String(12 - k).padStart(2, '0')}s</text>`).join('');
      const conf = Array.from({ length: 16 }, (_, i) => G(rect(20 + ((i * 53) % 440), 112, 7, 11, 2, [C.blue, C.pink, C.amber, C.mint, C.violet][i % 5]), A('fall', (i * 0.31) % 3, 4, { dy: '230px' }))).join('');
      const board = [['Alex M.', '2,480', COLS[0]], ['Jamie K.', '1,960', COLS[1]], ['Sam R.', '1,520', COLS[3]]].map(([n, p, c], i) => G(rect(40 + i * 140, 262, 128, 56, 14, '#fff', { stroke: C.line, filter: 'url(#s-sh2)' }) + avatar(62 + i * 140, 290, 12, c) + text(80 + i * 140, 286, n, { s: 10.5, w: 800 }) + text(80 + i * 140, 302, `${p} pts`, { s: 10, f: C.blue, w: 800 }) + chip(128 + i * 140, 272, '2\u00d7', { fill: C.amber2, color: '#B36B00', h: 16, w: 28, s: 9 }), A('rise', 0.4 + i * 0.3, 8))).join('');
      return blob(240, 190, 185) + conf
        + G(rect(24, 30, 432, 76, 22, 'url(#s-g3)', { filter: 'url(#s-sh)' }) + icon('flame', 40, 46, 26, '#fff', 2.2) + text(76, 60, 'DOUBLE POINT FRENZY', { s: 15, f: '#fff', w: 800, ls: 0.6 }) + text(76, 80, 'Alex closed a deal. Ends in', { s: 10.5, f: '#fff', w: 600 })
          + rect(316, 48, 38, 42, 10, '#fff') + text(335, 76, '47h', { s: 16, a: 'middle', w: 800 }) + rect(360, 48, 38, 42, 10, '#fff') + text(379, 76, '59m', { s: 16, a: 'middle', w: 800 }) + rect(404, 48, 38, 42, 10, '#fff') + secs, A('pop', 0, 10))
        + G(text(240, 218, '2\u00d7', { s: 88, a: 'middle', w: 800, f: 'url(#s-g3)' }), 'class="bigx" style="cursor:pointer"')
        + G(chip(80, 140, '+240', { fill: C.mint2, color: '#0E9F7E', h: 26, w: 56, s: 12 }), A('rise', 0.6, 5, { dy: '18px' })) + G(chip(344, 150, '+120', { fill: C.mint2, color: '#0E9F7E', h: 26, w: 56, s: 12 }), A('rise', 1.8, 5, { dy: '18px' }))
        + board;
    })(),
  },
};
