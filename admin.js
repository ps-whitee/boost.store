let globalData = { settings: {}, packages: {}, orders: [], fundRequests: [] };
let currentAdminSelectedSvc = 'Instagram Followers';
let autoRefreshInterval = null;

function startAutoRefresh() {
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  // Auto refresh every 15 seconds silently
  autoRefreshInterval = setInterval(async () => {
    try {
      const response = await adminFetch('/api/admin/data');
      globalData = await response.json();
      loadOrders();
      loadFunds();
    } catch (error) {
      console.error('Auto refresh failed', error);
    }
  }, 15000);
}

document.addEventListener('DOMContentLoaded', async () => {
  bindStaticEvents();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  await checkAdminSession();
});

function bindStaticEvents() {
  document.getElementById('admin-login-form').addEventListener('submit', handleAdminLogin);
  document.getElementById('btn-admin-logout').addEventListener('click', handleAdminLogout);
  document.getElementById('btn-save-payment').addEventListener('click', savePaymentSettings);
  document.getElementById('btn-save-prices').addEventListener('click', savePricingSettings);
  document.getElementById('btn-refresh-orders').addEventListener('click', refreshDashboard);
  document.getElementById('btn-refresh-funds').addEventListener('click', refreshDashboard);

  document.querySelectorAll('.svc-tab').forEach(tab => {
    tab.addEventListener('click', event => {
      document.querySelectorAll('.svc-tab').forEach(button => button.classList.remove('active'));
      event.currentTarget.classList.add('active');
      currentAdminSelectedSvc = event.currentTarget.dataset.svc;
      document.getElementById('current-svc-title').innerHTML =
        '<i class="fa-solid fa-pen-to-square"></i> Editing: ' + escapeHtml(currentAdminSelectedSvc);
      loadPricingForm(currentAdminSelectedSvc);
    });
  });
}

async function checkAdminSession() {
  if (window.location.protocol === 'file:') {
    showLogin('Admin login requires the server. Run `npm start` and open `http://localhost:3000/admin.html`.');
    return;
  }

  try {
    const response = await fetch('/api/admin/session');
    const payload = await response.json();

    if (payload.authenticated) {
      showAdminShell();
      await initializeDashboard();
      return;
    }
  } catch (error) {
    console.error(error);
    showLogin(getFriendlyErrorMessage(error));
    return;
  }

  showLogin('Enter your username and password to log in.');
}

async function initializeDashboard() {
  const response = await adminFetch('/api/admin/data');
  globalData = await response.json();
  loadConfigs();
  loadOrders();
  loadFunds();
  startAutoRefresh();
}

function showLogin(message = '') {
  document.getElementById('admin-login-screen').classList.remove('hidden');
  document.getElementById('admin-shell').classList.add('hidden');
  setLoginError(message);
}

function showAdminShell() {
  document.getElementById('admin-login-screen').classList.add('hidden');
  document.getElementById('admin-shell').classList.remove('hidden');
  setLoginError('');
}

function setLoginError(message) {
  const errorBox = document.getElementById('login-error');

  if (!message) {
    errorBox.textContent = '';
    errorBox.classList.add('hidden');
    return;
  }

  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

async function handleAdminLogin(event) {
  event.preventDefault();

  const username = document.getElementById('admin-username').value.trim();
  const password = document.getElementById('admin-password').value;

  setLoginError('');

  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      const errorPayload = await safeJson(response);
      throw new Error(errorPayload.error || 'Login failed');
    }

    document.getElementById('admin-login-form').reset();
    showAdminShell();
    await initializeDashboard();
    showToast('Admin login successful.');
  } catch (error) {
    const message = getFriendlyErrorMessage(error);
    setLoginError(message);
    showToast(message, 'error');
  }
}

async function handleAdminLogout() {
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);

  try {
    await fetch('/api/admin/logout', { method: 'POST' });
  } catch (error) {
    console.error(error);
  }

  showLogin();
  showToast('Logged out from admin panel.');
}

async function adminFetch(url, options = {}) {
  let response;

  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(getFriendlyErrorMessage(error));
  }

  if (response.status === 401) {
    showLogin('Session expired. Login again to continue.');
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    const errorPayload = await safeJson(response);
    throw new Error(errorPayload.error || 'Request failed');
  }

  return response;
}

function loadConfigs() {
  const settings = globalData.settings || {};
  const packages = globalData.packages || {};

  document.getElementById('admin-upi-input').value = settings.upiId || '';
  document.getElementById('admin-qr-input').value = settings.qrUrl || '';

  currentAdminSelectedSvc = currentAdminSelectedSvc || 'Instagram Followers';
  document.getElementById('current-svc-title').innerHTML =
    '<i class="fa-solid fa-pen-to-square"></i> Editing: ' + escapeHtml(currentAdminSelectedSvc);

  if (!packages[currentAdminSelectedSvc]) {
    currentAdminSelectedSvc = 'Instagram Followers';
  }

  loadPricingForm(currentAdminSelectedSvc);
}

