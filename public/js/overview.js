const currency = (n) => `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const number = (n) => Number(n).toLocaleString();

async function loadOverview() {
  const brand = getSelectedBrand();
  const { start, end } = getSelectedDateRange();
  const res = await fetch(`/api/overview?brand=${encodeURIComponent(brand)}&start=${start}&end=${end}`);
  if (res.status === 401) {
    window.location.href = '/login.html';
    return;
  }
  const data = await res.json();

  document.getElementById('stat-grid').innerHTML = `
    <div class="stat-card"><div class="label">Total spend</div><div class="value">${currency(data.totals.spend)}</div></div>
    <div class="stat-card"><div class="label">Total clicks</div><div class="value">${number(data.totals.clicks)}</div></div>
    <div class="stat-card"><div class="label">Total conversions</div><div class="value">${number(data.totals.conversions)}</div></div>
    <div class="stat-card"><div class="label">Total leads</div><div class="value">${number(data.totals.leads)}</div></div>
    <div class="stat-card"><div class="label">Converted leads</div><div class="value">${number(data.totals.converted_leads)}</div></div>
  `;

  document.getElementById('platform-rows').innerHTML = data.by_platform.map((p) => `
    <tr>
      <td style="text-transform:capitalize">${escapeHtml(p.platform)}</td>
      <td>${p.spend != null ? currency(p.spend) : '—'}</td>
      <td>${p.clicks != null ? number(p.clicks) : '—'}</td>
      <td>${number(p.conversions)}</td>
      <td>${p.spend != null && p.conversions ? currency(p.spend / p.conversions) : '—'}</td>
    </tr>
  `).join('');

  document.getElementById('campaign-rows').innerHTML = data.campaigns.map((c) => `
    <tr>
      <td>${escapeHtml(c.name)}</td>
      <td style="text-transform:capitalize">${c.platform}</td>
      <td>${currency(c.spend)}</td>
      <td>${number(c.clicks)}</td>
      <td>${number(c.conversions)}</td>
    </tr>
  `).join('');

  document.getElementById('source-rows').innerHTML = data.leads_by_source.map((s) => `
    <tr>
      <td style="text-transform:capitalize">${escapeHtml(s.source_platform.replace('_', ' '))}</td>
      <td>${number(s.count)}</td>
    </tr>
  `).join('');
}

function formatBrandResult(b) {
  const label = BRAND_LABELS[b.brand] || b.brand;
  if (b.skipped) return `${label}: no credentials`;
  const parts = [`${b.fetched} fetched`];
  if ('inserted' in b) parts.push(`${b.inserted} new`);
  if ('updated' in b) parts.push(`${b.updated} updated`);
  return `${label}: ${parts.join(', ')}`;
}

async function runSync(endpoint, buttonId, statusId) {
  const button = document.getElementById(buttonId);
  const status = document.getElementById(statusId);
  button.disabled = true;
  status.textContent = 'Syncing…';

  try {
    const res = await fetch(endpoint, { method: 'POST' });
    if (res.status === 401) {
      window.location.href = '/login.html';
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      status.textContent = data.error || 'Sync failed';
      return;
    }
    const summary = await res.json();
    const parts = summary.brands.map(formatBrandResult);
    if (summary.unattributed) parts.push(`${summary.unattributed} campaign(s) couldn't be matched to a brand`);
    status.textContent = parts.join(' · ');
    await loadOverview();
  } catch (err) {
    status.textContent = 'Sync failed';
  } finally {
    button.disabled = false;
  }
}

document.getElementById('sync-button').addEventListener('click', () => {
  runSync('/api/sync/whatconverts', 'sync-button', 'sync-status');
});

document.getElementById('sync-google-ads-button').addEventListener('click', () => {
  runSync('/api/sync/google-ads', 'sync-google-ads-button', 'sync-google-ads-status');
});

document.getElementById('sync-meta-ads-button').addEventListener('click', () => {
  runSync('/api/sync/meta-ads', 'sync-meta-ads-button', 'sync-meta-ads-status');
});

renderNav('overview');
renderBrandFilter('brand-filter', loadOverview);
renderDateRangeFilter('date-filter', loadOverview);
loadOverview();
