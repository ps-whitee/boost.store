// --- BACKEND API INTEGRATION ---
const PUBLIC_DATA_CACHE_KEY = 'booststore_public_data_v1';
const DEFAULT_PUBLIC_DATA = {
  settings: {
    upiId: 'admin@upi',
    qrUrl: '',
    cardLink: '',
    paytmQrUrl: '',
    cryptoNet: '',
    cryptoAddr: ''
  },
  packages: {},
  orders: []
};

let globalData = getFallbackData();
let isBackendConnected = false;
let backendRetryTimer = null;
let hasShownBackendWarning = false;

async function initBackend(options = {}) {
  const { silent = false } = options;

  clearBackendRetry();

  try {
    const res = await fetch('/api/data', { cache: 'no-store' });

    if (!res.ok) {
      throw new Error(`Request failed with status ${res.status}`);
    }

    globalData = normalizePublicData(await res.json());
    isBackendConnected = true;
    hasShownBackendWarning = false;
    cachePublicData(globalData);
    loadConfigs();
  } catch (err) {
    console.error('Failed to connect to backend', err);
    isBackendConnected = false;
    globalData = getFallbackData();
    loadConfigs();

    if (!silent && !hasShownBackendWarning) {
      showToast(getBackendWarningMessage(), 'error');
      hasShownBackendWarning = true;
    }

    scheduleBackendRetry();
  }
}

function normalizePublicData(data) {
  const normalized = data && typeof data === 'object' ? data : {};

  return {
    settings: normalized.settings && typeof normalized.settings === 'object' ? normalized.settings : {},
    packages: normalized.packages && typeof normalized.packages === 'object' ? normalized.packages : {},
    orders: Array.isArray(normalized.orders) ? normalized.orders : []
  };
}

function getFallbackData() {
  try {
    const cached = localStorage.getItem(PUBLIC_DATA_CACHE_KEY);

    if (cached) {
      return normalizePublicData(JSON.parse(cached));
    }
  } catch (error) {
    console.error('Failed to read cached public data', error);
  }

  return normalizePublicData(DEFAULT_PUBLIC_DATA);
}

function cachePublicData(data) {
  try {
    localStorage.setItem(PUBLIC_DATA_CACHE_KEY, JSON.stringify(normalizePublicData(data)));
  } catch (error) {
    console.error('Failed to cache public data', error);
  }
}

function scheduleBackendRetry() {
  if (window.location.protocol === 'file:' || backendRetryTimer) {
    return;
  }

  backendRetryTimer = setTimeout(() => {
    backendRetryTimer = null;
    initBackend({ silent: true });
  }, 15000);
}

function clearBackendRetry() {
  if (!backendRetryTimer) {
    return;
  }

  clearTimeout(backendRetryTimer);
  backendRetryTimer = null;
}

function getBackendWarningMessage() {
  if (window.location.protocol === 'file:') {
    return 'Server ke bina preview mode chal raha hai. Orders ke liye `npm start` chalao aur `http://localhost:3000/` kholo.';
  }

  return 'Server connect nahi ho raha. App preview mode me chal raha hai.';
}

function loadConfigs() {
  const settings = globalData.settings || {};
  const packages = globalData.packages || {};
  const currentSvcPackages = packages[state.service] || packages["Instagram Followers"];

  // Update Packages UI dynamically for initially-loaded service
  document.querySelectorAll('.package-row').forEach(row => {
    const pkgId = row.dataset.pkgId;
    if (currentSvcPackages && currentSvcPackages[pkgId]) {
      row.dataset.price = currentSvcPackages[pkgId].price;
      row.querySelector('.price-text').textContent = '₹' + currentSvcPackages[pkgId].price;
    }
  });

  // Update Global Payment UI Details
  const upiDisp = document.getElementById('admin-upi-disp');
  if (upiDisp) upiDisp.textContent = settings.upiId || 'Not set';

  // Sync state
  const selectedPkg = document.querySelector('.package-row.selected');
  if(selectedPkg) {
    state.price = parseInt(selectedPkg.dataset.price);
  }
}

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {

  // Set initial history state
  history.replaceState({ step: 1, type: 'step' }, '', '#home');

  // PWA Service Worker Registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(registration => {
        console.log('SW registered: ', registration);
      }).catch(registrationError => {
        console.log('SW registration failed: ', registrationError);
      });
    });
  }

  // Navigation Logic
  initBackend();
});

window.addEventListener('online', () => {
  initBackend({ silent: true });
});