function loadPricingForm(serviceName) {
  const packages = globalData.packages || {};
  const servicePackages = packages[serviceName] || {};

  setPackageFields('starter', servicePackages.starter, 99);
  setPackageFields('popular', servicePackages.popular, 249);
  setPackageFields('pro', servicePackages.pro, 499);
  setPackageFields('viral', servicePackages.viral, 999);
}

function setPackageFields(packageId, packageData = {}, fallbackPrice) {
  document.getElementById(`price-${packageId}`).value = packageData.price || fallbackPrice;
}

async function savePaymentSettings() {
  globalData.settings = globalData.settings || {};
  globalData.settings.upiId = document.getElementById('admin-upi-input').value.trim();
  globalData.settings.qrUrl = document.getElementById('admin-qr-input').value.trim();

  try {
    await adminFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: globalData.settings })
    });
    showToast('Payment settings saved successfully.');
  } catch (error) {
    showToast(error.message || 'Failed to save payment settings.', 'error');
  }
}

async function savePricingSettings() {
  const packages = globalData.packages || {};

  packages[currentAdminSelectedSvc] = {
    starter: readPackageForm('starter', 99),
    popular: readPackageForm('popular', 249),
    pro: readPackageForm('pro', 499),
    viral: readPackageForm('viral', 999)
  };

  globalData.packages = packages;

  try {
    await adminFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages: globalData.packages })
    });
    showToast(`Configurations saved for ${currentAdminSelectedSvc}.`);
  } catch (error) {
    showToast(error.message || 'Failed to save prices.', 'error');
  }
}

function readPackageForm(packageId, fallbackPrice) {
  return {
    price: parseInt(document.getElementById(`price-${packageId}`).value, 10) || fallbackPrice
  };
}

async function refreshDashboard() {
  try {
    const response = await adminFetch('/api/admin/data');
    globalData = await response.json();
    loadOrders();
    loadFunds();
    showToast('Dashboard refreshed.');
  } catch (error) {
    showToast(error.message || 'Failed to refresh.', 'error');
  }
}

