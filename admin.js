// --- BACKEND API INTEGRATION ---
let globalData = { settings: {}, packages: {}, orders: [] };

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('/api/data');
    globalData = await res.json();
    loadConfigs();
    loadOrders();
  } catch (e) {
    console.error(e);
    showToast('Failed to load data from server');
  }
});

// Load Configs from Global Data
function loadConfigs() {
  const settings = globalData.settings || {
    upiId: 'admin@okaxis',
    qrUrl: '',
    cardLink: '',
    paytmNum: '',
    paytmQrUrl: '',
    cryptoNet: '',
    cryptoAddr: ''
  };
  const packages = globalData.packages || {
    starter: { price: 99 }, popular: { price: 249 }, pro: { price: 499 }, viral: { price: 999 }
  };

  // Populate Global Payment Form (UPI Only)
  document.getElementById('admin-upi-input').value = settings.upiId || '';
  document.getElementById('admin-qr-input').value = settings.qrUrl || '';

  // Setup Pricing Tabs listener
  window.currentAdminSelectedSvc = 'Instagram Followers';
  document.querySelectorAll('.svc-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.svc-tab').forEach(t => t.classList.remove('active'));
      e.currentTarget.classList.add('active');
      window.currentAdminSelectedSvc = e.currentTarget.dataset.svc;
      document.getElementById('current-svc-title').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Editing: ' + window.currentAdminSelectedSvc;
      loadPricingForm(window.currentAdminSelectedSvc);
    });
  });
  
  loadPricingForm('Instagram Followers');
}

function loadPricingForm(serviceName) {
  const packages = globalData.packages || {};
  const svcPackages = packages[serviceName] || {};

  document.getElementById('price-starter').value = svcPackages.starter?.price || 99;
  if(document.getElementById('qr-starter')) document.getElementById('qr-starter').value = svcPackages.starter?.qrUrl || '';
  if(document.getElementById('card-starter')) document.getElementById('card-starter').value = svcPackages.starter?.cardUrl || '';
  if(document.getElementById('phone-starter')) document.getElementById('phone-starter').value = svcPackages.starter?.phone || '';
  if(document.getElementById('cryptonet-starter')) document.getElementById('cryptonet-starter').value = svcPackages.starter?.cryptoNet || '';
  if(document.getElementById('cryptoaddr-starter')) document.getElementById('cryptoaddr-starter').value = svcPackages.starter?.cryptoAddr || '';

  document.getElementById('price-popular').value = svcPackages.popular?.price || 249;
  if(document.getElementById('qr-popular')) document.getElementById('qr-popular').value = svcPackages.popular?.qrUrl || '';
  if(document.getElementById('card-popular')) document.getElementById('card-popular').value = svcPackages.popular?.cardUrl || '';
  if(document.getElementById('phone-popular')) document.getElementById('phone-popular').value = svcPackages.popular?.phone || '';
  if(document.getElementById('cryptonet-popular')) document.getElementById('cryptonet-popular').value = svcPackages.popular?.cryptoNet || '';
  if(document.getElementById('cryptoaddr-popular')) document.getElementById('cryptoaddr-popular').value = svcPackages.popular?.cryptoAddr || '';

  document.getElementById('price-pro').value = svcPackages.pro?.price || 499;
  if(document.getElementById('qr-pro')) document.getElementById('qr-pro').value = svcPackages.pro?.qrUrl || '';
  if(document.getElementById('card-pro')) document.getElementById('card-pro').value = svcPackages.pro?.cardUrl || '';
  if(document.getElementById('phone-pro')) document.getElementById('phone-pro').value = svcPackages.pro?.phone || '';
  if(document.getElementById('cryptonet-pro')) document.getElementById('cryptonet-pro').value = svcPackages.pro?.cryptoNet || '';
  if(document.getElementById('cryptoaddr-pro')) document.getElementById('cryptoaddr-pro').value = svcPackages.pro?.cryptoAddr || '';

  document.getElementById('price-viral').value = svcPackages.viral?.price || 999;
  if(document.getElementById('qr-viral')) document.getElementById('qr-viral').value = svcPackages.viral?.qrUrl || '';
  if(document.getElementById('card-viral')) document.getElementById('card-viral').value = svcPackages.viral?.cardUrl || '';
  if(document.getElementById('phone-viral')) document.getElementById('phone-viral').value = svcPackages.viral?.phone || '';
  if(document.getElementById('cryptonet-viral')) document.getElementById('cryptonet-viral').value = svcPackages.viral?.cryptoNet || '';
  if(document.getElementById('cryptoaddr-viral')) document.getElementById('cryptoaddr-viral').value = svcPackages.viral?.cryptoAddr || '';
}

// Save Payment Settings
document.getElementById('btn-save-payment').addEventListener('click', async () => {
  const upiId = document.getElementById('admin-upi-input').value.trim();
  const qrUrl = document.getElementById('admin-qr-input').value.trim();
  
  globalData.settings.upiId = upiId;
  globalData.settings.qrUrl = qrUrl;
  
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: globalData.settings })
    });
    showToast('Payment settings saved successfully!');
  } catch(e) {
    showToast('Failed to save payment settings', 'error');
  }
});

