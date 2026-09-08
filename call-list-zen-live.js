/* Live data adapter for call-list-zen.html. Uses the authenticated sales queue APIs. */
(function () {
  const STATUS_LABELS = {
    to_contact: 'To contact',
    to_call_back: 'Call back',
    wants_more_info: 'Wants info',
    no_answer: 'No answer',
    contacted: 'Contacted',
    qualified: 'Qualified',
    converted: 'Converted',
    not_interested: 'Not interested',
  };
  const OPPORTUNITY_STAGES = {
    qualified: { label: 'Qualified' },
    meeting_booked: { label: 'Meeting booked' },
    meeting_no_show: { label: 'No show' },
    meeting_attended: { label: 'Meeting attended' },
    scoping: { label: 'Scoping' },
    proposal: { label: 'Proposal sent' },
    won: { label: 'Closed won' },
    lost: { label: 'Closed lost' },
  };
  const CALLABLE_STATUSES = new Set(['to_contact', 'no_answer', 'contacted']);
  const OUTCOME_MAP = {
    wants_info: { outcome: 'Answered - wants info', status: 'wants_more_info', disposition: 'Send email' },
    no_answer: { outcome: 'No answer', status: 'no_answer', disposition: 'No answer' },
    voicemail: { outcome: 'Left voicemail', status: 'no_answer', disposition: 'Left voicemail' },
    gatekeeper: { outcome: 'Gatekeeper', status: 'wants_more_info', disposition: 'Gatekeeper - send email' },
    not_interested: { outcome: 'Answered - not interested', status: 'not_interested', disposition: 'Not interested' },
    wrong_number: { outcome: 'Wrong number', status: 'not_interested', disposition: 'Wrong number' },
  };

  // Display metadata for the outcome grid; keys must match OUTCOME_MAP + interested/qualify.
  window.OUTCOMES = [
    { key: 'interested',     tone: 'good', label: 'Interested — book callback', hint: 'Sets follow-up + moves to Wants info' },
    { key: 'wants_info',     tone: 'info', label: 'Wants info (email)',         hint: 'Manual email follow-up required' },
    { key: 'no_answer',      tone: 'warn', label: 'No answer',                  hint: 'Recycled for tomorrow' },
    { key: 'voicemail',      tone: 'warn', label: 'Left voicemail',             hint: 'Retry later on' },
    { key: 'gatekeeper',     tone: 'warn', label: 'Gatekeeper',                 hint: 'Manual email and retry required' },
    { key: 'not_interested', tone: 'bad',  label: 'Not interested',             hint: 'Removes from your queue' },
    { key: 'wrong_number',   tone: 'bad',  label: 'Wrong number',               hint: 'Flag for admin cleanup' },
    { key: 'qualify',        tone: 'good', label: 'Qualify → Opportunity',      hint: 'Push to CRM pipeline' },
  ];

  window.MOCK = {
    rep: { id: '', name: '', initials: '', email: '', ext: '', avatarColor: '#6366f1' },
    stats: { dialed: 0, connected: 0 },
    leads: [],
    opportunities: [],
    STATUS_LABELS,
    OPPORTUNITY_STAGES,
    now: new Date().toISOString(),
  };

  function initials(name, email) {
    const parts = String(name || email || '?').trim().split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
  }
  function api(body) {
    return fetch('/api/apollo-sales-queue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body),
    }).then((res) => res.json().catch(() => ({ success: false, error: 'Request failed' })));
  }
  function isMine(lead) {
    const mine = String(MOCK.rep.id || '');
    return !mine || String(lead.ownerId || '') === mine;
  }
  function hasPhone(lead) {
    return !!String(lead?.directPhone || lead?.phone || '').trim();
  }
  function isCovered(lead) {
    const disposition = String(lead?.disposition || '').toLowerCase();
    return disposition.includes('covered by colleague') || disposition.includes('already worked this company');
  }
  function isEmailFollowup(lead) {
    return String(lead?.disposition || '').toLowerCase().includes('send email');
  }
  function isCallbackDue(lead) {
    if (!lead?.callbackAt) return false;
    const when = new Date(lead.callbackAt);
    if (Number.isNaN(when.getTime())) return false;
    const end = new Date(); end.setHours(23, 59, 59, 999);
    return when <= end;
  }
  function isCallableNow(lead) {
    if (!CALLABLE_STATUSES.has(lead?.status) || isCovered(lead) || isEmailFollowup(lead)) return false;
    if (!lead?.callbackAt) return true;
    const when = new Date(lead.callbackAt);
    return Number.isNaN(when.getTime()) || when <= new Date();
  }

  const STATE = window.STATE = {
    worked: new Set(),
    notesByLead: {},
    counters: { dialed: 0, connected: 0 },
    caps: {},
    user: {},

    toast(message, tone = 'ok') {
      let host = document.getElementById('zen-toast-host');
      if (!host) {
        host = document.createElement('div');
        host.id = 'zen-toast-host';
        host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:9999;display:grid;gap:8px;pointer-events:none;';
        document.body.appendChild(host);
      }
      const toast = document.createElement('div');
      const background = tone === 'bad' ? '#7f1d1d' : tone === 'warn' ? '#78350f' : '#0f172a';
      toast.style.cssText = `max-width:360px;padding:12px 16px;border-radius:12px;background:${background};color:#fff;box-shadow:0 12px 30px rgba(0,0,0,.18);font:600 13px Inter,system-ui,sans-serif;opacity:0;transform:translateY(10px);transition:opacity .2s,transform .2s;`;
      toast.textContent = message;
      host.appendChild(toast);
      requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; });
      setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(10px)'; setTimeout(() => toast.remove(), 220); }, 2600);
    },

    async init(caps, user) {
      this.caps = caps || {};
      this.user = user || {};
      MOCK.rep = {
        id: String(user?.ghlOwnerId || ''),
        name: user?.name || user?.email || 'My queue',
        initials: initials(user?.name, user?.email),
        email: user?.email || '',
        ext: '',
        avatarColor: user?.avatarColor || '#6366f1',
      };
      await this.refresh();
    },

    async refresh() {
      const [queueResponse, oppResponse] = await Promise.all([
        fetch('/api/apollo-sales-queue?source=outbound', { credentials: 'same-origin' })
          .then((res) => res.json().catch(() => ({ success: false, error: 'Could not load queue' }))),
        fetch(`/api/opportunities-report?ownerId=${encodeURIComponent(MOCK.rep.id)}`, { credentials: 'same-origin' })
          .then((res) => res.json().catch(() => ({ success: false, opportunities: [] }))),
      ]);
      if (!queueResponse?.success) throw new Error(queueResponse?.error || 'Could not load live call queue');

      MOCK.leads = (queueResponse.contacts || []).filter(isMine);
      MOCK.opportunities = (oppResponse?.success ? oppResponse.opportunities : []).map((opportunity) => ({
        id: opportunity.id,
        ownerId: opportunity.ownerId,
        contactName: opportunity.contactName,
        companyName: opportunity.companyName,
        stage: opportunity.stage,
        mrrValue: Number(opportunity.mrrValue || 0),
        oneOffValue: Number(opportunity.oneOffValue || 0),
        updatedAt: opportunity.updatedAt,
        nextAction: opportunity.nextStepSummary || 'No next step recorded',
      }));
      this.worked.clear();
      this.counters = {
        dialed: Number(oppResponse?.funnel?.calls?.made || 0),
        connected: Number(oppResponse?.funnel?.calls?.answered || 0),
      };
    },

    get(leadOrId) {
      const id = typeof leadOrId === 'string' ? leadOrId : leadOrId?.id;
      return MOCK.leads.find((lead) => String(lead.id) === String(id)) || null;
    },
    activeLeads() {
      return MOCK.leads.filter((lead) =>
        hasPhone(lead)
        && !lead.companyLocked
        && !isCovered(lead)
        && !this.worked.has(String(lead.id))
        && (isCallbackDue(lead) || isCallableNow(lead))
      );
    },
    allNotes(id) {
      return this.notesByLead[id] || [];
    },
    async hydrateNotes(id) {
      const response = await api({ action: 'notes-history', id });
      if (!response?.success) throw new Error(response?.error || 'Could not load notes');
      this.notesByLead[id] = (response.notes || []).map((note) => ({
        who: note.ownerName || 'Unknown owner',
        when: note.createdAt || null,
        kind: note.source === 'legacy_field_snapshot' ? 'note' : (note.source || 'note'),
        text: note.note || '',
      }));
      return this.notesByLead[id];
    },
    async addNote(id, text) {
      const response = await api({ action: 'add-lead-note', id, note: text, source: 'call-list-zen' });
      if (!response?.success) throw new Error(response?.error || 'Could not save note');
      this.notesByLead[id] = null;
      return response.note;
    },
    async applyOutcome(id, key, extras = {}) {
      if (key === 'qualify') {
        const response = await api({ action: 'qualify', id, answers: extras.answers || {}, notes: extras.note || undefined });
        if (!response?.success) throw new Error(response?.error || 'Could not qualify lead');
      } else if (key === 'interested') {
        const response = await api({
          action: 'log-call', id, direction: 'outbound', outcome: 'Answered - interested',
          setStatus: 'to_call_back', setDisposition: 'Interested', callbackAt: extras.callbackAt, notes: extras.note || undefined,
        });
        if (!response?.success) throw new Error(response?.error || 'Could not book callback');
      } else {
        const outcome = OUTCOME_MAP[key];
        if (!outcome) throw new Error('Unsupported outcome');
        const response = await api({
          action: 'log-call', id, direction: 'outbound', outcome: outcome.outcome,
          setStatus: outcome.status, setDisposition: outcome.disposition, notes: extras.note || undefined,
        });
        if (!response?.success) throw new Error(response?.error || 'Could not save call outcome');
      }
      await this.refresh();
      return { removed: true };
    },
    async snooze(id) {
      const target = new Date();
      target.setDate(target.getDate() + 1);
      target.setHours(9, 0, 0, 0);
      const response = await api({ action: 'disposition', id, disposition: 'Snoozed', callbackAt: target.toISOString() });
      if (!response?.success) throw new Error(response?.error || 'Could not snooze lead');
      await this.refresh();
      return target.toISOString();
    },
  };
})();