// PWA Install Prompt Logic
let deferredPrompt;
const installBtn = document.getElementById('install-app-btn');

function isInstalledApp() {
  const isStandaloneDisplay = window.matchMedia('(display-mode: standalone)').matches;
  const isFullscreenDisplay = window.matchMedia('(display-mode: fullscreen)').matches;
  const isIosStandalone = window.navigator.standalone === true;

  return isStandaloneDisplay || isFullscreenDisplay || isIosStandalone;
}

function syncInstallButtonVisibility() {
  if (!installBtn) {
    return;
  }

  if (isInstalledApp() || !deferredPrompt) {
    installBtn.classList.add('hidden');
    return;
  }

  installBtn.classList.remove('hidden');
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();

  if (isInstalledApp()) {
    deferredPrompt = null;
    syncInstallButtonVisibility();
    return;
  }

  deferredPrompt = e;
  syncInstallButtonVisibility();
});

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        console.log('User accepted the install prompt');
      }
      deferredPrompt = null;
      syncInstallButtonVisibility();
    }
  });
}

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  syncInstallButtonVisibility();
});

window.addEventListener('DOMContentLoaded', () => {
  syncInstallButtonVisibility();

  const standaloneMedia = window.matchMedia('(display-mode: standalone)');
  const handleStandaloneChange = () => syncInstallButtonVisibility();

  if (typeof standaloneMedia.addEventListener === 'function') {
    standaloneMedia.addEventListener('change', handleStandaloneChange);
  } else if (typeof standaloneMedia.addListener === 'function') {
    standaloneMedia.addListener(handleStandaloneChange);
  }
});

// State Management
const state = {
  service: 'Instagram Followers',
  qty: '1,000',
  price: 99,
  payment: 'Paytm',
  platform: 'instagram',
  pkgId: 'starter'
};

let isNavigatingFromHistory = false;

window.addEventListener('popstate', (e) => {
  isNavigatingFromHistory = true;
  
  // Close success screen if it was open
  const successScreen = document.getElementById('success-screen');
  if (successScreen && !successScreen.classList.contains('hidden')) {
    successScreen.classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
  }

  if (e.state) {
    if (e.state.type === 'step') {
      navigate(e.state.step);
    } else if (e.state.type === 'tab') {
      switchTab(e.state.tab);
    }
  } else {
    navigate(1);
  }
  
  setTimeout(() => { isNavigatingFromHistory = false; }, 10);
});

// DOM Elements
const pages = [document.getElementById('page1'), document.getElementById('page2'), document.getElementById('page3')];
const steps = [document.getElementById('step1'), document.getElementById('step2'), document.getElementById('step3')];

// Navigation listeners
document.getElementById('btn-back-to-1').addEventListener('click', () => navigate(1));
document.getElementById('btn-next-to-3').addEventListener('click', () => {
  if (validateForm()) navigate(3);
});
document.getElementById('btn-back-to-2').addEventListener('click', () => navigate(2));
document.getElementById('btn-place-order').addEventListener('click', placeOrder);
document.getElementById('btn-track-order').addEventListener('click', resetApp);
document.getElementById('btn-go-home').addEventListener('click', resetApp);
document.getElementById('btn-success-back').addEventListener('click', resetApp);

// Setup Lists
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', (e) => filterServices(e.currentTarget));
});

document.querySelectorAll('.service-card').forEach(card => {
  card.addEventListener('click', (e) => selectService(e.currentTarget));
});

document.querySelectorAll('.package-row').forEach(row => {
  row.addEventListener('click', (e) => selectPackage(e.currentTarget));
});

document.querySelectorAll('.pay-method').forEach(method => {
  method.addEventListener('click', (e) => selectPayment(e.currentTarget));
});

// Search Setup
document.getElementById('search-input').addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  let hasVisible = false;
  
  // Unset platform filter to "all" during search
  if(query.length > 0) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.tab[data-filter="all"]').classList.add('active');
  }

  document.querySelectorAll('.service-card').forEach(card => {
    const text = card.textContent.toLowerCase();
    if (text.includes(query)) {
      card.style.display = '';
      hasVisible = true;
    } else {
      card.style.display = 'none';
    }
  });

  document.getElementById('no-results').classList.toggle('hidden', hasVisible);
});