// Save Pricing Settings
document.getElementById('btn-save-prices').addEventListener('click', async () => {
  const serviceName = window.currentAdminSelectedSvc;
  const packages = globalData.packages || {};
  
  packages[serviceName] = {
    starter: { 
      price: parseInt(document.getElementById('price-starter').value) || 99, 
      qrUrl: document.getElementById('qr-starter').value.trim(),
      cardUrl: document.getElementById('card-starter').value.trim(),
      phone: document.getElementById('phone-starter').value.trim(),
      cryptoNet: document.getElementById('cryptonet-starter').value.trim(),
      cryptoAddr: document.getElementById('cryptoaddr-starter').value.trim()
    },
    popular: { 
      price: parseInt(document.getElementById('price-popular').value) || 249, 
      qrUrl: document.getElementById('qr-popular').value.trim(),
      cardUrl: document.getElementById('card-popular').value.trim(),
      phone: document.getElementById('phone-popular').value.trim(),
      cryptoNet: document.getElementById('cryptonet-popular').value.trim(),
      cryptoAddr: document.getElementById('cryptoaddr-popular').value.trim()
    },
    pro: { 
      price: parseInt(document.getElementById('price-pro').value) || 499, 
      qrUrl: document.getElementById('qr-pro').value.trim(),
      cardUrl: document.getElementById('card-pro').value.trim(),
      phone: document.getElementById('phone-pro').value.trim(),
      cryptoNet: document.getElementById('cryptonet-pro').value.trim(),
      cryptoAddr: document.getElementById('cryptoaddr-pro').value.trim()
    },
    viral: { 
      price: parseInt(document.getElementById('price-viral').value) || 999, 
      qrUrl: document.getElementById('qr-viral').value.trim(),
      cardUrl: document.getElementById('card-viral').value.trim(),
      phone: document.getElementById('phone-viral').value.trim(),
      cryptoNet: document.getElementById('cryptonet-viral').value.trim(),
      cryptoAddr: document.getElementById('cryptoaddr-viral').value.trim()
    }
  };
  
  globalData.packages = packages;

  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages: globalData.packages })
    });
    showToast(`Prices & QRs saved for ${serviceName}!`);
  } catch(e) {
    showToast('Failed to save prices', 'error');
  }
});

// Load Orders
document.getElementById('btn-refresh-orders').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/data');
    globalData = await res.json();
    loadOrders();
    showToast('Orders refreshed!');
  } catch(e) {
    showToast('Failed to refresh');
  }
});

function loadOrders() {
  const orders = globalData.orders || [];
  const tbody = document.getElementById('orders-tbody');
  const emptyState = document.getElementById('no-orders');
  
  tbody.innerHTML = '';
  
  if (orders.length === 0) {
    emptyState.classList.remove('hidden');
    document.getElementById('total-earnings').textContent = '₹0';
    return;
  }
  
  emptyState.classList.add('hidden');
  
  // Calculate total earnings
  let totalEarnings = 0;
  orders.forEach(order => {
    if (order.status === 'Approved') {
      totalEarnings += parseInt(order.price) || 0;
    }
  });
  document.getElementById('total-earnings').textContent = '₹' + totalEarnings.toLocaleString('en-IN');
  
  orders.forEach((order, index) => {
    let statusBadge = '';
    if (order.status === 'Pending') {
      statusBadge = '<span class="badge" style="background:#fef08a; color:#854d0e;">Pending</span>';
    } else if (order.status === 'Approved') {
      statusBadge = '<span class="badge" style="background:#dcfce3; color:#166534;">Verified</span>';
    } else if (order.status === 'Rejected') {
      statusBadge = '<span class="badge" style="background:#fee2e2; color:#991b1b;">Rejected</span>';
    } else {
      statusBadge = '<span class="badge" style="background:#fef08a; color:#854d0e;">Pending</span>';
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <strong>${order.id}</strong>
        ${statusBadge}
        <div style="font-size: 11px; margin-top:4px;">Ref: ${order.transactionRef || 'N/A'}</div>
      </td>
      <td style="color: #64748b; font-size: 13px;">${order.date}</td>
      <td>
        <div style="font-weight: 500;">${order.service}</div>
        <div style="font-size: 12px; color: #64748b;">Qty: ${order.qty}</div>
      </td>
      <td><a href="${order.link.startsWith('http') ? order.link : 'https://' + order.link}" target="_blank">${truncate(order.link, 25)}</a></td>
      <td style="font-weight: 600; color: #10b981;">₹${order.price}</td>
      <td>
        <span class="badge">${order.payment}</span>
        <div style="margin-top: 8px; display:flex; gap: 4px;">
            ${order.status === 'Pending' ? `
              <button onclick="updateOrderStatus('${order.id}', 'Approved')" style="padding:4px 8px; background:#10b981; color:white; border:none; border-radius:4px; font-size:11px; cursor:pointer;">Approve</button>
              <button onclick="updateOrderStatus('${order.id}', 'Rejected')" style="padding:4px 8px; background:#ef4444; color:white; border:none; border-radius:4px; font-size:11px; cursor:pointer;">Reject</button>
            ` : ''}
            <button onclick="deleteOrder('${order.id}')" style="padding:4px 8px; background:#64748b; color:white; border:none; border-radius:4px; font-size:11px; cursor:pointer;"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.updateOrderStatus = async function(id, newStatus) {
    try {
        await fetch('/api/orders/' + encodeURIComponent(id), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        
        // Update local and re-render
        const o = globalData.orders.find(x => x.id === id);
        if(o) o.status = newStatus;
        loadOrders();
        showToast('Order ' + newStatus + ' successfully!');
    } catch(e) {
        showToast('Failed to update order', 'error');
    }
};

window.deleteOrder = async function(id) {
    if(confirm('Are you sure you want to completely remove this order?')) {
        try {
            await fetch('/api/orders/' + encodeURIComponent(id), { method: 'DELETE' });
            globalData.orders = globalData.orders.filter(x => x.id !== id);
            loadOrders();
            showToast('Order completely removed.');
        } catch(e) {
            showToast('Failed to delete order', 'error');
        }
    }
};

function truncate(str, max) {
  return str.length > max ? str.substring(0, max) + '...' : str;
}

// Custom Toast Notification
function showToast(message) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast success';
  toast.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
