function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

async function loadLeads() {
  const brand = getSelectedBrand();
  const res = await fetch(`/api/leads?brand=${encodeURIComponent(brand)}`);
  if (res.status === 401) {
    window.location.href = '/login.html';
    return;
  }
  const leads = await res.json();

  document.getElementById('lead-rows').innerHTML = leads.map((l) => `
    <tr onclick="window.location.href='/lead-detail.html?id=${l.id}'">
      <td>${escapeHtml(l.contact_name)}<div class="platform-tag">${escapeHtml(l.contact_info)}</div></td>
      <td>${escapeHtml(BRAND_LABELS[l.brand] || l.brand || '—')}</td>
      <td style="text-transform:capitalize">${escapeHtml(l.source_platform.replace('_', ' '))}</td>
      <td>${escapeHtml(l.source_campaign) || '—'}</td>
      <td>${formatDate(l.created_at)}</td>
      <td>${l.lead_perfection_id ? escapeHtml(l.lead_perfection_id) : '<span class="platform-tag">not synced</span>'}</td>
      <td><span class="badge ${l.status}">${l.status}</span></td>
    </tr>
  `).join('');
}

renderNav('leads');
renderBrandFilter('brand-filter', loadLeads);
loadLeads();
