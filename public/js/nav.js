function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}

const BRAND_LABELS = {
  seamless: 'Rainbow Seamless Systems',
  bathshower: 'Rainbow Bath and Shower'
};

function getSelectedBrand() {
  return localStorage.getItem('dashboardBrand') || 'all';
}

function renderBrandFilter(containerId, onChange) {
  const container = document.getElementById(containerId);
  const current = getSelectedBrand();
  const options = ['all', ...Object.keys(BRAND_LABELS)].map((key) => {
    const label = key === 'all' ? 'All brands' : BRAND_LABELS[key];
    const selected = key === current ? 'selected' : '';
    return `<option value="${key}" ${selected}>${escapeHtml(label)}</option>`;
  }).join('');

  container.innerHTML = `<select id="brand-select" class="brand-select">${options}</select>`;
  document.getElementById('brand-select').addEventListener('change', (e) => {
    localStorage.setItem('dashboardBrand', e.target.value);
    onChange(e.target.value);
  });
}

const DATE_PRESETS = {
  today: 'Today',
  last7: 'Last 7 Days',
  last30: 'Last 30 Days',
  thisMonth: 'This Month',
  lastMonth: 'Last Month',
  custom: 'Custom Range'
};

function formatDateYMD(d) {
  return d.toISOString().slice(0, 10);
}

function computeDateRange(preset, customStart, customEnd) {
  const today = new Date();
  const todayStr = formatDateYMD(today);

  if (preset === 'today') {
    return { start: todayStr, end: todayStr };
  }
  if (preset === 'last7') {
    const d = new Date(today);
    d.setDate(d.getDate() - 6);
    return { start: formatDateYMD(d), end: todayStr };
  }
  if (preset === 'thisMonth') {
    const d = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start: formatDateYMD(d), end: todayStr };
  }
  if (preset === 'lastMonth') {
    const startD = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const endD = new Date(today.getFullYear(), today.getMonth(), 0);
    return { start: formatDateYMD(startD), end: formatDateYMD(endD) };
  }
  if (preset === 'custom') {
    return { start: customStart || todayStr, end: customEnd || todayStr };
  }
  // last30 and default fallback
  const d = new Date(today);
  d.setDate(d.getDate() - 29);
  return { start: formatDateYMD(d), end: todayStr };
}

function getSelectedDateRangeConfig() {
  const raw = localStorage.getItem('dashboardDateRange');
  if (!raw) return { preset: 'last30', start: null, end: null };
  try {
    return JSON.parse(raw);
  } catch {
    return { preset: 'last30', start: null, end: null };
  }
}

function getSelectedDateRange() {
  const config = getSelectedDateRangeConfig();
  return computeDateRange(config.preset, config.start, config.end);
}

function renderDateRangeFilter(containerId, onChange) {
  const container = document.getElementById(containerId);
  const config = getSelectedDateRangeConfig();

  const options = Object.entries(DATE_PRESETS).map(([key, label]) => {
    const selected = key === config.preset ? 'selected' : '';
    return `<option value="${key}" ${selected}>${label}</option>`;
  }).join('');

  const showCustom = config.preset === 'custom';
  container.innerHTML = `
    <select id="date-preset-select" class="date-select">${options}</select>
    <span id="custom-date-inputs" style="${showCustom ? '' : 'display:none'}">
      <input type="date" id="date-start-input" class="date-input" value="${config.start || ''}" />
      <input type="date" id="date-end-input" class="date-input" value="${config.end || ''}" />
    </span>
  `;

  function saveAndNotify(newConfig) {
    localStorage.setItem('dashboardDateRange', JSON.stringify(newConfig));
    onChange();
  }

  document.getElementById('date-preset-select').addEventListener('change', (e) => {
    const preset = e.target.value;
    const customSpan = document.getElementById('custom-date-inputs');
    if (preset === 'custom') {
      customSpan.style.display = '';
      const range = computeDateRange('last30');
      saveAndNotify({ preset: 'custom', start: range.start, end: range.end });
    } else {
      customSpan.style.display = 'none';
      saveAndNotify({ preset, start: null, end: null });
    }
  });

  const startInput = document.getElementById('date-start-input');
  const endInput = document.getElementById('date-end-input');
  if (startInput) {
    startInput.addEventListener('change', () => {
      saveAndNotify({ preset: 'custom', start: startInput.value, end: endInput.value });
    });
    endInput.addEventListener('change', () => {
      saveAndNotify({ preset: 'custom', start: startInput.value, end: endInput.value });
    });
  }
}

function renderNav(activePage) {
  const links = [
    { href: '/index.html', label: 'Overview', key: 'overview' },
    { href: '/leads.html', label: 'Leads & Journey', key: 'leads' }
  ];

  const navHtml = links.map((link) => {
    const cls = link.key === activePage ? 'active' : '';
    return `<a href="${link.href}" class="${cls}">${link.label}</a>`;
  }).join('');

  document.getElementById('sidebar').innerHTML = `
    <h1>Marketing Dashboard</h1>
    <nav>${navHtml}</nav>
    <div class="logout" id="logout-link">Sign out</div>
  `;

  document.getElementById('logout-link').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });
}

async function requireSession() {
  const res = await fetch('/api/auth/session');
  const data = await res.json();
  if (!data.authenticated) {
    window.location.href = '/login.html';
  }
}
