/* In-memory state + interaction helpers shared by every mockup.
   Reload the page to reset. Never talks to any live API. */
(() => {
  const initial = {
    worked: new Set(),              // lead ids removed from today's list
    overrides: {},                  // { leadId: {status, disposition, callbackAt, priority} }
    notesByLead: {},                // { leadId: [{who, when, kind, text}] }
    counters: {                     // running totals for the day
      dialed:      MOCK.stats.dialed,
      connected:   MOCK.stats.connected,
      emailsSent:  MOCK.stats.sent,
    },
    subs: new Set(),                // change subscribers
    lastDialAt: null,               // used to mark the "in call" pill
  };

  const S = window.STATE = {
    ...initial,

    now() { return new Date(); },

    // Read helper: merges any overrides.
    get(leadOrId) {
      const l = typeof leadOrId === 'string'
        ? MOCK.leads.find((x) => x.id === leadOrId)
        : leadOrId;
      if (!l) return null;
      const ov = S.overrides[l.id] || {};
      return { ...l, ...ov, noteCount: (l.noteCount || 0) + ((S.notesByLead[l.id] || []).length) };
    },

    // All leads still in today's list (i.e. not marked worked).
    activeLeads() {
      return MOCK.leads.filter((l) => !S.worked.has(l.id)).map((l) => S.get(l));
    },

    on(fn) { S.subs.add(fn); return () => S.subs.delete(fn); },
    emit(evt) { S.subs.forEach((fn) => { try { fn(evt); } catch {} }); },

    addNote(id, text, kind = 'note', who = MOCK.rep.name) {
      if (!text || !text.trim()) return null;
      const arr = S.notesByLead[id] || (S.notesByLead[id] = []);
      const entry = { who, when: new Date().toISOString(), kind, text: text.trim() };
      arr.unshift(entry);
      S.emit({ type: 'note', id });
      return entry;
    },

    /* Merged notes for a lead: user-added (from this session) + seeded historical,
       sorted newest-first. Empty array when there are none. */
    allNotes(id) {
      const l = MOCK.leads.find((x) => x.id === id);
      const seeded = (l && l.notes) || [];
      const added = S.notesByLead[id] || [];
      return [...added, ...seeded].sort((a, b) => new Date(b.when) - new Date(a.when));
    },

    /* Fake-dial a lead: returns a Promise that resolves ~1.3s later with a
       suggested outcome key so mockups can auto-preselect it. */
    dial(id) {
      S.counters.dialed += 1;
      S.lastDialAt = { id, at: Date.now() };
      S.emit({ type: 'dial', id });
      const l = S.get(id);
      const roll = Math.random();
      // Bias: hot leads answer more often; overdue callbacks answer more.
      const pri = (l && l.priority) || 'warm';
      const connectP = pri === 'hot' ? 0.65 : pri === 'warm' ? 0.45 : 0.30;
      return new Promise((resolve) => {
        setTimeout(() => {
          if (roll < connectP) {
            S.counters.connected += 1;
            S.emit({ type: 'connected', id });
            resolve({ connected: true, suggest: pri === 'cold' ? 'wants_info' : 'interested' });
          } else {
            const vm = Math.random() < 0.4;
            resolve({ connected: false, suggest: vm ? 'voicemail' : 'no_answer' });
          }
        }, 1300 + Math.random() * 400);
      });
    },

    /* Apply an outcome. Returns a { removed, moved } summary so mockups can
       animate or advance to the next lead as appropriate. */
    applyOutcome(id, key, extras = {}) {
      const l = MOCK.leads.find((x) => x.id === id);
      if (!l) return { removed: false };
      const ov = S.overrides[id] || (S.overrides[id] = {});
      let removed = false;
      let toast = '';

      switch (key) {
        case 'interested':
          ov.status = 'to_call_back';
          ov.disposition = 'Interested';
          if (extras.callbackAt) ov.callbackAt = extras.callbackAt;
          else ov.callbackAt = plusHours(2);
          removed = true;
          toast = `Callback booked for ${fmtTime(ov.callbackAt)} · lead cleared from today's list`;
          break;
        case 'wants_info':
          ov.status = 'wants_more_info';
          ov.disposition = 'Send email';
          S.counters.emailsSent += 1;
          removed = true;
          toast = 'Info pack queued to send · lead cleared from today\'s list';
          break;
        case 'no_answer':
          ov.status = 'no_answer';
          ov.disposition = 'No answer';
          removed = true;
          toast = 'Marked no answer · recycled for tomorrow AM';
          break;
        case 'voicemail':
          ov.status = 'no_answer';
          ov.disposition = 'Left voicemail';
          removed = true;
          toast = 'Voicemail logged · retry scheduled for later today';
          break;
        case 'gatekeeper':
          ov.disposition = 'Gatekeeper';
          S.counters.emailsSent += 1;
          removed = true;
          toast = 'Gatekeeper logged · intro email sent';
          break;
        case 'not_interested':
          ov.status = 'not_interested';
          ov.disposition = 'Not interested';
          removed = true;
          toast = 'Not interested · removed from your queue';
          break;
        case 'wrong_number':
          ov.status = 'not_interested';
          ov.disposition = 'Wrong number';
          removed = true;
          toast = 'Flagged for admin cleanup · removed from queue';
          break;
        case 'qualify':
          ov.status = 'qualified';
          ov.disposition = 'Qualified';
          removed = true;
          toast = 'Qualified → pushed to CRM pipeline';
          break;
        default:
          break;
      }

      if (extras.note) S.addNote(id, extras.note, 'call');
      if (removed) S.worked.add(id);
      S.emit({ type: 'outcome', id, key, removed });
      if (toast) S.toast(toast);
      return { removed, toast };
    },

    reset() {
      S.worked = new Set();
      S.overrides = {};
      S.notesByLead = {};
      S.counters = { dialed: MOCK.stats.dialed, connected: MOCK.stats.connected, emailsSent: MOCK.stats.sent };
      S.emit({ type: 'reset' });
    },

    toast(msg, tone = 'ok') {
      let host = document.getElementById('sq-toast-host');
      if (!host) {
        host = document.createElement('div');
        host.id = 'sq-toast-host';
        host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
        document.body.appendChild(host);
      }
      const t = document.createElement('div');
      const bg = tone === 'bad' ? '#7f1d1d' : tone === 'warn' ? '#78350f' : '#0f172a';
      t.style.cssText = `background:${bg};color:#fff;padding:12px 16px;border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.18);font:600 13px 'Inter',system-ui,sans-serif;max-width:360px;line-height:1.4;transform:translateY(10px);opacity:0;transition:transform .2s, opacity .2s;pointer-events:auto;`;
      t.textContent = msg;
      host.appendChild(t);
      requestAnimationFrame(() => { t.style.transform = 'translateY(0)'; t.style.opacity = '1'; });
      setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateY(10px)';
        setTimeout(() => t.remove(), 250);
      }, 2600);
    },
  };

  function pad(n) { return String(n).padStart(2, '0'); }
  function plusHours(h) { const d = new Date(); d.setHours(d.getHours() + h); return d.toISOString(); }
  function fmtTime(iso) { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

  // Public shared outcome catalogue so every mockup renders identical buttons.
  window.OUTCOMES = [
    { key:'interested',     tone:'good', label:'Interested — book callback', hint:'Sets follow-up + moves to Wants info' },
    { key:'wants_info',     tone:'info', label:'Wants info (email)',         hint:'Sends info pack, sets 3-day nudge' },
    { key:'no_answer',      tone:'warn', label:'No answer',                  hint:'Recycled tomorrow AM' },
    { key:'voicemail',      tone:'warn', label:'Left voicemail',             hint:'Retry later today' },
    { key:'gatekeeper',     tone:'warn', label:'Gatekeeper',                 hint:'Email + retry with name' },
    { key:'not_interested', tone:'bad',  label:'Not interested',             hint:'Removes from queue' },
    { key:'wrong_number',   tone:'bad',  label:'Wrong number',               hint:'Flagged for admin' },
    { key:'qualify',        tone:'good', label:'Qualify → Opportunity',      hint:'Push to CRM pipeline' },
  ];
})();
