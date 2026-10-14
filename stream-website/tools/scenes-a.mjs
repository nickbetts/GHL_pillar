// Feature scenes, batch A: Sell + Engage (call list, outbound, opportunities, proposals, inbound, calendar, campaigns, email copy, waves).
import { C, rect, circ, path_, G, A, an, card, bar, text, avatar, icon, chip, streamMark, packet, plane, blob, row, travel } from './svg-kit.mjs';

const COLS = [C.violet, C.pink, C.amber, C.mint, C.blue];

export const scenesA = {
  'call-list': {
    title: 'Call list: one lead at a time, everything on screen',
    body: (() => {
      const queue = [0, 1, 2, 3].map((i) => G(row(46, 128 + i * 42, 176, COLS[i], { hi: i === 0, fill: i === 0 ? C.blue4 : '#fff' }), A('slide', 0.2 + i * 0.25, 8, { dx: '-22px' }))).join('');
      const wave = Array.from({ length: 17 }, (_, i) => an(rect(230 + i * 11, 136, 5, 44, 2.5, i % 3 === 0 ? C.blue : C.blue2), A('eq', i * 0.11, 0.9 + (i % 4) * 0.15))).join('');
      return blob(240, 180, 175)
        + card(36, 90, 196, 214) + text(54, 116, 'UP NEXT', { s: 9, f: C.mute, ls: 1.2 }) + queue
        + G(card(206, 36, 238, 236)
          + avatar(246, 84, 22, C.violet, 'AM') + text(278, 80, 'Alex Morgan', { s: 13, w: 800 }) + text(278, 96, 'Northwind Engineering', { s: 10, f: C.mute, w: 500 })
          + chip(394, 70, 'LIVE', { fill: C.mint2, color: '#0E9F7E', w: 40, h: 18, s: 9 })
          + wave
          + text(325, 214, '02:14', { s: 26, w: 800, a: 'middle' })
          + an(circ(325, 242, 15, C.mint), A('ping', 0, 2.2)) + circ(325, 242, 15, C.mint) + icon('calls', 317, 234, 16, '#fff', 2.4)
          + circ(284, 242, 12, C.blue4) + icon('settings', 278, 236, 12, C.blue, 2.2)
          + circ(366, 242, 12, C.blue4) + icon('list', 360, 236, 12, C.blue, 2.2), A('float', 0, 5, { dy: '-5px' }))
        + G(chip(346, 288, 'Interested', { fill: C.violet2, color: C.violet, icon: 'check', h: 26, s: 11 }), A('rise', 1.2, 8))
        + G(rect(40, 318, 164, 28, 14, C.ink) + icon('check', 52, 324, 14, C.mint, 3) + text(72, 336, 'Logged to CRM', { s: 11, f: '#fff', w: 700 }), A('rise', 2.2, 8, { dy: '12px' }));
    })(),
  },

  outbound: {
    title: 'Outbound queue: your prospecting engine, loaded and sorted',
    body: (() => {
      const src = ['Apollo', 'Maps list', 'CSV'].map((s, i) => G(chip(24, 74 + i * 78, s, { fill: '#fff', stroke: C.line, color: C.ink2, w: 86, h: 30, s: 11 }), A('float', i * 0.4, 3 + i * 0.5, { dy: '-4px' }))).join('');
      const movers = [0, 1, 2].flatMap((lane) => [0, 1].map((k) => G(
        rect(120, 73 + lane * 78, 56, 24, 8, '#fff', { stroke: C.line, filter: 'url(#s-sh2)' }) + circ(134, 85 + lane * 78, 6, COLS[lane]) + bar(144, 82 + lane * 78, 26, 5, C.ink2),
        A('conv', lane * 0.5 + k * 2.4, 4.8, { dx: '120px' }))));
      const tags = [['Construction', C.amber, C.amber2], ['Manufacturing', C.blue, C.blue4], ['Industrial', C.mint, C.mint2], ['Contracting', C.violet, C.violet2]];
      const rows = tags.map(([t, f, bg], i) => G(rect(296, 92 + i * 46, 152, 38, 10, '#fff', { stroke: C.line }) + circ(314, 111 + i * 46, 10, f) + text(314, 115 + i * 46, String(i + 1), { s: 10, f: '#fff', a: 'middle', w: 800 }) + chip(332, 101 + i * 46, t, { fill: bg, color: f, h: 20, s: 9.5 }), A('pop', 0.4 + i * 0.35, 7)));
      return blob(250, 180, 170) + src
        + path_('M110 89 H290 M110 167 H290 M110 245 H290', { stroke: C.blue2, 'stroke-width': 2, 'stroke-dasharray': '4 8', fill: 'none', 'stroke-linecap': 'round', class: 'flow', style: '--dur:1.4s' })
        + movers.join('')
        + card(282, 40, 180, 228, { r: 16 }) + text(298, 66, 'Today\u2019s queue', { s: 12, w: 800 }) + chip(398, 52, '1,248', { fill: C.blue, color: '#fff', h: 22, w: 54, s: 11 }) + rows.join('')
        + G(rect(282, 288, 180, 8, 4, C.line) + an(rect(282, 288, 180, 8, 4, C.blue), A('growx', 0.2, 6, {})).replace('class="a growx"', 'class="a growx l"'), '');
    })(),
  },

  opportunities: {
    title: 'Opportunities: a pipeline that moves itself',
    body: (() => {
      const heads = ['New', 'Talking', 'Proposal', 'Won'];
      const cols = heads.map((h, i) => {
        const x = 20 + i * 112;
        return rect(x, 36, 104, 252, 14, i === 3 ? C.mint2 : '#fff', { stroke: i === 3 ? '#9AE6D0' : C.line, filter: 'url(#s-sh2)' }) + text(x + 12, 58, h, { s: 11, w: 800, f: i === 3 ? '#0E9F7E' : C.ink }) + circ(x + 88, 54, 9, i === 3 ? C.mint : C.blue4) + text(x + 88, 58, String([3, 2, 2, 1][i]), { s: 9.5, a: 'middle', w: 800, f: i === 3 ? '#fff' : C.blue });
      }).join('');
      const miniCard = (x, y, col, w = 80) => rect(x, y, w, 46, 10, '#fff', { stroke: C.line, filter: 'url(#s-sh2)' }) + circ(x + 14, y + 15, 7, col) + bar(x + 26, y + 11, w - 40, 6, C.ink2) + bar(x + 12, y + 29, w - 30, 5, C.line);
      const cards = [[32, 76, COLS[0]], [32, 134, COLS[1]], [32, 192, COLS[2]], [144, 76, COLS[3]], [144, 134, COLS[4]], [256, 76, COLS[0]]].map(([x, y, c], i) => G(miniCard(x, y, c), A('pop', 0.15 + i * 0.2, 9))).join('');
      const moving = travel(G(miniCard(256, 134, COLS[2]) + chip(264, 162, '\u00a38,000', { fill: C.blue4, color: C.blue, h: 18, s: 9.5 }), ''), '0 0; 0 0; 112 0; 112 0; 0 0', { dur: 7, keyTimes: '0;.25;.42;.9;1' });
      const won = G(miniCard(368, 76, C.mint) + circ(436, 82, 11, C.mint) + icon('check', 430, 76, 12, '#fff', 3.2), A('pop', 0.6, 9)) + G(chip(376, 196, 'Signed', { fill: '#fff', color: '#0E9F7E', icon: 'check', h: 22, s: 9.5, stroke: '#9AE6D0' }), A('rise', 3, 9));
      return blob(240, 180, 175) + cols + cards + moving + won + G(circ(436, 82, 12, C.mint), A('ping', 3.1, 2.6)) + G(chip(150, 304, '2\u00d7 points unlocked', { fill: C.ink, color: '#fff', icon: 'flame', h: 28, s: 11 }), A('rise', 3.4, 9, { dy: '14px' }));
    })(),
  },

  proposals: {
    title: 'Proposal Hub: proposals, contracts and signatures in one flow',
    body: (() => {
      const opts = [0, 1].map((i) => rect(96 + i * 100, 156, 90, 56, 10, i === 1 ? C.blue4 : '#fff', { stroke: i === 1 ? C.blue : C.line, 'stroke-width': i === 1 ? 1.6 : 1 }) + text(106 + i * 100, 176, i ? 'Growth' : 'Starter', { s: 10.5, w: 800 }) + text(106 + i * 100, 196, i ? '\u00a38,000' : '\u00a35,000', { s: 12, w: 800, f: C.blue }) + (i ? circ(272, 168, 8, C.blue) + icon('check', 268, 164, 8, '#fff', 3.6) : '')).join('');
      const doc = card(70, 28, 230, 300, { r: 16 })
        + an(bar(90, 52, 130, 10, C.ink), A('growx l', 0.2, 8)) + an(bar(90, 74, 180, 6, C.line), A('growx l', 0.5, 8)) + an(bar(90, 88, 150, 6, C.line), A('growx l', 0.7, 8))
        + an(bar(90, 106, 170, 6, C.line), A('growx l', 0.9, 8)) + an(bar(90, 120, 190, 6, C.line), A('growx l', 1.1, 8)) + an(bar(90, 134, 120, 6, C.line), A('growx l', 1.3, 8)) + G(opts, A('rise', 1.4, 8)) + G(rect(90, 226, 190, 34, 10, C.blue) + text(104, 248, 'Investment', { s: 10, f: '#fff', w: 600 }) + text(268, 248, '\u00a38,000', { s: 14, f: '#fff', w: 800, a: 'end' }), A('pop', 1.8, 8))
        + path_('M96 300 C108 276 114 312 124 292 S140 280 146 298 S168 286 178 294', { fill: 'none', stroke: C.ink, 'stroke-width': 2.4, 'stroke-linecap': 'round', pathLength: 1, class: 'a draw d', style: '--delay:2.8s;--dur:8s' })
        + bar(96, 308, 100, 2, C.line);
      const steps = ['Proposal', 'Contract', 'Onboarding', 'Handover'];
      const track = card(326, 56, 138, 214, { r: 16 }) + steps.map((s, i) => {
        const y = 86 + i * 46;
        return circ(348, y, 9, i < 2 ? C.mint : '#fff', { stroke: i < 2 ? C.mint : C.line, 'stroke-width': 2 }) + (i < 2 ? icon('check', 343, y - 5, 10, '#fff', 3.4) : '') + text(364, y + 4, s, { s: 11, w: 700, f: i < 2 ? C.ink : C.mute }) + (i < 3 ? bar(346.5, y + 12, 3, 24, i < 1 ? C.mint : C.line) : '');
      }).join('');
      return blob(260, 180, 175) + doc + G(track, A('slide', 0.4, 8, { dx: '24px' }))
        + G(rect(262, 282, 200, 44, 14, C.ink) + circ(284, 304, 12, C.mint) + icon('check', 278, 298, 12, '#fff', 3.2) + text(304, 301, 'Signed by Alex Morgan', { s: 11, f: '#fff', w: 700 }) + text(304, 315, '14 Oct 2026 \u00b7 09:34 \u00b7 IP logged', { s: 9, f: '#AEB4CC', w: 500 }), A('rise', 3.6, 8, { dy: '18px' }));
    })(),
  },

  inbound: {
    title: 'Inbound: every enquiry scored, tagged and routed instantly',
    body: (() => {
      const srcs = [['Web form', 'globe'], ['Landing page', 'studio'], ['Webhook', 'webhook']];
      const L = srcs.map(([s, ic], i) => {
        const y = 62 + i * 90;
        return G(rect(18, y, 112, 40, 20, '#fff', { stroke: C.line, filter: 'url(#s-sh2)' }) + icon(ic, 30, y + 11, 18, C.blue, 2.2) + text(54, y + 24, s, { s: 10.5, w: 700 }), A('float', i * 0.5, 3.4, { dy: '-4px' }));
      }).join('');
      const R = [C.violet, C.pink, C.mint].map((c, i) => {
        const y = 62 + i * 90;
        return G(avatar(432, y + 20, 22, c, ['AM', 'JK', 'SR'][i]) + chip(364, y + 44, '+1 lead', { fill: C.blue4, color: C.blue, h: 18, s: 9 }), A('pop', 0.8 + i * 1.1, 6));
      }).join('');
      const inP = ['M130 82 C190 82 190 180 230 180', 'M130 172 C180 172 200 180 230 180', 'M130 262 C190 262 190 180 230 180'];
      const outP = ['M262 180 C310 180 330 82 408 82', 'M262 180 C300 180 330 172 408 172', 'M262 180 C310 180 330 262 408 262'];
      const lines = [...inP, ...outP].map((d) => path_(d, { fill: 'none', stroke: C.blue3, 'stroke-width': 2.5, 'stroke-linecap': 'round' })).join('');
      const pk = [...inP.map((d, i) => packet(d, { dur: 3, begin: i * 0.9, fill: C.blue })), ...outP.map((d, i) => packet(d, { dur: 3, begin: 1.5 + i * 0.9, fill: C.mint }))].join('');
      return blob(240, 180, 170) + lines + pk + L + R
        + an(circ(246, 180, 34, C.blue), A('ping', 0, 2.6)) + circ(246, 180, 30, 'url(#s-g1)', { filter: 'url(#s-sh)' }) + icon('inbound', 232, 166, 28, '#fff', 2.2)
        + G(chip(196, 224, 'Score 86 \u00b7 Hot', { fill: C.amber2, color: '#B36B00', icon: 'flame', h: 22, s: 9.5 }), A('rise', 1.2, 6));
    })(),
  },

  calendar: {
    title: 'Calendar: meetings and callbacks, booked straight into diaries',
    body: (() => {
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
      const head = days.map((d, i) => text(104 + i * 74, 70, d, { s: 10.5, f: i === 2 ? C.blue : C.mute, a: 'middle', w: 700 })).join('') + circ(104 + 2 * 74, 62, 0, C.blue);
      const grid = [0, 1, 2, 3].map((r) => bar(60, 86 + r * 54, 392, 1, C.line)).join('') + [0, 1, 2, 3, 4, 5].map((c) => bar(66 + c * 74, 80, 1, 216, C.line)).join('');
      const ev = [[0, 0, C.violet, 'Discovery', 1], [1, 1, C.amber, 'Follow-up', 1], [2, 0, C.blue, 'Demo', 2], [3, 2, C.pink, 'Callback', 1], [4, 1, C.mint, 'Review', 1]].map(([c, r, col, t, hh], i) => G(rect(70 + c * 74, 88 + r * 54, 66, hh * 48 + (hh - 1) * 6, 9, col) + text(78 + c * 74, 106 + r * 54, t, { s: 9, f: '#fff', w: 700 }), A('pop', 0.3 + i * 0.4, 8))).join('');
      const slot = G(rect(70 + 3 * 74, 88, 66, 48, 9, 'none', { stroke: C.blue, 'stroke-width': 1.6, 'stroke-dasharray': '4 4' }), A('blink', 2, 1.6));
      const cursor = `<g><animateTransform attributeName="transform" type="translate" values="420 300; 300 112; 300 112; 420 300" keyTimes="0;.35;.8;1" dur="8s" repeatCount="indefinite"/><path d="M0 0 L0 17 L5 13 L9 21 L12 19.5 L8 12 L14 12Z" fill="${C.ink}" stroke="#fff" stroke-width="1.5"/></g>`;
      return blob(240, 180, 175) + card(36, 30, 424, 282, { r: 18 }) + head + grid + ev + slot + cursor
        + G(rect(170, 318, 220, 34, 17, C.ink) + circ(192, 335, 10, C.mint) + icon('check', 187, 330, 10, '#fff', 3.4) + text(210, 339, 'Meeting booked \u00b7 Thu 10:30', { s: 10.5, f: '#fff', w: 700 }), A('rise', 3.2, 8, { dy: '14px' }));
    })(),
  },

  campaigns: {
    title: 'Campaigns: multi-step email sequences that run themselves',
    body: (() => {
      const nodes = [['Email 1', 'Day 1', 60], ['Email 2', 'Day 3', 170], ['Email 3', 'Day 6', 280], ['Reply', 'Day 8', 390]];
      const track = path_('M60 120 H390', { stroke: C.blue3, 'stroke-width': 4, 'stroke-linecap': 'round', fill: 'none' })
        + an(path_('M60 120 H390', { stroke: C.blue, 'stroke-width': 4, 'stroke-linecap': 'round', fill: 'none', pathLength: 1 }), 'class="a draw d" style="--dur:8s;--delay:.2s"');
      const ns = nodes.map(([l, d, x], i) => G(card(x - 38, 84, 76, 72, { r: 14 }) + icon(i === 3 ? 'check' : 'email', x - 10, 96, 20, i === 3 ? C.mint : C.blue, 2.2) + text(x, 138, l, { s: 10.5, a: 'middle', w: 800 }) + text(x, 150, d, { s: 8.5, a: 'middle', f: C.mute, w: 600 }), A('pop', 0.3 + i * 0.5, 9))).join('');
      const planes = plane('M60 120 C100 60 130 60 170 120', { dur: 3.2, begin: 0 }) + plane('M170 120 C210 60 240 60 280 120', { dur: 3.2, begin: 1.1, fill: C.violet }) + plane('M280 120 C320 60 350 60 390 120', { dur: 3.2, begin: 2.2, fill: C.mint });
      const kp = [['Sent', 100, C.blue, 120], ['Opened', 62, C.violet, 130], ['Replied', 24, C.mint, 150]].map(([l, v, c, x], i) => G(card(40 + i * 140, 196, 124, 104, { r: 14 }) + text(54 + i * 140, 222, l, { s: 10, w: 700, f: C.mute }) + text(54 + i * 140, 252, `${[412, 256, 98][i]}`, { s: 24, w: 800 }) + rect(54 + i * 140, 274, 96, 8, 4, C.line) + an(rect(54 + i * 140, 274, 96 * v / 100, 8, 4, c), A('growx l', 0.8 + i * 0.3, 9)), A('rise', 0.6 + i * 0.3, 9))).join('');
      return blob(240, 190, 175) + track + planes + ns + kp;
    })(),
  },

  'email-copy': {
    title: 'Email copy library: proven templates, ready to personalise',
    body: (() => {
      const lines = (x, y, w, d) => [0, 1, 2, 3].map((i) => an(bar(x, y + i * 14, w * [1, .92, .96, .6][i], 6, i === 0 ? C.ink2 : C.line), A('growx l', d + i * 0.15, 8))).join('');
      const back2 = G(card(82, 66, 290, 214, { r: 16, fill: C.blue4 }), A('float', 0.4, 4, { dy: '-3px' }));
      const back1 = G(card(66, 52, 290, 214, { r: 16, fill: '#F6F8FF' }), A('float', 0.2, 4.4, { dy: '-3px' }));
      const top = G(card(50, 38, 290, 214, { r: 16 }) + circ(78, 66, 11, C.blue) + icon('email', 72, 60, 12, '#fff', 2.4) + text(98, 70, 'Cold intro \u00b7 Engineering', { s: 11, w: 800 })
        + lines(70, 96, 244, 0.6) + rect(70, 160, 112, 22, 11, C.blue4) + text(126, 175, '{{first_name}}', { s: 10.5, f: C.blue, w: 700, a: 'middle' }) + lines(70, 192, 210, 1.6)
        + chip(70, 226, 'Cold', { fill: C.pink2, color: C.pink, h: 20, s: 9 }) + chip(112, 226, 'Day 1', { fill: C.blue4, color: C.blue, h: 20, s: 9 }), A('slide', 0, 8, { dx: '-14px' }));
      return blob(220, 180, 175) + back2 + back1 + top
        + G(chip(330, 70, 'Personalised', { fill: C.ink, color: '#fff', icon: 'sparkles', h: 26, s: 10.5 }), A('rise', 1.2, 8))
        + G(chip(346, 266, 'Use template', { fill: C.blue, color: '#fff', icon: 'arrow', h: 30, s: 11, w: 118 }), A('pulse', 0, 2.2, { sc: 1.06 }));
    })(),
  },

  waves: {
    title: 'Waves: release outreach in controlled batches',
    body: (() => {
      const wavePath = (y, amp, per) => { let d = `M-${per} ${y}`; for (let x = -per; x < 480 + per * 2; x += per) d += ` q ${per / 4} ${-amp} ${per / 2} 0 t ${per / 2} 0`; return d + ' V360 H-' + per + ' Z'; };
      const W = (y, fill, op, dur, per, amp, delay) => G(`<path d="${wavePath(y, amp, per)}" fill="${fill}" opacity="${op}"/>`, `class="a wave" style="--dur:${dur}s;--w:-${per}px;--delay:${delay}s"`);
      const clip = '<clipPath id="wv-clip"><rect x="36" y="36" width="408" height="288" rx="20"/></clipPath>';
      const dots = [[120, 168, C.blue], [210, 150, C.violet], [300, 166, C.mint], [380, 152, C.pink]].map(([x, y, c], i) => G(circ(x, y, 9, c, { stroke: '#fff', 'stroke-width': 3 }), A('float', i * 0.5, 2.4, { dy: '-12px' }))).join('');
      return `${clip}${blob(240, 180, 175)}`
        + rect(36, 36, 408, 288, 20, '#fff', { stroke: C.line, filter: 'url(#s-sh)' })
        + `<g clip-path="url(#wv-clip)">${W(150, C.blue4, 1, 9, 240, 26, 0)}${W(190, C.blue3, 1, 7, 160, 18, 0)}${W(232, C.blue2, 0.9, 5.5, 120, 14, 0)}${W(274, C.blue, 1, 4, 96, 10, 0)}</g>`
        + dots
        + chip(56, 54, 'Wave 1 \u00b7 Live', { fill: C.mint2, color: '#0E9F7E', icon: 'play', h: 26, s: 10.5 }) + chip(176, 54, 'Wave 2 \u00b7 Queued', { fill: C.amber2, color: '#B36B00', icon: 'clock', h: 26, s: 10.5 }) + chip(316, 54, 'Wave 3', { fill: '#fff', stroke: C.line, color: C.mute, h: 26, s: 10.5 })
        + G(text(66, 304, '312 contacts released \u00b7 follow-up on track', { s: 10.5, f: '#fff', w: 700 }), A('fade', 0.5, 6));
    })(),
  },
};