// Functions
function filterServices(tabElement) {
  const filter = tabElement.dataset.filter;
  
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tabElement.classList.add('active');
  document.getElementById('search-input').value = '';

  let hasVisible = false;
  document.querySelectorAll('.service-card').forEach(card => {
    if (filter === 'all' || card.dataset.platform === filter) {
      card.style.display = '';
      hasVisible = true;
    } else {
      card.style.display = 'none';
    }
  });
  
  document.getElementById('no-results').classList.toggle('hidden', hasVisible);
}

function selectService(cardElement) {
  document.querySelectorAll('.service-card').forEach(c => c.classList.remove('selected'));
  cardElement.classList.add('selected');
  state.service = cardElement.dataset.service;
  state.platform = cardElement.dataset.platform;
  
  // Reload packages for this specific service
  const packages = globalData.packages || {};
  const currentSvcPackages = packages[state.service];
  if(currentSvcPackages) {
    document.querySelectorAll('.package-row').forEach(row => {
      const pkgId = row.dataset.pkgId;
      if (currentSvcPackages[pkgId]) {
        row.dataset.price = currentSvcPackages[pkgId].price;
        row.querySelector('.price-text').textContent = '₹' + currentSvcPackages[pkgId].price;
      }
    });
    
    // Auto sync state price based on the selected package in the list
    const selectedPkg = document.querySelector('.package-row.selected');
    if(selectedPkg) state.price = parseInt(selectedPkg.dataset.price);
  }
  
  // Auto-navigate to step 2 when tapped
  navigate(2);
}

function selectPackage(rowElement) {
  document.querySelectorAll('.package-row').forEach(r => r.classList.remove('selected'));
  rowElement.classList.add('selected');
  
  const qtyNum = parseInt(rowElement.dataset.qty);
  state.price = parseInt(rowElement.dataset.price);
  state.qty = qtyNum.toLocaleString('en-IN');
  state.pkgId = rowElement.dataset.pkgId;
}

let qrTimerInterval = null;
let qrTimeLeft = 300; // 5 minutes in seconds

function startQrTimer() {
  clearInterval(qrTimerInterval);
  qrTimeLeft = 300;
  
  const timerText = document.getElementById('timer-text');
  const overlay = document.getElementById('qr-expired-overlay');
  const timerContainer = document.getElementById('qr-timer');
  const btn = document.getElementById('btn-place-order');
  
  if (overlay) overlay.classList.add('hidden');
  if (timerContainer) timerContainer.style.color = '#10b981';
  if (btn) {
    btn.disabled = false;
    btn.style.opacity = '1';
  }
  
  updateTimerDisplay();

  qrTimerInterval = setInterval(() => {
    qrTimeLeft--;
    updateTimerDisplay();
    
    if (qrTimeLeft <= 0) {
      clearInterval(qrTimerInterval);
      if (overlay) overlay.classList.remove('hidden');
      if (timerContainer) timerContainer.style.color = '#ef4444';
      if (timerText) timerText.textContent = "EXPIRED";
      if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.5';
      }
    }
  }, 1000);
}

function updateTimerDisplay() {
  if (qrTimeLeft <= 0) return;
  const timerText = document.getElementById('timer-text');
  if (!timerText) return;
  const m = Math.floor(qrTimeLeft / 60).toString().padStart(2, '0');
  const s = (qrTimeLeft % 60).toString().padStart(2, '0');
  timerText.textContent = `${m}:${s}`;
  
  if (qrTimeLeft <= 60) {
    document.getElementById('qr-timer').style.color = '#ef4444';
  }
}

function selectPayment(element) {
  document.querySelectorAll('.pay-method').forEach(p => p.classList.remove('active'));
  element.classList.add('active');
  state.payment = element.dataset.method;
  
  // Hide all sections
  document.getElementById('upi-section').classList.add('hidden');
  document.getElementById('card-section').classList.add('hidden');
  document.getElementById('paytm-section').classList.add('hidden');
  document.getElementById('crypto-section').classList.add('hidden');

  // Show selected section
  if (state.payment === 'UPI') {
    document.getElementById('upi-section').classList.remove('hidden');
  } else if (state.payment === 'Card') {
    document.getElementById('card-section').classList.remove('hidden');
  } else if (state.payment === 'Paytm') {
    document.getElementById('paytm-section').classList.remove('hidden');
    startQrTimer();
  } else if (state.payment === 'Crypto') {
    document.getElementById('crypto-section').classList.remove('hidden');
  }
}

