function formatDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

const eventLabels = {
  ad_click: 'Ad click',
  form_submit: 'Form submitted',
  crm_status_change: 'CRM status change',
  call: 'Call logged',
  text: 'Text sent',
  conversion: 'Converted'
};

function eventMetaLine(event) {
  if (!event.metadata) return '';
  if (event.event_type === 'ad_click') {
    return `${escapeHtml(String(event.metadata.platform).replace('_', ' '))} · ${escapeHtml(event.metadata.campaign)}`;
  }
  if (event.event_type === 'crm_status_change') {
    return `LeadPerfection ID ${escapeHtml(event.metadata.lead_perfection_id || 'pending')}`;
  }
  return '';
}

function formatTranscript(rawText) {
  if (!rawText) return 'No transcript available.';
  return rawText.split('\n').filter((line) => line.trim() !== '').map((line) => {
    const trimmed = line.trim();
    const match = trimmed.match(/^(Caller|Recipient)\b(.*)$/);
    if (match) {
      const speaker = match[1];
      const speakerClass = speaker === 'Caller' ? 'transcript-caller' : 'transcript-recipient';
      return `<div class="transcript-line"><span class="transcript-speaker ${speakerClass}">${speaker}</span>${escapeHtml(match[2])}</div>`;
    }
    return `<div class="transcript-line">${escapeHtml(trimmed)}</div>`;
  }).join('');
}

async function loadLeadDetail() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) {
    window.location.href = '/leads.html';
    return;
  }

  const res = await fetch(`/api/leads/${id}`);
  if (res.status === 401) {
    window.location.href = '/login.html';
    return;
  }
  if (res.status === 404) {
    document.getElementById('lead-name').textContent = 'Lead not found';
    return;
  }

  const { lead, events, calls, texts } = await res.json();

  document.getElementById('lead-name').textContent = lead.contact_name;
  document.getElementById('lead-subtitle').textContent =
    `${lead.contact_info} · ${lead.source_platform.replace('_', ' ')} · ${lead.source_campaign || 'no campaign'}`;
  const badge = document.getElementById('lead-status-badge');
  badge.textContent = lead.status;
  badge.className = `badge ${lead.status}`;

  document.getElementById('timeline').innerHTML = events.map((e) => `
    <li>
      <div class="event-type">${escapeHtml(eventLabels[e.event_type] || e.event_type)}</div>
      <div class="event-time">${formatDateTime(e.timestamp)}</div>
      <div class="event-meta">${eventMetaLine(e)}</div>
    </li>
  `).join('') || '<li>No journey events recorded yet.</li>';

  document.getElementById('calls-list').innerHTML = calls.map((c) => `
    <div style="margin-bottom:14px">
      <div class="platform-tag">${formatDateTime(c.call_date)} · ${Math.round(c.duration / 60)} min</div>
      <div class="transcript">${formatTranscript(c.transcript)}</div>
    </div>
  `).join('') || '<div class="platform-tag">No calls recorded yet.</div>';

  document.getElementById('texts-list').innerHTML = texts.map((t) => `
    <div class="text-bubble ${t.direction}">${escapeHtml(t.message)}</div>
  `).join('') || '<div class="platform-tag">No texts recorded yet.</div>';
}

renderNav('leads');
loadLeadDetail();
