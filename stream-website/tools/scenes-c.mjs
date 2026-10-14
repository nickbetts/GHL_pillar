// Scenes batch C: hero, automations (9), automation flow, integrations orbit, security, 404.
import { C, rect, circ, path_, G, A, an, card, bar, text, avatar, icon, chip, streamMark, markOnly, packet, blob, travel } from './svg-kit.mjs';

const COLS = [C.violet, C.pink, C.amber, C.mint, C.blue];
const dashed = (d, o = {}) => path_(d, { fill: 'none', stroke: o.stroke ?? C.blue2, 'stroke-width': o.w ?? 2, 'stroke-dasharray': '4 8', 'stroke-linecap': 'round', class: 'flow', style: `--dur:${o.dur ?? 1.4}s` });
const node = (cx, cy, ic, grad = 'url(#s-g1)', r = 30, ping = true) => (ping ? G(circ(cx, cy, r, C.blue), A('ping', 0, 2.6)) : '') + circ(cx, cy, r, grad, { filter: 'url(#s-sh)' }) + icon(ic, cx - r * 0.46, cy - r * 0.46, r * 0.92, '#fff', 2.1);
const leadCard = (x, y, w = 128, o = {}) => card(x, y, w, 62, { r: 14 }) + avatar(x + 24, y + 31, 14, o.col ?? C.violet, o.ini ?? 'AM') + bar(x + 46, y + 22, w - 64, 8, C.ink2) + bar(x + 46, y + 38, w - 82, 6, C.line);

const wrap = (w, h, title, body, extra = {}) => ({ title, body, size: [w, h], ...extra });