function navigate(stepNumber) {
  if (!isNavigatingFromHistory) {
    history.pushState({ step: stepNumber, type: 'step' }, '', '#step' + stepNumber);
  }

  // Header visibility
  const header = document.querySelector('.header');
  if (header) {
    header.style.display = (stepNumber === 1) ? 'flex' : 'none';
  }

  // Step indicator visibility
  const stepIndicator = document.querySelector('.step-indicator');
  if (stepIndicator) {
    stepIndicator.style.display = (stepNumber === 1) ? 'none' : 'flex';
  }

  // Update views
  pages.forEach((p, idx) => {
    if (idx === stepNumber - 1) {
      p.classList.add('view-active');
    } else {
      p.classList.remove('view-active');
    }
  });
  const pageOrders = document.getElementById('page-orders');
  const pageHistory = document.getElementById('page-history');
  if(pageOrders) pageOrders.classList.remove('view-active');
  if(pageHistory) pageHistory.classList.remove('view-active');

  // Ensure bottom nav reflects Home
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
    if(item.dataset.tab === 'home') item.classList.add('active');
  });

  // Update steps UI
  steps.forEach((s, idx) => {
    s.classList.remove('active', 'done');
    if (idx + 1 < stepNumber) {
      s.classList.add('done');
    } else if (idx + 1 === stepNumber) {
      s.classList.add('active');
    }
  });

  // Preparation for screens
  if (stepNumber === 2) {
    document.getElementById('selected-service-title').textContent = state.service;
  }
  if (stepNumber === 3) {
    const link = document.getElementById('link-input').value.trim();
    document.getElementById('sum-service').textContent = state.service;
    document.getElementById('sum-qty').textContent = state.qty + ' units';
    document.getElementById('sum-link').textContent = link;
    document.getElementById('sum-total').textContent = '₹' + state.price;
    
    // Update QR specifically for this package if exists
    const packages = globalData.packages || {};
    const svcSettings = packages[state.service] || {};
    const pkgSettings = svcSettings[state.pkgId] || null;
    const settings = globalData.settings || {};

    // UPI is now mostly global / default only.
    document.getElementById('upi-qr').src = settings.qrUrl || '';
    
    // Update Service-Specific Payment Fallbacks
    document.getElementById('card-payment-link').href = (pkgSettings && pkgSettings.cardUrl) ? pkgSettings.cardUrl : settings.cardLink || '#';
    // Shift Package-Specific QR into the Pay QR slot natively if provided, else fallback to service specific Pay QR, else global.
    document.getElementById('paytm-qr').src = (pkgSettings && pkgSettings.qrUrl) ? pkgSettings.qrUrl : (svcSettings.paytmQrUrl || settings.paytmQrUrl || '');
    document.getElementById('admin-crypto-net-disp').textContent = (pkgSettings && pkgSettings.cryptoNet) ? pkgSettings.cryptoNet : svcSettings.cryptoNet || settings.cryptoNet || 'Not set';
    document.getElementById('admin-crypto-addr-disp').textContent = (pkgSettings && pkgSettings.cryptoAddr) ? pkgSettings.cryptoAddr : svcSettings.cryptoAddr || settings.cryptoAddr || 'Not set';
    
    if (state.payment === 'Paytm') {
      startQrTimer();
    }
  } else {
    clearInterval(qrTimerInterval);
  }
}

function switchTab(tabName) {
  if (!isNavigatingFromHistory) {
    history.pushState({ tab: tabName, type: 'tab' }, '', '#' + tabName);
  }

  clearInterval(qrTimerInterval);
  
  // Update Nav Active State
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
    if(item.dataset.tab === tabName) item.classList.add('active');
  });

  // Hide All Pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('view-active'));
  
  if (tabName === 'home') {
    // Rely on navigate to handle header and step UI for Home
    navigate(1); 
  } else {
    // Hide Home specific UI
    document.querySelector('.header').style.display = 'none';
    document.querySelector('.step-indicator').style.display = 'none';
    
    if (tabName === 'orders') {
      document.getElementById('page-orders').classList.add('view-active');
      renderOrders();
    } else if (tabName === 'history') {
      document.getElementById('page-history').classList.add('view-active');
      renderHistory();
    }
  }
}

