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
let currentUser = null;
let firebaseAuth = null;
let isFirebaseAuthConfigured = false;
let isFirebaseAuthInitialized = false;
let firebaseSessionSyncPromise = null;
let pendingAuthAction = null;

async function initBackend(options = {}) {
  const { silent = false } = options;

  clearBackendRetry();

  try {
    const res = await fetch('/api/data', { cache: 'no-store' });

    if (!res.ok) {
      throw new Error(`Request failed with status ${res.status}`);
    }

    globalData = normalizePublicData(await res.json());
    
    // FETCH USER SESSION
    try {
      const userRes = await fetch('/api/users/me', { cache: 'no-store' });
      if (userRes.ok) {
        const userData = await userRes.json();
        currentUser = userData.user;
        globalData.orders = userData.orders || [];
        globalData.fundRequests = userData.fundRequests || [];
        updateWalletUI();
      } else {
        currentUser = null;
        globalData.orders = [];
        globalData.fundRequests = [];
        updateWalletUI();
      }
    } catch(e) {
      currentUser = null;
      globalData.orders = [];
      globalData.fundRequests = [];
      updateWalletUI();
    }

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

async function initFirebaseAuth() {
  if (isFirebaseAuthInitialized) {
    return isFirebaseAuthConfigured;
  }

  isFirebaseAuthInitialized = true;

  if (!window.firebase || typeof window.firebase.initializeApp !== 'function') {
    console.warn('Firebase web SDK is not loaded.');
    return false;
  }

  try {
    const response = await fetch('/api/firebase/config', { cache: 'no-store' });

    if (!response.ok) {
      throw new Error('Failed to load Firebase config');
    }

    const payload = await response.json();

    if (!payload.enabled || !payload.config) {
      console.warn('Firebase web auth is not configured on the server.');
      return false;
    }

    if (!window.firebase.apps.length) {
      window.firebase.initializeApp(payload.config);
    }

    firebaseAuth = window.firebase.auth();
    isFirebaseAuthConfigured = true;

    firebaseAuth.onAuthStateChanged(async user => {
      if (user) {
        try {
          await syncFirebaseUserSession(user);
          authModal.classList.add('hidden');
          await initBackend({ silent: true });
          runPendingAuthAction();
        } catch (error) {
          console.error('Failed to sync Firebase user session', error);
          showToast(getFirebaseErrorMessage(error), 'error');
        }
        return;
      }

      try {
        await fetch('/api/users/logout', { method: 'POST' });
      } catch (error) {
        console.error('Failed to clear server session', error);
      }

      clearCurrentUserState();
    });

    return true;
  } catch (error) {
    console.error('Firebase auth initialization failed', error);
    return false;
  }
}

async function ensureFirebaseAuthReady() {
  const ready = await initFirebaseAuth();

  if (!ready || !firebaseAuth) {
    showToast('Firebase email/password auth is not configured yet.', 'error');
    return false;
  }

  return true;
}

async function syncFirebaseUserSession(user) {
  if (!user || !firebaseAuth) {
    return null;
  }

  if (firebaseSessionSyncPromise) {
    return firebaseSessionSyncPromise;
  }

  firebaseSessionSyncPromise = (async () => {
    const idToken = await user.getIdToken(true);
    const response = await fetch('/api/users/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    });

    if (!response.ok) {
      const payload = await safeJson(response);
      throw new Error(payload.error || 'Failed to create user session');
    }

    const payload = await response.json();
    currentUser = payload.user || null;
    updateWalletUI();
    return currentUser;
  })();

  try {
    return await firebaseSessionSyncPromise;
  } finally {
    firebaseSessionSyncPromise = null;
  }
}

function clearCurrentUserState() {
  currentUser = null;
  globalData.orders = [];
  globalData.fundRequests = [];
  updateWalletUI();
}

function runPendingAuthAction() {
  if (typeof pendingAuthAction !== 'function') {
    return;
  }

  const action = pendingAuthAction;
  pendingAuthAction = null;
  action();
}

function getFirebaseErrorMessage(error) {
  switch (error && error.code) {
    case 'auth/email-already-in-use':
      return 'This email is already registered. Please log in instead.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/weak-password':
      return 'Password is too weak. Use at least 6 characters.';
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Invalid email or password.';
    case 'auth/too-many-requests':
      return 'Too many login attempts. Please try again later.';
    case 'auth/network-request-failed':
      return 'Network error while connecting to Firebase.';
    case 'auth/unauthorized-domain':
      return 'This domain is not added in Firebase Authorized Domains.';
    default:
      return error && error.message ? error.message : 'Authentication failed.';
  }
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
window.addEventListener('DOMContentLoaded', async () => {

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
  await initFirebaseAuth();
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

// User Auth Logic
const authModal = document.getElementById('auth-modal');
document.getElementById('btn-close-auth').addEventListener('click', () => {
  authModal.classList.add('hidden');
});

document.getElementById('btn-login').addEventListener('click', async () => {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value.trim();
  if (!email || !password) return showToast('Email and password required', 'error');

  try {
    if (!(await ensureFirebaseAuthReady())) {
      return;
    }

    const credential = await firebaseAuth.signInWithEmailAndPassword(email, password);
    await syncFirebaseUserSession(credential.user);
    await initBackend({ silent: true });
    authModal.classList.add('hidden');
    document.getElementById('auth-password').value = '';
    showToast('Logged in successfully!');
    runPendingAuthAction();
  } catch (error) {
    showToast(getFirebaseErrorMessage(error), 'error');
  }
});

document.getElementById('btn-register').addEventListener('click', async () => {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value.trim();
  if (!email || !password) return showToast('Email and password required', 'error');

  try {
    if (!(await ensureFirebaseAuthReady())) {
      return;
    }

    const credential = await firebaseAuth.createUserWithEmailAndPassword(email, password);
    await syncFirebaseUserSession(credential.user);
    await initBackend({ silent: true });
    authModal.classList.add('hidden');
    document.getElementById('auth-password').value = '';
    showToast('Account created successfully!');
    runPendingAuthAction();
  } catch (error) {
    showToast(getFirebaseErrorMessage(error), 'error');
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  try {
    if (firebaseAuth) {
      await firebaseAuth.signOut();
    } else {
      await fetch('/api/users/logout', { method: 'POST' });
    }
    clearCurrentUserState();
    showToast('Logged out');
    switchTab('home');
  } catch (error) {
    showToast('Failed to log out.', 'error');
  }
});

function requireAuth(callback) {
  if (currentUser) {
    callback();
  } else {
    pendingAuthAction = callback;
    authModal.classList.remove('hidden');
    document.getElementById('auth-email').focus();
  }
}

function updateWalletUI() {
  if (currentUser) {
    const balDisp = document.getElementById('checkout-wallet-balance');
    const mainBalDisp = document.getElementById('wallet-balance-main');
    if(balDisp) balDisp.textContent = '₹' + currentUser.walletBalance;
    if(mainBalDisp) mainBalDisp.textContent = '₹' + currentUser.walletBalance;
  }
}

document.getElementById('btn-add-funds').addEventListener('click', async () => {
  if (!currentUser) return;
  const amount = document.getElementById('add-fund-amount').value.trim();
  const utr = document.getElementById('paytm-ref-input').value.trim();

  if (!amount || parseInt(amount) <= 0) return showToast('Enter valid amount', 'error');
  if (!utr || utr.length !== 12) return showToast('Enter valid 12-digit UTR', 'error');

  const btn = document.getElementById('btn-add-funds');
  const btnText = btn.querySelector('.btn-text');
  const loader = btn.querySelector('.loader');
  
  btnText.textContent = 'Processing...';
  loader.classList.remove('hidden');
  btn.style.pointerEvents = 'none';

  try {
    const res = await fetch('/api/fund-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: parseInt(amount), paymentMethod: 'Paytm', transactionRef: utr })
    });
    
    if (res.ok) {
      showToast('Fund request submitted! Waiting for admin approval.');
      document.getElementById('add-fund-amount').value = '';
      document.getElementById('paytm-ref-input').value = '';
      initBackend({ silent: true }); // refresh data
    } else {
      const d = await res.json();
      showToast(d.error || 'Failed to submit request', 'error');
    }
  } catch(e) {
    showToast('Error submitting request', 'error');
  }

  btnText.textContent = 'Submit Request';
  loader.classList.add('hidden');
  btn.style.pointerEvents = 'auto';
});

// DOM Elements
const pages = [document.getElementById('page1'), document.getElementById('page2'), document.getElementById('page3')];
const steps = [document.getElementById('step1'), document.getElementById('step2'), document.getElementById('step3')];

// Navigation listeners
document.getElementById('btn-back-to-1').addEventListener('click', () => navigate(1));
document.getElementById('btn-next-to-3').addEventListener('click', () => {
  if (validateForm()) {
    requireAuth(() => navigate(3));
  }
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
    
    // Ensure wallet balance reflects immediately
    updateWalletUI();
    const btnPlaceOrder = document.getElementById('btn-place-order');
    if (currentUser && currentUser.walletBalance < state.price) {
      document.getElementById('checkout-wallet-error').classList.remove('hidden');
      btnPlaceOrder.disabled = true;
      btnPlaceOrder.style.opacity = '0.5';
    } else {
      document.getElementById('checkout-wallet-error').classList.add('hidden');
      btnPlaceOrder.disabled = false;
      btnPlaceOrder.style.opacity = '1';
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
    requireAuth(() => {
      // Hide Home specific UI
      document.querySelector('.header').style.display = 'none';
      document.querySelector('.step-indicator').style.display = 'none';
      
      if (tabName === 'orders') {
        document.getElementById('page-orders').classList.add('view-active');
        renderOrders();
      } else if (tabName === 'history') {
        document.getElementById('page-history').classList.add('view-active');
        renderHistory();
      } else if (tabName === 'wallet') {
        document.getElementById('page-wallet').classList.add('view-active');
        
        // Update Add Funds global QR
        const settings = globalData.settings || {};
        document.getElementById('paytm-qr').src = settings.qrUrl || settings.paytmQrUrl || '';
        startQrTimer();
      }
    });
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
  if (!currentUser) return requireAuth(() => navigate(3));

  if (currentUser.walletBalance < state.price) {
    showToast('Insufficient wallet balance', 'error');
    return;
  }

  // Set loading state
  const btn = document.getElementById('btn-place-order');
  const btnText = btn.querySelector('.btn-text');
  const btnIcon = btn.querySelector('.fa-wallet');
  const loader = btn.querySelector('.loader');

  btnText.textContent = 'Processing...';
  if(btnIcon) btnIcon.classList.add('hidden');
  loader.classList.remove('hidden');
  btn.style.pointerEvents = 'none';

  if (!isBackendConnected) {
    btnText.textContent = 'Pay with Wallet & Order';
    if(btnIcon) btnIcon.classList.remove('hidden');
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
      email: currentUser.email || document.getElementById('email-input').value.trim(),
      status: 'Pending',
      date: new Date().toLocaleString()
    };

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderRecord)
      });
      
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to place order');
      }

      const responseData = await res.json();
      
      currentUser.walletBalance = responseData.newBalance;
      updateWalletUI();

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
      showToast(e.message || 'Failed to place order. Try again.', 'error');
    }
    
    // Restore button for next time
    btnText.textContent = 'Pay with Wallet & Order';
    if(btnIcon) btnIcon.classList.remove('hidden');
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

async function safeJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

function updateWalletUI() {
  const balance = currentUser ? currentUser.walletBalance : 0;
  const balDisp = document.getElementById('checkout-wallet-balance');
  const mainBalDisp = document.getElementById('wallet-balance-main');
  if (balDisp) balDisp.textContent = 'â‚¹' + balance;
  if (mainBalDisp) mainBalDisp.textContent = 'â‚¹' + balance;
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
