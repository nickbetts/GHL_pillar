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
  const CALLBACK_STATUSES = new Set([...CALLABLE_STATUSES, 'to_call_back', 'wants_more_info']);
  const londonDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
  function londonDay(value = new Date()) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const parts = Object.fromEntries(londonDate.formatToParts(date).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
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
    { key: 'interested',     tone: 'good', label: 'Interested — book callback', hint: 'Schedules a callback' },
    { key: 'wants_info',     tone: 'info', label: 'Wants info (email)',         hint: 'Manual email follow-up required' },
    { key: 'no_answer',      tone: 'warn', label: 'No answer',                  hint: 'Recycled for tomorrow' },
    { key: 'voicemail',      tone: 'warn', label: 'Left voicemail',             hint: 'Retry later on' },
    { key: 'gatekeeper',     tone: 'warn', label: 'Gatekeeper',                 hint: 'Manual email and retry required' },
    { key: 'not_interested', tone: 'bad',  label: 'Not interested',             hint: 'Removes from your queue' },
    { key: 'wrong_number',   tone: 'bad',  label: 'Wrong number',               hint: 'Flag for admin cleanup' },
    { key: 'qualify',        tone: 'good', label: 'Qualify → Opportunity',      hint: 'Create a qualified opportunity' },
  ];

  window.MOCK = {
    rep: { id: '', name: '', initials: '', email: '', ext: '', avatarColor: '#6366f1', workspaceBackground: '/webgl' },
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
    return !!mine && String(lead.ownerId || '') === mine;
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
    if (!CALLBACK_STATUSES.has(lead?.status) || !lead.callbackAt) return false;
    const day = londonDay(lead.callbackAt);
    return !!day && day <= londonDay();
  }
  function isCallableNow(lead) {
    if (!CALLABLE_STATUSES.has(lead?.status) || isCovered(lead) || isEmailFollowup(lead)) return false;
    if (lead.callbackAt && londonDay(lead.callbackAt)) return false;
    if (lead.status === 'no_answer' && lead.lastTouchAt && londonDay(lead.lastTouchAt) >= londonDay()) return false;
    return true;
  }
  function sourceBucket(lead) {
    const source = String(lead?.source || 'outbound').toLowerCase();
    if (source === 'google_maps') return 'google_maps';
    if (source === 'hs_pd' || source === 'hubspot_pipedrive') return 'hs_pd';
    if (source === 'apollo') return 'apollo';
    return 'outbound';
  }
  function interleaveBySource(leads) {
    const rank = { hot: 0, warm: 1, cold: 2 };
    const buckets = new Map();
    for (const lead of leads) {
      const key = sourceBucket(lead);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(lead);
    }
    for (const rows of buckets.values()) {
      rows.sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9) || new Date(b.createdAt || b.lastTouchAt || 0) - new Date(a.createdAt || a.lastTouchAt || 0) || Number(a.id) - Number(b.id));
    }
    const keys = Array.from(buckets.keys()).sort((a, b) => (buckets.get(b).length - buckets.get(a).length) || a.localeCompare(b));
    const out = [];
    let moved = true;
    while (moved) {
      moved = false;
      for (const key of keys) {
        const next = buckets.get(key).shift();
        if (!next) continue;
        out.push(next);
        moved = true;
      }
    }
    return out;
  }

  const STATE = window.STATE = {
    londonDay,
    worked: new Set(),
    notesByLead: {},
    noteVersions: {},
    reportError: '',
    refreshVersion: 0,
    meetingsByLead: {},
    taxonomy: { sectors: [], subSectorsBySector: {} },
    counters: { dialed: 0, connected: 0, byOwner: [] },
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
        avatar: user?.avatar || '',
        avatarColor: user?.avatarColor || '#6366f1',
        workspaceBackground: user?.workspaceBackground || '/webgl',
      };
      await this.refresh();
    },

    async refresh() {
      if (!MOCK.rep.id) throw new Error('Your account has no rep mapping. Ask an admin to set your GHL owner ID.');
      const version = ++this.refreshVersion;
      const [queueResponse, oppResponse, taxonomyResponse] = await Promise.all([
        fetch('/api/apollo-sales-queue?source=outbound', { credentials: 'same-origin' })
          .then((res) => res.json().catch(() => ({ success: false, error: 'Could not load queue' }))),
        fetch(`/api/opportunities-report?ownerId=${encodeURIComponent(MOCK.rep.id)}`, { credentials: 'same-origin' })
          .then((res) => res.ok ? res.json() : { success: false })
          .catch(() => ({ success: false })),
        fetch('/api/apollo-sales-queue?source=taxonomy', { credentials: 'same-origin' })
          .then((res) => res.ok ? res.json() : { success: false })
          .catch(() => ({ success: false })),
      ]);
      if (version !== this.refreshVersion) return;
      if (!queueResponse?.success) throw new Error(queueResponse?.error || 'Could not load live call queue');
      if (taxonomyResponse?.success) this.taxonomy = taxonomyResponse;

      MOCK.leads = (queueResponse.contacts || []).filter(isMine);
      this.worked.clear();
      this.reportError = oppResponse?.success ? '' : 'Calls and opportunity figures are unavailable. Retry refresh.';
      if (this.reportError) return;
      this.meetingsByLead = {};
      for (const meeting of (oppResponse.meetings || [])) {
        const key = String(meeting.leadId || meeting.id || '');
        if (!key) continue;
        (this.meetingsByLead[key] ||= []).push(meeting);
      }
      MOCK.opportunities = (oppResponse?.success ? oppResponse.opportunities : []).map((opportunity) => ({
        id: opportunity.id,
        ownerId: opportunity.ownerId,
        contactName: opportunity.contactName,
        title: opportunity.title,
        email: opportunity.email,
        phone: opportunity.phone,
        directPhone: opportunity.directPhone,
        companyName: opportunity.companyName,
        companyWebsite: opportunity.companyWebsite,
        linkedinUrl: opportunity.linkedinUrl,
        sector: opportunity.sector,
        subSector: opportunity.subSector,
        callNotes: opportunity.callNotes,
        qualifyAnswers: opportunity.qualifyAnswers,
        disposition: opportunity.disposition,
        stage: opportunity.stage,
        mrrValue: Number(opportunity.mrrValue || 0),
        oneOffValue: Number(opportunity.oneOffValue || 0),
        updatedAt: opportunity.updatedAt,
        nextAction: opportunity.nextStepSummary || 'No next step recorded',
        callbackAt: opportunity.callbackAt,
        dealType: opportunity.dealType,
        lossReason: opportunity.lossReason,
        proposalSentAt: opportunity.proposalSentAt,
        decisionDeadlineAt: opportunity.decisionDeadlineAt,
        meetingScheduledAt: opportunity.meetingScheduledAt,
      }));
      this.counters = {
        dialed: Number(oppResponse?.funnel?.calls?.made || 0),
        connected: Number(oppResponse?.funnel?.calls?.answered || 0),
        byOwner: Array.isArray(oppResponse?.funnel?.calls?.byOwner) ? oppResponse.funnel.calls.byOwner : [],
      };
    },

    get(leadOrId) {
      const id = typeof leadOrId === 'object' ? leadOrId?.id : leadOrId;
      return MOCK.leads.find((lead) => String(lead.id) === String(id)) || null;
    },
    activeLeads() {
      return interleaveBySource(MOCK.leads.filter((lead) =>
        hasPhone(lead)
        && !lead.companyLocked
        && !isCovered(lead)
        && !this.worked.has(String(lead.id))
        && isCallableNow(lead)
      ));
    },
    dueCallbacks() {
      return MOCK.leads.filter((lead) =>
        hasPhone(lead)
        && !lead.companyLocked
        && !isCovered(lead)
        && !this.worked.has(String(lead.id))
        && isCallbackDue(lead)
      );
    },
    allNotes(id) {
      return this.notesByLead[id] || [];
    },
    async hydrateNotes(id) {
      const version = (this.noteVersions[id] || 0) + 1;
      this.noteVersions[id] = version;
      const response = await api({ action: 'notes-history', id });
      if (!response?.success) throw new Error(response?.error || 'Could not load notes');
      if (this.noteVersions[id] !== version) return this.allNotes(id);
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
      const lead = this.get(id);
      if (lead) lead.noteCount = Number(lead.noteCount || 0) + 1;
      try {
        await this.hydrateNotes(id);
      } catch (error) {
        this.toast('Note saved, but the timeline could not refresh. Reopen the contact to retry.', 'warn');
      }
      return response.note;
    },
    async refreshAfterSave(id) {
      this.worked.add(String(id));
      try {
        await this.refresh();
      } catch (error) {
        this.toast('Changes saved, but the queue could not refresh. Refresh to retry loading.', 'warn');
      }
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
      await this.refreshAfterSave(id);
      return { removed: true };
    },
    async qualify(id, answers, note, meetingScheduledAt, nextStepSummary) {
      const response = await api({ action: 'qualify', id, answers: answers || {}, notes: note || undefined, meetingScheduledAt: meetingScheduledAt || null, nextStepSummary: nextStepSummary || null });
      if (!response?.success) throw new Error(response?.error || 'Could not qualify lead');
      await this.refreshAfterSave(id);
    },
    async saveFollowup(id, outcome, status, disposition, callbackAt, note) {
      const response = await api({ action: 'log-call', id, direction: 'outbound', outcome, setStatus: status, setDisposition: disposition, callbackAt: callbackAt || undefined, notes: note || undefined });
      if (!response?.success) throw new Error(response?.error || 'Could not save follow-up');
      await this.refreshAfterSave(id);
    },
    async snooze(id) {
      const target = new Date();
      target.setDate(target.getDate() + 1);
      target.setHours(9, 0, 0, 0);
      const response = await api({ action: 'disposition', id, disposition: 'Snoozed', callbackAt: target.toISOString() });
      if (!response?.success) throw new Error(response?.error || 'Could not snooze lead');
      await this.refreshAfterSave(id);
      return target.toISOString();
    },
    async updateLead(id, changes) {
      const actions = [];
      if (changes.name !== undefined || changes.title !== undefined) {
        actions.push(api({ action: 'set-lead-name', id, name: changes.name, title: changes.title || null }));
      }
      if (changes.sector !== undefined || changes.subSector !== undefined) {
        actions.push(api({ action: 'set-sector', id, sector: changes.sector || '', subSector: changes.subSector || '' }));
      }
      if (changes.priority !== undefined) actions.push(api({ action: 'priority', id, priority: changes.priority }));
      if (changes.status !== undefined) actions.push(api({ action: 'status', id, status: changes.status, notes: changes.notes || undefined }));
      if (!actions.length) return;
      const responses = await Promise.all(actions);
      const failed = responses.find((response) => !response?.success);
      if (failed) throw new Error(failed.error || 'Could not update lead');
      await this.refreshAfterSave(id);
    },
    async reassign(id, ownerId) {
      const response = await api({ action: 'reassign', id, ownerId });
      if (!response?.success) throw new Error(response?.error || 'Could not reassign lead');
      await this.refreshAfterSave(id);
    },
    async updateDisposition(id, disposition, callbackAt) {
      const response = await api({ action: 'disposition', id, disposition, callbackAt: callbackAt || null });
      if (!response?.success) throw new Error(response?.error || 'Could not update disposition');
      await this.refreshAfterSave(id);
    },
    async voidLead(id) {
      const response = await api({ action: 'void-contact', id });
      if (!response?.success) throw new Error(response?.error || 'Could not void contact');
      await this.refreshAfterSave(id);
    },
    async bookOpportunityMeeting(id, meeting) {
      const response = await api({ action: 'book-opportunity-meeting', id, ...meeting });
      if (!response?.success) throw new Error(response?.error || 'Could not book meeting');
      await this.refreshAfterSave(id);
      return response.meeting || response;
    },
    async logMeetingOutcome(id, outcome, meetingId, meetingAt = null) {
      const response = await api({ action: 'log-meeting-outcome', id, outcome, meetingId: meetingId || undefined, meetingAt: meetingAt || undefined });
      if (!response?.success) throw new Error(response?.error || 'Could not update meeting outcome');
      await this.refreshAfterSave(id);
      return response;
    },
    async setOpportunityStage(id, stage, fields = {}) {
      const response = await api({ action: 'set-opportunity-stage', id, stage, ...fields });
      if (!response?.success) throw new Error(response?.error || 'Could not update opportunity stage');
      await this.refreshAfterSave(id);
      return response;
    },
    async updateOpportunityFollowup(id, nextStepSummary, callbackAt) {
      const response = await api({ action: 'set-opportunity-followup', id, nextStepSummary, callbackAt: callbackAt || null });
      if (!response?.success) throw new Error(response?.error || 'Could not update opportunity follow-up');
      await this.refreshAfterSave(id);
      return response;
    },
  };
})();