async function renderOrders() {
  const container = document.getElementById('orders-list-container');
  container.innerHTML = '<div style="text-align:center; padding: 40px; color: var(--text-muted);"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading...</div>';
  
  await initBackend({ silent: true });
  
  container.innerHTML = '';
  const orders = globalData.orders || [];
  const activeOrders = orders.filter(o => o.status === 'Pending');
  
  if (activeOrders.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 40px 0;"><i class="fa-solid fa-box-open" style="font-size: 40px; margin-bottom: 10px; opacity: 0.5;"></i><p>No active orders.</p></div>';
    return;
  }
  
  activeOrders.forEach(order => {
    const card = document.createElement('div');
    card.className = 'order-card';
    card.innerHTML = `
      <div class="order-header">
        <span class="order-id">${order.id}</span>
        <span class="order-status status-pending"><i class="fa-solid fa-clock"></i> Pending</span>
      </div>
      <div class="order-details">
        <div class="order-service">${order.service} - ${order.qty}</div>
        <div><i class="fa-solid fa-link" style="color:var(--text-muted);width:16px;"></i> ${order.link}</div>
        <div><i class="fa-regular fa-calendar" style="color:var(--text-muted);width:16px;"></i> ${order.date}</div>
      </div>
    `;
    container.appendChild(card);
  });
}

async function renderHistory() {
  const container = document.getElementById('history-list-container');
  container.innerHTML = '<div style="text-align:center; padding: 40px; color: var(--text-muted);"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading...</div>';
  
  await initBackend({ silent: true });
  
  container.innerHTML = '';
  
  const orders = globalData.orders || [];
  
  if (orders.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 40px 0;"><i class="fa-solid fa-receipt" style="font-size: 40px; margin-bottom: 10px; opacity: 0.5;"></i><p>No order history yet.</p></div>';
    return;
  }
  
  orders.forEach(order => {
    const card = document.createElement('div');
    card.className = 'order-card';
    
    let statusClass = 'status-pending';
    let statusIcon = '<i class="fa-solid fa-clock"></i>';
    if (order.status === 'Approved') {
      statusClass = 'status-completed';
      statusIcon = '<i class="fa-solid fa-check-circle"></i>';
    } else if (order.status === 'Rejected') {
      statusClass = 'status-rejected';
      statusIcon = '<i class="fa-solid fa-times-circle"></i>';
    }
    
    card.innerHTML = `
      <div class="order-header">
        <span class="order-id">${order.id}</span>
        <span class="order-status ${statusClass}">${statusIcon} ${order.status}</span>
      </div>
      <div class="order-details">
        <div class="order-service">${order.service} - ${order.qty}</div>
        <div style="color: #10b981; font-weight: 600;"><i class="fa-solid fa-indian-rupee-sign"></i> ${order.price}</div>
        <div><i class="fa-solid fa-wallet" style="color:var(--text-muted);width:16px;"></i> Via ${order.payment}</div>
        <div><i class="fa-solid fa-receipt" style="color:var(--text-muted);width:16px;"></i> Ref: ${order.transactionRef || 'N/A'}</div>
        <div style="font-size: 11px; margin-top: 4px; color: var(--text-muted);">${order.date}</div>
      </div>
    `;
    container.appendChild(card);
  });
}

function validateForm() {
  const linkInput = document.getElementById('link-input');
  const val = linkInput.value.trim();
  
  if (!val) {
    linkInput.classList.add('error');
    showToast('Please enter your account link or username!', 'error');
    linkInput.focus();
    return false;
  }
  
  linkInput.classList.remove('error');
  return true;
}