function loadOrders() {
  const orders = globalData.orders || [];
  const tbody = document.getElementById('orders-tbody');
  const emptyState = document.getElementById('no-orders');

  tbody.innerHTML = '';

  if (!orders.length) {
    emptyState.classList.remove('hidden');
    document.getElementById('total-earnings').textContent = formatCurrency(0);
    return;
  }

  emptyState.classList.add('hidden');

  const totalEarnings = orders.reduce((total, order) => {
    if (order.status === 'Approved') {
      return total + (parseInt(order.price, 10) || 0);
    }
    return total;
  }, 0);

  document.getElementById('total-earnings').textContent = formatCurrency(totalEarnings);

  orders.forEach(order => {
    const statusBadge = getStatusBadge(order.status);
    const safeOrderId = escapeHtml(order.id || 'N/A');
    const safeDate = escapeHtml(order.date || 'N/A');
    const safeService = escapeHtml(order.service || 'Unknown');
    const safeQty = escapeHtml(order.qty || '0');
    const safeLinkText = escapeHtml(truncate(order.link || '', 25));
    const safeEmail = escapeHtml(order.email || 'N/A');
    const href = escapeAttribute(normalizeLink(order.link || ''));

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <strong>${safeOrderId}</strong>
        ${statusBadge}
      </td>
      <td style="color: #64748b; font-size: 13px;">${safeDate}</td>
      <td>
        <div style="font-weight: 500;">${safeEmail}</div>
      </td>
      <td>
        <div style="font-weight: 500;">${safeService}</div>
        <div style="font-size: 12px; color: #64748b;">Qty: ${safeQty}</div>
      </td>
      <td><a href="${href}" target="_blank" rel="noreferrer">${safeLinkText}</a></td>
      <td style="font-weight: 600; color: #10b981;">${formatCurrency(order.price)}</td>
      <td>
        <div style="display:flex; flex-direction:column; gap: 4px;">
          ${order.status === 'Pending'
            ? `
              <button onclick="updateOrderStatus(${JSON.stringify(order.id)}, 'Approved')" style="padding:4px 8px; background:#10b981; color:white; border:none; border-radius:4px; font-size:11px; cursor:pointer;">Approve</button>
              <button onclick="updateOrderStatus(${JSON.stringify(order.id)}, 'Rejected')" style="padding:4px 8px; background:#ef4444; color:white; border:none; border-radius:4px; font-size:11px; cursor:pointer;">Reject</button>
            `
            : ''}
          <button onclick="deleteOrder(${JSON.stringify(order.id)})" style="padding:4px 8px; background:#64748b; color:white; border:none; border-radius:4px; font-size:11px; cursor:pointer;"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

function loadFunds() {
  const funds = globalData.fundRequests || [];
  const tbody = document.getElementById('funds-tbody');
  const emptyState = document.getElementById('no-funds');

  tbody.innerHTML = '';

  if (!funds.length) {
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  funds.forEach(req => {
    const statusBadge = getStatusBadge(req.status);
    const safeDate = escapeHtml(req.date || 'N/A');
    const safeEmail = escapeHtml(req.email || 'Unknown');
    const safeMethod = escapeHtml(req.paymentMethod || 'N/A');
    const safeRef = escapeHtml(req.transactionRef || 'N/A');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="font-weight: 500;">${safeEmail}</div>
        ${statusBadge}
      </td>
      <td style="color: #64748b; font-size: 13px;">${safeDate}</td>
      <td><span class="badge">${safeMethod}</span></td>
      <td style="font-family: monospace;">${safeRef}</td>
      <td style="font-weight: 600; color: #10b981;">${formatCurrency(req.amount)}</td>
      <td>
        <div style="display:flex; gap: 4px;">
          ${req.status === 'Pending'
            ? `
              <button onclick="updateFundStatus(${JSON.stringify(req.id)}, 'Approved')" style="padding:4px 8px; background:#10b981; color:white; border:none; border-radius:4px; font-size:11px; cursor:pointer;">Approve</button>
              <button onclick="updateFundStatus(${JSON.stringify(req.id)}, 'Rejected')" style="padding:4px 8px; background:#ef4444; color:white; border:none; border-radius:4px; font-size:11px; cursor:pointer;">Reject</button>
            `
            : ''}
          <button onclick="deleteFund(${JSON.stringify(req.id)})" style="padding:4px 8px; background:#64748b; color:white; border:none; border-radius:4px; font-size:11px; cursor:pointer;"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

function getStatusBadge(status) {
  if (status === 'Approved') {
    return '<span class="badge" style="background:#dcfce7; color:#166534;">Verified</span>';
  }

  if (status === 'Rejected') {
    return '<span class="badge" style="background:#fee2e2; color:#991b1b;">Rejected</span>';
  }

  return '<span class="badge" style="background:#fef3c7; color:#92400e;">Pending</span>';
}

window.updateOrderStatus = async function(id, newStatus) {
  try {
    await adminFetch('/api/orders/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });

    const order = (globalData.orders || []).find(item => item.id === id);
    if (order) {
      order.status = newStatus;
    }

    loadOrders();
    showToast(`Order ${newStatus.toLowerCase()} successfully.`);
  } catch (error) {
    showToast(error.message || 'Failed to update order.', 'error');
  }
};

window.deleteOrder = async function(id) {
  if (!window.confirm('Are you sure you want to completely remove this order?')) {
    return;
  }

  try {
    await adminFetch('/api/orders/' + encodeURIComponent(id), { method: 'DELETE' });
    globalData.orders = (globalData.orders || []).filter(order => order.id !== id);
    loadOrders();
    showToast('Order completely removed.');
  } catch (error) {
    showToast(error.message || 'Failed to delete order.', 'error');
  }
};

window.updateFundStatus = async function(id, newStatus) {
  try {
    await adminFetch('/api/admin/fund-requests/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });

    const fund = (globalData.fundRequests || []).find(item => item.id === id);
    if (fund) {
      fund.status = newStatus;
    }

    loadFunds();
    showToast(`Fund request ${newStatus.toLowerCase()} successfully.`);
  } catch (error) {
    showToast(error.message || 'Failed to update fund request.', 'error');
  }
};

window.deleteFund = async function(id) {
  if (!window.confirm('Are you sure you want to completely remove this fund request?')) {
    return;
  }

  try {
    await adminFetch('/api/admin/fund-requests/' + encodeURIComponent(id), { method: 'DELETE' });
    globalData.fundRequests = (globalData.fundRequests || []).filter(req => req.id !== id);
    loadFunds();
    showToast('Fund request completely removed.');
  } catch (error) {
    showToast(error.message || 'Failed to delete fund request.', 'error');
  }
};

window.encodeImageFileAsURL = function(input, targetInputId) {
  const file = input.files && input.files[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById(targetInputId).value = reader.result;
  };
  reader.readAsDataURL(file);
};

function formatCurrency(value) {
  const amount = parseInt(value, 10) || 0;
  return 'Rs ' + amount.toLocaleString('en-IN');
}

function normalizeLink(value) {
  if (!value) {
    return '#';
  }

  return value.startsWith('http://') || value.startsWith('https://')
    ? value
    : 'https://' + value;
}

function truncate(str, max) {
  if (!str) {
    return '';
  }

  return str.length > max ? str.substring(0, max) + '...' : str;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function getFriendlyErrorMessage(error) {
  const rawMessage = error && error.message ? error.message : '';

  if (window.location.protocol === 'file:') {
    return 'You opened the file directly. Run `npm start` and log in at `http://localhost:3000/admin.html`.';
  }

  if (rawMessage === 'Failed to fetch' || rawMessage === 'NetworkError when attempting to fetch resource.') {
    return 'The server is not reachable. Run `npm start`, then open `http://localhost:3000/admin.html`.';
  }

  if (!rawMessage) {
    return 'Login failed';
  }

  return rawMessage;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const icon =
    type === 'error'
      ? '<i class="fa-solid fa-circle-exclamation"></i>'
      : '<i class="fa-solid fa-circle-check"></i>';

  toast.className = `toast ${type}`;
  toast.innerHTML = `${icon} <span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