export const scenesC = {
  hero: wrap(720, 520, 'Stream: calls, pipeline, proposals and leaderboard in one workspace', (() => {
    const nav = ['Call list', 'Opportunities', 'Proposal Hub', 'Inbound', 'Calendar', 'Campaigns', 'Leaderboard'];
    const ico = ['calls', 'opportunities', 'proposals', 'inbound', 'calendar', 'campaigns', 'podium'];
    const side = nav.map((n, i) => (i === 0 ? rect(50, 108 + i * 36, 100, 30, 9, C.blue4) : '') + icon(ico[i], 60, 114 + i * 36, 16, i === 0 ? C.blue : C.mute, 2.1) + text(84, 128 + i * 36, n, { s: 10.5, w: i === 0 ? 800 : 600, f: i === 0 ? C.blue : C.ink2 })).join('');
    const kp = [['Calls today', '47', C.blue], ['Meetings', '6', C.violet], ['Pipeline', '\u00a3184k', C.mint]].map(([l, v, c], i) => G(
      card(180 + i * 150, 138, 138, 66, { r: 14 }) + text(194 + i * 150, 160, l, { s: 9.5, f: C.mute, w: 700 }) + text(194 + i * 150, 190, v, { s: 22, w: 800 })
      + an(path_(`M${262 + i * 150} 186 l10 -8 l10 5 l12 -14`, { fill: 'none', stroke: c, 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: 1 }), A('draw d', 0.8 + i * 0.2, 9)), A('rise', 0.2 + i * 0.2, 9, { dy: '-10px' }))).join('');
    const hs = [52, 78, 64, 98, 84, 118, 132];
    const bars = hs.map((h, i) => an(rect(198 + i * 40, 410 - h, 26, h, 7, i === 6 ? C.blue : C.blue3), A('grow b', 0.9 + i * 0.1, 9))).join('');
    const up = [['Northwind Eng.', 'Call \u00b7 10:30', COLS[0]], ['Calder Tools', 'Demo \u00b7 11:15', COLS[1]], ['Fenwick Ltd', 'Follow-up \u00b7 14:00', COLS[2]]].map(([n, s, c], i) => G(
      avatar(512, 262 + i * 52, 12, c) + text(532, 258 + i * 52, n, { s: 10, w: 800 }) + text(532, 272 + i * 52, s, { s: 8.5, f: C.mute, w: 600 }), A('slide', 0.8 + i * 0.35, 9, { dx: '16px' }))).join('');
    const wave = Array.from({ length: 11 }, (_, i) => an(rect(572 + i * 8, 56, 4, 26, 2, i % 2 ? C.blue : C.blue2), A('eq', i * 0.1, 0.9 + (i % 3) * 0.2))).join('');
    return blob(360, 270, 320)
      + card(40, 56, 600, 400, { r: 24 }) + circ(64, 76, 4.5, C.pink) + circ(78, 76, 4.5, C.amber) + circ(92, 76, 4.5, C.mint) + rect(130, 68, 250, 17, 8.5, C.blue4) + text(255, 80, 'app.stream.io/call-list', { s: 8.5, f: C.mute, a: 'middle', w: 600 })
      + bar(40, 92, 600, 1, C.line) + bar(160, 92, 1, 364, C.line) + side
      + text(180, 118, 'Good morning, Alex', { s: 16, w: 800 }) + kp
      + card(180, 218, 300, 218, { r: 16 }) + text(196, 242, 'Weekly activity', { s: 11, w: 800 }) + bars
      + card(492, 218, 136, 218, { r: 16 }) + text(504, 242, 'Up next', { s: 11, w: 800 }) + up
      + G(card(486, 12, 200, 94, { r: 18 }) + avatar(514, 44, 17, C.violet, 'AM') + text(540, 40, 'On a call', { s: 9, f: C.mute, w: 700 }) + text(540, 55, 'Alex Morgan', { s: 12, w: 800 }) + wave + an(circ(662, 40, 6, C.mint), A('blink', 0, 1.2)) + text(502, 98, '02:14', { s: 10, w: 800, f: C.blue }), A('float', 0, 4.5, { dy: '-7px' }))
      + G(rect(14, 400, 244, 62, 18, C.ink, { filter: 'url(#s-sh)' }) + circ(44, 431, 15, C.mint) + icon('check', 36, 423, 16, '#fff', 3.2) + text(68, 425, 'Contract signed', { s: 12, f: '#fff', w: 800 }) + text(68, 442, 'Northwind \u00b7 \u00a38,000 \u00b7 2\u00d7 points on', { s: 9.5, f: '#AEB4CC', w: 600 }), A('float', 0.6, 5, { dy: '-6px' }))
      + G(card(468, 408, 236, 84, { r: 18 }) + circ(498, 440, 20, 'url(#s-g3)') + icon('podium', 488, 430, 20, '#fff', 2) + text(530, 434, 'You\u2019re #1 this week', { s: 11, w: 800 }) + text(530, 450, '1,240 pts', { s: 10, f: C.blue, w: 800 }) + chip(530, 458, 'Frenzy 2\u00d7', { fill: C.amber2, color: '#B36B00', icon: 'flame', h: 20, s: 9 }), A('float', 1.2, 4.2, { dy: '-6px' }))
      + G(chip(232, 22, 'Proposal viewed \u00b7 3m ago', { fill: '#fff', stroke: C.line, color: C.ink2, icon: 'eye', h: 28, s: 10.5 }), A('float', 0.3, 3.8, { dy: '-6px' }));
  })()),

  'apollo-enrichment': wrap(480, 360, 'Apollo enrichment: new leads arrive with phones and emails', (() => {
    const out = [['Mobile \u00b7 +44 7700 900123', 'calls', 0.9], ['Email \u00b7 alex@northwind.co.uk', 'email', 1.5], ['Role \u00b7 Operations Director', 'user', 2.1]].map(([t, ic, d], i) => G(rect(338, 96 + i * 34, 128, 26, 9, C.mint2) + icon(ic, 346, 101 + i * 34, 14, '#0E9F7E', 2.2) + text(366, 113 + i * 34, t.split(' \u00b7 ')[0], { s: 9.5, f: '#0E9F7E', w: 800 }), A('pop', d, 8))).join('');
    return blob(240, 180, 175) + dashed('M148 180 H208') + dashed('M272 180 H336') + packet('M148 180 H208', { dur: 1.8 }) + packet('M272 180 H336', { dur: 1.8, begin: 0.9, fill: C.mint })
      + leadCard(18, 150) + G(chip(40, 216, 'No phone yet', { fill: C.pink2, color: C.pink, h: 20, s: 9 }), A('fade', 0, 8))
      + node(240, 180, 'sparkles', 'url(#s-g2)') + card(332, 70, 140, 188, { r: 16 }) + text(346, 90, 'Enriched lead', { s: 10, w: 800 }) + out
      + G(chip(176, 236, 'Apollo', { fill: C.ink, color: '#fff', h: 24, w: 128, s: 11 }), A('rise', 0.2, 8));
  })()),

  'assignment-router': wrap(480, 360, 'Assignment router: the right lead goes to the right rep', (() => {
    const reps = [['AM', COLS[0], 18], ['JK', COLS[1], 62], ['SR', COLS[3], 34]].map(([ini, c, load], i) => G(card(350, 52 + i * 90, 114, 68, { r: 14 }) + avatar(376, 86 + i * 90, 14, c, ini) + bar(398, 74 + i * 90, 54, 7, C.ink2) + rect(398, 94 + i * 90, 54, 6, 3, C.line) + an(rect(398, 94 + i * 90, 54 * load / 70, 6, 3, c), A('growx l', 0.5 + i * 0.2, 8)), A('pop', 0.2 + i * 0.3, 8))).join('');
    const paths = ['M270 180 C310 180 310 86 346 86', 'M270 180 C300 180 320 176 346 176', 'M270 180 C310 180 310 266 346 266'];
    return blob(240, 180, 175) + leadCard(14, 150, 122) + dashed('M136 181 H208')
      + paths.map((d) => path_(d, { fill: 'none', stroke: C.blue3, 'stroke-width': 2.5, 'stroke-linecap': 'round' })).join('')
      + packet(paths[1], { dur: 2.4, begin: 0, fill: C.mint }) + packet(paths[0], { dur: 2.4, begin: 2.4, fill: C.violet }) + packet(paths[2], { dur: 2.4, begin: 4.8, fill: C.pink })
      + node(240, 180, 'route') + reps + G(chip(168, 232, 'Territory \u00b7 Capacity', { fill: C.blue4, color: C.blue, h: 24, s: 10 }), A('rise', 0.4, 8));
  })()),

  deduplication: wrap(480, 360, 'Deduplication: one lead, one record', (() => {
    const mv = (x, y, dx, dy) => `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 0;${dx} ${dy};${dx} ${dy};0 0" keyTimes="0;.15;.4;.4;1" dur="7s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;1;1;0;0;1" keyTimes="0;.15;.38;.42;.97;1" dur="7s" repeatCount="indefinite"/>${leadCard(x, y, 128, { col: C.violet })}</g>`;
    return blob(240, 180, 175) + mv(30, 70, 250, 70) + mv(30, 220, 250, -80)
      + G(card(280, 140, 150, 80, { r: 16, stroke: C.mint }) + avatar(308, 180, 16, C.violet, 'AM') + bar(332, 168, 76, 9, C.ink2) + bar(332, 186, 52, 6, C.line) + circ(418, 150, 11, C.mint) + icon('check', 412, 144, 12, '#fff', 3.4), A('pop', 1.4, 7))
      + G(chip(296, 238, '2 \u2192 1 merged', { fill: C.mint2, color: '#0E9F7E', icon: 'dedupe', h: 26, s: 10.5 }), A('rise', 2.2, 7))
      + G(circ(355, 180, 52, C.mint), A('ping', 1.6, 2.8));
  })()),

  'inbound-handler': wrap(480, 360, 'Inbound handler: every enquiry processed in seconds', (() => {
    const steps = [['Score 86', 'gauge'], ['Tag: Construction', 'tag'], ['Assign: Alex', 'route'], ['Notify rep', 'bell']];
    const list = steps.map(([t, ic], i) => G(rect(196, 66 + i * 52, 170, 40, 12, '#fff', { stroke: C.line, filter: 'url(#s-sh2)' }) + icon(ic, 208, 76 + i * 52, 20, C.blue, 2.1) + text(236, 91 + i * 52, t, { s: 10.5, w: 800 }) + circ(348, 86 + i * 52, 9, C.mint) + icon('check', 343, 81 + i * 52, 10, '#fff', 3.4), A('slide', 0.4 + i * 0.9, 8, { dx: '-16px' }))).join('');
    return blob(260, 180, 175) + G(rect(18, 150, 112, 60, 18, '#fff', { stroke: C.line, filter: 'url(#s-sh2)' }) + icon('email', 30, 168, 22, C.blue, 2.1) + text(60, 177, 'New enquiry', { s: 10, w: 800 }) + text(60, 191, 'Web form', { s: 8.5, f: C.mute, w: 600 }), A('float', 0, 3.4, { dy: '-4px' }))
      + dashed('M130 180 H190') + packet('M130 180 H190', { dur: 1.6 }) + list
      + G(circ(420, 180, 28, C.amber), A('ping', 3.4, 2.4)) + G(circ(420, 180, 26, 'url(#s-g3)') + icon('bell', 408, 168, 24, '#fff', 2.2), A('pop', 3.4, 8))
      + dashed('M366 180 H392');
  })()),

  'lead-scoring': wrap(480, 360, 'Lead scoring: prioritise the leads most likely to buy', (() => {
    const arc = (a0, a1, col) => { const r = 100; const p = (a) => [240 + r * Math.cos(Math.PI * (1 - a)), 218 - r * Math.sin(Math.PI * (1 - a))]; const [x0, y0] = p(a0); const [x1, y1] = p(a1); return path_(`M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`, { fill: 'none', stroke: col, 'stroke-width': 18, 'stroke-linecap': 'round' }); };
    const crit = [['Industry fit', '+20'], ['Opened email', '+10'], ['Pricing visit', '+15']].map(([l, v], i) => G(rect(34 + i * 148, 288, 136, 34, 12, '#fff', { stroke: C.line, filter: 'url(#s-sh2)' }) + text(46 + i * 148, 309, l, { s: 9.5, w: 700, f: C.ink2 }) + text(138 + i * 148, 309, v, { s: 11, w: 800, f: '#0E9F7E', a: 'end' }), A('rise', 0.3 + i * 0.5, 8, { dy: '14px' }))).join('');
    return blob(240, 190, 175) + card(60, 40, 360, 232, { r: 22 }) + arc(0, 0.32, C.blue3) + arc(0.36, 0.66, C.blue2) + arc(0.7, 1, C.blue)
      + `<g><animateTransform attributeName="transform" type="rotate" values="-84 240 218;-84 240 218;38 240 218;30 240 218;-84 240 218" keyTimes="0;.12;.34;.88;1" dur="7s" repeatCount="indefinite"/><path d="M240 218 L240 138" stroke="${C.ink}" stroke-width="4" stroke-linecap="round"/></g>`
      + circ(240, 218, 11, C.ink) + circ(240, 218, 4, '#fff')
      + G(text(240, 258, '86', { s: 30, a: 'middle', w: 800 }), A('pop', 0.8, 7)) + G(chip(190, 108, 'Hot lead', { fill: C.amber2, color: '#B36B00', icon: 'flame', h: 24, s: 10.5 }), A('pop', 2.2, 7)) + crit;
  })()),

  'opportunity-creation': wrap(480, 360, 'Opportunity creation: qualified leads become pipeline automatically', (() => {
    return blob(240, 180, 175) + leadCard(16, 148, 132) + G(chip(30, 214, 'Meeting held', { fill: C.violet2, color: C.violet, h: 22, s: 9.5, icon: 'check' }), A('fade', 0, 7))
      + dashed('M148 180 H206') + packet('M148 180 H206', { dur: 1.8 }) + node(240, 180, 'opportunities')
      + dashed('M274 180 H318') + packet('M274 180 H318', { dur: 1.8, begin: 0.9, fill: C.mint })
      + G(card(316, 98, 152, 164, { r: 18 }) + chip(330, 112, 'New', { fill: C.blue4, color: C.blue, h: 20, s: 9.5, w: 44 }) + text(330, 150, 'Northwind', { s: 13, w: 800 }) + text(330, 165, 'Website refresh', { s: 9.5, f: C.mute, w: 600 }) + text(330, 206, '\u00a38,000', { s: 22, w: 800, f: C.blue }) + avatar(344, 240, 12, C.violet, 'AM') + bar(364, 237, 60, 6, C.line), A('pop', 0.8, 8))
      + G(chip(348, 276, 'Created for you', { fill: C.ink, color: '#fff', icon: 'sparkles', h: 24, s: 10 }), A('rise', 1.6, 8));
  })()),

  'automation-reporting': wrap(480, 360, 'Automated reporting: the numbers land in inboxes on schedule', (() => {
    const hs = [40, 62, 50, 84, 70, 100];
    const bars = hs.map((h, i) => an(rect(52 + i * 28, 230 - h, 18, h, 5, i === 5 ? C.blue : C.blue3), A('grow b', 0.4 + i * 0.1, 8))).join('');
    const rec = [COLS[0], COLS[1], COLS[3]].map((c, i) => G(avatar(404, 90 + i * 74, 18, c, ['AM', 'JK', 'SR'][i]) + circ(420, 76 + i * 74, 7, C.mint) + icon('email', 416.5, 72.5 + i * 74, 7, '#fff', 3), A('pop', 1.6 + i * 0.5, 8))).join('');
    const paths = ['M200 150 C260 150 300 90 384 90', 'M200 160 C270 160 310 164 384 164', 'M200 172 C260 172 300 238 384 238'];
    return blob(240, 180, 175) + card(30, 60, 180, 230, { r: 18 }) + text(46, 88, 'Weekly report', { s: 11, w: 800 }) + bars + bar(46, 252, 120, 6, C.line) + bar(46, 266, 90, 6, C.line)
      + G(chip(250, 30, 'Mon \u00b7 08:00', { fill: C.blue, color: '#fff', icon: 'clock', h: 28, s: 11 }), A('pulse', 0, 2.4, { sc: 1.05 }))
      + paths.map((d) => path_(d, { fill: 'none', stroke: C.blue3, 'stroke-width': 2, 'stroke-dasharray': '3 6' })).join('')
      + paths.map((d, i) => packet(d, { dur: 2.6, begin: 1.4 + i * 0.5, fill: C.blue, r: 5 })).join('') + rec;
  })()),

  'smart-tagging': wrap(480, 360, 'Smart tagging: leads labelled by what they are and what they did', (() => {
    const tags = [['Construction', 70, 70, C.amber, C.amber2], ['Hot lead', 318, 80, C.pink, C.pink2], ['Cambridgeshire', 40, 262, C.blue, C.blue4], ['Decision maker', 296, 262, C.mint, C.mint2], ['Opened email', 330, 170, C.violet, C.violet2]];
    return blob(240, 180, 175) + card(150, 130, 180, 100, { r: 18 }) + avatar(188, 180, 20, C.violet, 'AM') + bar(220, 164, 90, 9, C.ink2) + bar(220, 184, 64, 6, C.line) + bar(220, 198, 76, 6, C.line)
      + tags.map(([t, x, y, f, bg], i) => G(chip(x, y, t, { fill: bg, color: f, icon: 'tag', h: 28, s: 10.5 }), A('pop', 0.3 + i * 0.7, 8))).join('')
      + G(circ(240, 180, 94, 'none', { stroke: C.blue3, 'stroke-width': 1.5, 'stroke-dasharray': '3 7' }), A('spin', 0, 30));
  })()),

  'webhook-orchestration': wrap(480, 360, 'Webhook orchestration: every system kept in step', (() => {
    const ends = [['GoHighLevel', 60, 70], ['Apollo', 380, 70], ['3CX', 60, 280], ['Mailgun', 380, 280]];
    const cx = 240, cy = 180;
    const lines = ends.map(([, x, y]) => path_(`M${cx} ${cy} L${x + 20} ${y + 15}`, { stroke: C.blue3, 'stroke-width': 2.5, 'stroke-linecap': 'round' })).join('');
    const pk = ends.map(([, x, y], i) => packet(`M${cx} ${cy} L${x + 20} ${y + 15}`, { dur: 2.4, begin: i * 0.6, fill: i % 2 ? C.mint : C.blue }) + packet(`M${x + 20} ${y + 15} L${cx} ${cy}`, { dur: 2.4, begin: 1.2 + i * 0.6, fill: C.violet })).join('');
    const nodes = ends.map(([t, x, y], i) => G(rect(x - 20, y, 100, 32, 16, '#fff', { stroke: C.line, filter: 'url(#s-sh2)' }) + circ(x - 4, y + 16, 7, [C.blue, C.pink, C.amber, C.mint][i]) + text(x + 8, y + 20, t, { s: 10.5, w: 800 }), A('float', i * 0.4, 3.2, { dy: '-4px' }))).join('');
    return blob(240, 180, 175) + lines + pk + nodes + G(circ(cx, cy, 44, C.blue), A('ping', 0, 2.8)) + streamMark(cx - 30, cy - 30, 60)
      + G(chip(190, 238, '{ event: "lead.created" }', { fill: C.ink, color: '#fff', icon: 'code', h: 24, s: 9.5 }), A('rise', 0.5, 8));
  })()),

  flow: wrap(480, 360, 'Automations: triggers, rules and actions that never sleep', (() => {
    const col = (x, title, items, c) => text(x + 50, 42, title, { s: 10, f: C.mute, a: 'middle', w: 800, ls: 1 }) + items.map(([t, ic], i) => G(rect(x, 62 + i * 76, 100, 56, 14, '#fff', { stroke: C.line, filter: 'url(#s-sh2)' }) + icon(ic, x + 10, 78 + i * 76, 22, c, 2.1) + text(x + 38, 94 + i * 76, t, { s: 9.5, w: 800 }), A('pop', 0.2 + i * 0.4, 9))).join('');
    const p1 = ['M120 90 C150 90 160 90 190 90', 'M120 166 C150 166 160 166 190 166', 'M120 242 C150 242 160 242 190 242'];
    const p2 = ['M290 90 C320 90 330 90 360 90', 'M290 166 C320 166 330 166 360 166', 'M290 242 C320 242 330 242 360 242'];
    return blob(240, 180, 175) + col(20, 'TRIGGERS', [['New lead', 'inbound'], ['Call logged', 'calls'], ['Deal won', 'trophy']], C.blue)
      + col(190, 'RULES', [['Score', 'gauge'], ['Dedupe', 'dedupe'], ['Route', 'route']], C.violet) + col(360, 'ACTIONS', [['Tag', 'tag'], ['Notify', 'bell'], ['Report', 'reports']], C.mint)
      + [...p1, ...p2].map((d) => path_(d, { fill: 'none', stroke: C.blue3, 'stroke-width': 2.2, 'stroke-linecap': 'round' })).join('')
      + [...p1, ...p2].map((d, i) => packet(d, { dur: 1.6, begin: (i % 3) * 0.8 + (i > 2 ? 1.6 : 0), r: 3.5, fill: i > 2 ? C.mint : C.blue })).join('');
  })()),

  orbit: wrap(480, 360, 'Integrations: Stream connects to the tools you already run', (() => {
    const ring = (r, items, dur, outerRev) => G(circ(240, 180, r, 'none', { stroke: C.blue3, 'stroke-width': 1.5, 'stroke-dasharray': '3 7' }) + items.map(([t, a, col]) => {
      const x = 240 + r * Math.cos(a), y = 180 + r * Math.sin(a);
      return G(rect(x - 44, y - 15, 88, 30, 15, '#fff', { stroke: C.line, filter: 'url(#s-sh2)' }) + circ(x - 28, y, 6, col) + text(x - 17, y + 4, t, { s: 10, w: 800 }), `class="a spin${outerRev ? '' : ' rev'}" style="--dur:${dur}s"`);
    }).join(''), `class="a spin${outerRev ? ' rev' : ''}" style="--dur:${dur}s;transform-box:view-box;transform-origin:240px 180px"`);
    return blob(240, 180, 180) + ring(92, [['Apollo', 0.4, C.blue], ['3CX', 3.5, C.pink]], 36, false) + ring(150, [['GoHighLevel', 1.5, C.amber], ['Mailgun', 4.6, C.mint], ['Webhooks', 6.0, C.violet]], 56, true)
      + G(circ(240, 180, 46, C.blue), A('ping', 0, 3)) + streamMark(210, 150, 60);
  })()),

  security: wrap(480, 360, 'Security: role-based access and a signed audit trail', (() => {
    return blob(240, 180, 175)
      + G(circ(240, 180, 130, 'none', { stroke: C.blue3, 'stroke-width': 1.5, 'stroke-dasharray': '2 9' }), A('spin', 0, 50))
      + G(circ(240, 180, 90, C.blue), A('ping', 0, 3))
      + path_('M240 76 L328 108 V184 C328 238 290 270 240 286 C190 270 152 238 152 184 V108 Z', { fill: 'url(#s-g1)', filter: 'url(#s-sh)' })
      + an(path_('M200 182 L230 212 L284 150', { fill: 'none', stroke: '#fff', 'stroke-width': 10, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: 1 }), A('draw d', 0.4, 6))
      + G(chip(330, 84, 'Roles', { fill: '#fff', stroke: C.line, color: C.ink2, icon: 'team', h: 26, s: 10.5 }), A('float', 0, 3, { dy: '-5px' }))
      + G(chip(54, 130, 'Audit trail', { fill: '#fff', stroke: C.line, color: C.ink2, icon: 'eye', h: 26, s: 10.5 }), A('float', 0.6, 3.4, { dy: '-5px' }))
      + G(chip(344, 250, 'Signed', { fill: '#fff', stroke: C.line, color: C.ink2, icon: 'pen', h: 26, s: 10.5 }), A('float', 1.1, 3.2, { dy: '-5px' }))
      + G(chip(70, 258, 'Encrypted', { fill: '#fff', stroke: C.line, color: C.ink2, icon: 'lock', h: 26, s: 10.5 }), A('float', 0.3, 3.6, { dy: '-5px' }));
  })()),

  lost: wrap(480, 360, 'Page not found', (() => {
    return blob(240, 180, 170) + G(circ(240, 180, 40, C.amber), A('ping', 0, 1.6))
      + travel(G(rect(60, 156, 90, 48, 12, C.ink) + rect(150, 168, 22, 8, 2, C.ink2) + rect(150, 184, 22, 8, 2, C.ink2), ''), '0 0; 52 0; 52 0; 0 0', { dur: 4, keyTimes: '0;.45;.7;1' })
      + travel(G(rect(330, 156, 90, 48, 12, C.blue) + rect(308, 168, 22, 8, 2, C.blue2) + rect(308, 184, 22, 8, 2, C.blue2), ''), '0 0; -52 0; -52 0; 0 0', { dur: 4, keyTimes: '0;.45;.7;1' })
      + G(icon('bolt', 226, 150, 28, C.amber, 2.4), A('blink', 0, 0.9))
      + text(240, 270, '404', { s: 40, a: 'middle', w: 800, f: C.ink });
  })()),
};