function placeOrder() {
// Validate Payment forms if required
  let transactionRef = '';
  
  if (state.payment === 'UPI') {
    const upiRef = document.getElementById('upi-ref-input').value.trim();
    if (!upiRef) {
      showToast('Please enter the UTR / Reference Number', 'error');
      document.getElementById('upi-ref-input').focus();
      return;
    }
    transactionRef = upiRef;
  } else if (state.payment === 'Card') {
    const cardVal = document.getElementById('card-input').value.trim();
    if (!cardVal) {
      showToast('Please enter your Card Reference Number', 'error');
      document.getElementById('card-input').focus();
      return;
    }
    transactionRef = cardVal;
  } else if (state.payment === 'Paytm') {
    const paytmRef = document.getElementById('paytm-ref-input').value.trim();
    if (!paytmRef || paytmRef.length !== 12) {
      showToast('Please enter a valid 12-Digit UTR Number', 'error');
      document.getElementById('paytm-ref-input').focus();
      return;
    }
    transactionRef = paytmRef;
  } else if (state.payment === 'Crypto') {
    const cryptoVal = document.getElementById('crypto-input').value.trim();
    if (!cryptoVal) {
      showToast('Please enter the Transaction Hash (TxID)', 'error');
      document.getElementById('crypto-input').focus();
      return;
    }
    transactionRef = cryptoVal;
  }

  // Set loading state
  const btn = document.getElementById('btn-place-order');
  const btnText = btn.querySelector('.btn-text');
  const btnIcon = btn.querySelector('.fa-lock');
  const loader = btn.querySelector('.loader');

  btnText.textContent = 'Processing...';
  btnIcon.classList.add('hidden');
  loader.classList.remove('hidden');
  btn.style.pointerEvents = 'none';

  if (!isBackendConnected) {
    btnText.textContent = 'Pay Now Securely';
    btnIcon.classList.remove('hidden');
    loader.classList.add('hidden');
    btn.style.pointerEvents = 'auto';
    showToast('Server connect nahi ho raha. Order place karne ke liye app ko `npm start` ke saath chalao.', 'error');
    return;
  }

  // Send order to Server API
  setTimeout(async () => {
    const orderId = '#ORD-' + Math.floor(10000 + Math.random() * 90000);
    const orderRecord = {
      id: orderId,
      service: state.service,
      qty: state.qty,
      price: state.price,
      link: document.getElementById('link-input').value.trim(),
      email: document.getElementById('email-input').value.trim(),
      payment: state.payment,
      transactionRef: transactionRef,
      status: 'Pending',
      date: new Date().toLocaleString()
    };

    try {
      await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderRecord)
      });

      globalData.orders = [...(globalData.orders || []), orderRecord];
      cachePublicData(globalData);
      
      document.getElementById('main-app').classList.add('hidden');
      const successScreen = document.getElementById('success-screen');
      successScreen.classList.remove('hidden');
      
      // Fill success details
      document.getElementById('receipt-id').textContent = orderId;
      document.getElementById('receipt-service').textContent = state.service;
      document.getElementById('receipt-qty').textContent = state.qty;
      document.getElementById('receipt-paid').textContent = '₹' + state.price;

      if (!isNavigatingFromHistory) {
        history.pushState({ type: 'success' }, '', '#success');
      }

      createConfetti();
      
    } catch (e) {
      console.error(e);
      showToast('Failed to place order. Try again.', 'error');
    }
    
    // Restore button for next time
    btnText.textContent = 'Pay Now Securely';
    btnIcon.classList.remove('hidden');
    loader.classList.add('hidden');
    btn.style.pointerEvents = 'auto';

  }, 1000);
}

function resetApp() {
  document.getElementById('success-screen').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');
  document.getElementById('link-input').value = '';
  document.getElementById('email-input').value = '';
  if(document.getElementById('upi-ref-input')) document.getElementById('upi-ref-input').value = '';
  if(document.getElementById('card-input')) document.getElementById('card-input').value = '';
  if(document.getElementById('paytm-ref-input')) document.getElementById('paytm-ref-input').value = '';
  if(document.getElementById('crypto-input')) document.getElementById('crypto-input').value = '';
  
  switchTab('home');
}

// Custom Toast Notification System
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.classList.add('toast', type);
  
  const icon = type === 'success' ? '<i class="fa-solid fa-circle-check"></i>' : '<i class="fa-solid fa-circle-exclamation"></i>';
  toast.innerHTML = `${icon} <span>${message}</span>`;
  
  container.appendChild(toast);
  
  // Trigger animation
  setTimeout(() => toast.classList.add('show'), 10);
  
  // Remove after 3 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Simple Confetti effect
function createConfetti() {
  const container = document.getElementById('confetti');
  container.innerHTML = '';
  const colors = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#3b82f6'];
  
  for (let i = 0; i < 50; i++) {
    const conf = document.createElement('div');
    conf.style.position = 'absolute';
    conf.style.width = '8px';
    conf.style.height = '8px';
    conf.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    conf.style.left = Math.random() * 100 + 'vw';
    conf.style.top = -10 + 'px';
    conf.style.opacity = Math.random();
    conf.style.transform = `rotate(${Math.random() * 360}deg)`;
    conf.style.zIndex = '101';
    
    container.appendChild(conf);
    
    const animation = conf.animate([
      { transform: `translate3d(0,0,0) rotate(0deg)`, opacity: 1 },
      { transform: `translate3d(${Math.random() * 100 - 50}px, 100vh, 0) rotate(${Math.random() * 720}deg)`, opacity: 0 }
    ], {
      duration: Math.random() * 1500 + 1000,
      easing: 'cubic-bezier(.37,0,.63,1)',
      fill: 'forwards'
    });
    
    animation.onfinish = () => conf.remove();
  }
}
