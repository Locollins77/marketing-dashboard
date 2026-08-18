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
