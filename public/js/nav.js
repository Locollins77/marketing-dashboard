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
