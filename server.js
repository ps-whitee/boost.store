const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const ADMIN_USERNAME = 'darknet';
const ADMIN_PASSWORD = 'insider';
const ADMIN_COOKIE_NAME = 'booststore_admin_session';
const USER_COOKIE_NAME = 'booststore_user_session';

const DEFAULT_FIREBASE_WEB_CONFIG = {
  apiKey: 'AIzaSyCTtZ_8xNJGGsxKlod3U4XUjsuJDK2cVm8',
  authDomain: 'sm-boost-b10d2.firebaseapp.com',
  projectId: 'sm-boost-b10d2',
  storageBucket: 'sm-boost-b10d2.firebasestorage.app',
  messagingSenderId: '1075231898122',
  appId: '1:1075231898122:web:d71d0189c25a015e1b7df3',
  measurementId: 'G-8QCG5P9XGW'
};

const FIREBASE_WEB_CONFIG = {
  apiKey: process.env.FIREBASE_WEB_API_KEY || DEFAULT_FIREBASE_WEB_CONFIG.apiKey,
  authDomain: process.env.FIREBASE_WEB_AUTH_DOMAIN || DEFAULT_FIREBASE_WEB_CONFIG.authDomain,
  projectId: process.env.FIREBASE_WEB_PROJECT_ID || DEFAULT_FIREBASE_WEB_CONFIG.projectId,
  storageBucket: process.env.FIREBASE_WEB_STORAGE_BUCKET || DEFAULT_FIREBASE_WEB_CONFIG.storageBucket,
  messagingSenderId: process.env.FIREBASE_WEB_MESSAGING_SENDER_ID || DEFAULT_FIREBASE_WEB_CONFIG.messagingSenderId,
  appId: process.env.FIREBASE_WEB_APP_ID || DEFAULT_FIREBASE_WEB_CONFIG.appId,
  measurementId: process.env.FIREBASE_WEB_MEASUREMENT_ID || DEFAULT_FIREBASE_WEB_CONFIG.measurementId
};

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  const blockedPaths = ['server.js', 'package.json', 'package-lock.json', '.env', '.env.example', 'serviceAccountKey.json', 'data.json'];

  if (blockedPaths.some(fileName => req.path.includes(fileName))) {
    return res.status(403).send('Forbidden');
  }

  next();
});

function getEmptyData() {
  return {
    settings: {},
    packages: {},
    orders: [],
    fundRequests: [],
    users: []
  };
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function mapUser(data = {}) {
  return {
    uid: String(data.uid || ''),
    email: normalizeEmail(data.email),
    walletBalance: Number(data.walletBalance) || 0,
    createdAt: data.createdAt || '',
    lastLoginAt: data.lastLoginAt || ''
  };
}

function sanitizeUser(user = {}) {
  const mappedUser = mapUser(user);
  return {
    uid: mappedUser.uid,
    email: mappedUser.email,
    walletBalance: mappedUser.walletBalance
  };
}

function normalizeData(data) {
  const normalized = data && typeof data === 'object' ? data : {};

  return {
    settings: normalized.settings && typeof normalized.settings === 'object' ? normalized.settings : {},
    packages: normalized.packages && typeof normalized.packages === 'object' ? normalized.packages : {},
    orders: Array.isArray(normalized.orders) ? normalized.orders : [],
    fundRequests: Array.isArray(normalized.fundRequests) ? normalized.fundRequests : [],
    users: Array.isArray(normalized.users) ? normalized.users.map(mapUser) : []
  };
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(getEmptyData(), null, 2));
  }
}

function readData() {
  ensureDataFile();

  try {
    const fileContents = fs.readFileSync(DATA_FILE, 'utf8');
    return normalizeData(JSON.parse(fileContents));
  } catch (error) {
    const fallbackData = normalizeData(getEmptyData());
    fs.writeFileSync(DATA_FILE, JSON.stringify(fallbackData, null, 2));
    return fallbackData;
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(normalizeData(data), null, 2));
}

function findUserIndex(data, email) {
  const normalizedEmail = normalizeEmail(email);
  return data.users.findIndex(user => normalizeEmail(user.email) === normalizedEmail);
}

function getUserByEmail(data, email) {
  const userIndex = findUserIndex(data, email);
  return userIndex >= 0 ? mapUser(data.users[userIndex]) : null;
}

function upsertUser(data, userData = {}) {
  const email = normalizeEmail(userData.email);

  if (!email) {
    throw new Error('User email is required');
  }

  const userIndex = findUserIndex(data, email);
  const existingUser = userIndex >= 0 ? mapUser(data.users[userIndex]) : null;
  const nextUser = {
    uid: String(userData.uid || (existingUser && existingUser.uid) || ''),
    email,
    walletBalance: userData.walletBalance !== undefined
      ? Number(userData.walletBalance) || 0
      : (existingUser ? existingUser.walletBalance : 0),
    createdAt: (existingUser && existingUser.createdAt) || new Date().toISOString(),
    lastLoginAt: userData.lastLoginAt || new Date().toISOString()
  };

  if (userIndex >= 0) {
    data.users[userIndex] = nextUser;
  } else {
    data.users.push(nextUser);
  }

  return nextUser;
}

function generateUniqueId(prefix, existingItems) {
  let nextId = '';

  do {
    nextId = prefix + Math.floor(10000 + Math.random() * 90000);
  } while (existingItems.some(item => item.id === nextId));

  return nextId;
}

function parseCookies(req) {
  const rawCookie = req.headers.cookie;

  if (!rawCookie) {
    return {};
  }

  return rawCookie.split(';').reduce((cookies, entry) => {
    const separatorIndex = entry.indexOf('=');
    const key = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim();

    if (key) {
      cookies[key] = decodeURIComponent(value);
    }

    return cookies;
  }, {});
}

function createSignedSessionValue(sessionData) {
  const payload = Buffer.from(
    JSON.stringify({
      ...sessionData,
      exp: Date.now() + SESSION_TTL_MS
    })
  ).toString('base64url');

  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function getSecureCookieParts(req, name, value, maxAgeMs = SESSION_TTL_MS) {
  const cookieParts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`
  ];

  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    cookieParts.push('Secure');
  }

  return cookieParts;
}

function setSignedCookie(req, res, name, value, maxAgeMs = SESSION_TTL_MS) {
  res.append('Set-Cookie', getSecureCookieParts(req, name, value, maxAgeMs).join('; '));
}

function clearSignedCookie(req, res, name) {
  setSignedCookie(req, res, name, '', 0);
}

function readSignedSession(req, cookieName) {
  try {
    const cookies = parseCookies(req);
    const token = cookies[cookieName];

    if (!token) {
      return null;
    }

    const [payload, signature] = token.split('.');

    if (!payload || !signature) {
      return null;
    }

    const expectedSignature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
    const providedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (providedBuffer.length !== expectedBuffer.length) {
      return null;
    }

    if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
      return null;
    }

    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

    if (!session.exp || session.exp < Date.now()) {
      return null;
    }

    return session;
  } catch (error) {
    return null;
  }
}

function requireAdmin(req, res, next) {
  const session = readSignedSession(req, ADMIN_COOKIE_NAME);

  if (!session || session.user !== ADMIN_USERNAME) {
    clearSignedCookie(req, res, ADMIN_COOKIE_NAME);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

function requireUser(req, res, next) {
  const session = readSignedSession(req, USER_COOKIE_NAME);

  if (!session || !session.email || !session.uid) {
    clearSignedCookie(req, res, USER_COOKIE_NAME);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.userEmail = normalizeEmail(session.email);
  req.userUid = String(session.uid);
  next();
}

function hasFirebaseWebConfig() {
  return Boolean(
    FIREBASE_WEB_CONFIG.apiKey &&
    FIREBASE_WEB_CONFIG.authDomain &&
    FIREBASE_WEB_CONFIG.projectId &&
    FIREBASE_WEB_CONFIG.appId
  );
}

function mapFirebaseLookupError(code) {
  switch (code) {
    case 'INVALID_ID_TOKEN':
    case 'TOKEN_EXPIRED':
    case 'USER_NOT_FOUND':
      return 'Your sign in session is no longer valid. Please log in again.';
    default:
      return 'Invalid Firebase session.';
  }
}

async function fetchFirebaseAccountByIdToken(idToken) {
  if (!hasFirebaseWebConfig()) {
    throw new Error('Firebase email/password auth is not configured yet.');
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_WEB_CONFIG.apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    }
  );

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorCode = payload && payload.error && payload.error.message;
    const error = new Error(mapFirebaseLookupError(errorCode));
    error.code = errorCode || 'INVALID_ID_TOKEN';
    throw error;
  }

  const account = Array.isArray(payload.users) ? payload.users[0] : null;

  if (!account || !account.localId || !normalizeEmail(account.email)) {
    throw new Error('Firebase user email is required');
  }

  return {
    uid: String(account.localId),
    email: normalizeEmail(account.email)
  };
}

app.use(express.static(__dirname));

// =======================
// PUBLIC API
// =======================

app.get('/api/data', (req, res) => {
  const data = readData();
  res.json({
    settings: data.settings || {},
    packages: data.packages || {}
  });
});

app.get('/api/firebase/config', (req, res) => {
  if (!hasFirebaseWebConfig()) {
    return res.json({ enabled: false });
  }

  res.json({
    enabled: true,
    config: FIREBASE_WEB_CONFIG
  });
});

// =======================
// USER AUTH API
// =======================

app.post('/api/users/session', async (req, res) => {
  const { idToken } = req.body || {};

  if (!idToken) {
    return res.status(400).json({ error: 'Missing Firebase ID token' });
  }

  try {
    const firebaseAccount = await fetchFirebaseAccountByIdToken(idToken);
    const data = readData();
    const user = upsertUser(data, {
      uid: firebaseAccount.uid,
      email: firebaseAccount.email,
      lastLoginAt: new Date().toISOString()
    });

    writeData(data);

    setSignedCookie(
      req,
      res,
      USER_COOKIE_NAME,
      createSignedSessionValue({
        uid: user.uid,
        email: user.email
      })
    );

    res.json({ success: true, user: sanitizeUser(user) });
  } catch (error) {
    clearSignedCookie(req, res, USER_COOKIE_NAME);
    res.status(401).json({ error: error.message || 'Invalid Firebase session' });
  }
});

app.post('/api/users/logout', (req, res) => {
  clearSignedCookie(req, res, USER_COOKIE_NAME);
  res.json({ success: true });
});

app.get('/api/users/me', requireUser, (req, res) => {
  const data = readData();
  const user = getUserByEmail(data, req.userEmail);

  if (!user) {
    clearSignedCookie(req, res, USER_COOKIE_NAME);
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({
    user: sanitizeUser(user),
    orders: data.orders.filter(order => normalizeEmail(order.email) === req.userEmail),
    fundRequests: data.fundRequests.filter(request => normalizeEmail(request.email) === req.userEmail)
  });
});

// =======================
// USER ACTION API
// =======================

app.post('/api/orders', requireUser, (req, res) => {
  const newOrder = req.body || {};
  const orderPrice = Number(newOrder.price);

  if (!newOrder.id || !Number.isFinite(orderPrice) || orderPrice <= 0) {
    return res.status(400).json({ error: 'Invalid order data' });
  }

  const data = readData();
  const userIndex = findUserIndex(data, req.userEmail);

  if (userIndex < 0) {
    clearSignedCookie(req, res, USER_COOKIE_NAME);
    return res.status(404).json({ error: 'User not found' });
  }

  const user = mapUser(data.users[userIndex]);

  if (user.walletBalance < orderPrice) {
    return res.status(400).json({ error: 'Insufficient wallet balance' });
  }

  if (data.orders.some(order => order.id === newOrder.id)) {
    return res.status(409).json({ error: 'Order already exists' });
  }

  user.walletBalance -= orderPrice;
  data.users[userIndex] = {
    ...user,
    lastLoginAt: user.lastLoginAt || new Date().toISOString()
  };

  const savedOrder = {
    ...newOrder,
    price: orderPrice,
    email: req.userEmail,
    userId: req.userUid,
    payment: 'Wallet'
  };

  data.orders.push(savedOrder);
  writeData(data);

  res.status(201).json({
    success: true,
    order: savedOrder,
    newBalance: user.walletBalance
  });
});

app.post('/api/fund-requests', requireUser, (req, res) => {
  const { amount, paymentMethod, transactionRef } = req.body || {};
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !transactionRef) {
    return res.status(400).json({ error: 'Invalid fund request data' });
  }

  const data = readData();
  const fundRequest = {
    id: generateUniqueId('#FR-', data.fundRequests),
    email: req.userEmail,
    userId: req.userUid,
    amount: numericAmount,
    paymentMethod: paymentMethod || 'Paytm',
    transactionRef: String(transactionRef).trim(),
    status: 'Pending',
    date: new Date().toLocaleString()
  };

  data.fundRequests.push(fundRequest);
  writeData(data);

  res.json({ success: true, fundRequest });
});

// =======================
// ADMIN AUTH API
// =======================

app.get('/api/admin/session', (req, res) => {
  const session = readSignedSession(req, ADMIN_COOKIE_NAME);
  res.json({ authenticated: Boolean(session && session.user === ADMIN_USERNAME) });
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    clearSignedCookie(req, res, ADMIN_COOKIE_NAME);
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  setSignedCookie(
    req,
    res,
    ADMIN_COOKIE_NAME,
    createSignedSessionValue({ user: ADMIN_USERNAME })
  );

  res.json({ success: true });
});

app.post('/api/admin/logout', (req, res) => {
  clearSignedCookie(req, res, ADMIN_COOKIE_NAME);
  res.json({ success: true });
});

// =======================
// ADMIN DATA API
// =======================

app.get('/api/admin/data', requireAdmin, (req, res) => {
  const data = readData();

  res.json({
    settings: data.settings || {},
    packages: data.packages || {},
    orders: data.orders || [],
    fundRequests: data.fundRequests || [],
    users: data.users.map(sanitizeUser)
  });
});

app.put('/api/orders/:id', requireAdmin, (req, res) => {
  const orderId = req.params.id;
  const { status } = req.body || {};
  const data = readData();
  const orderIndex = data.orders.findIndex(order => order.id === orderId);

  if (orderIndex < 0) {
    return res.status(404).json({ error: 'Order not found' });
  }

  data.orders[orderIndex] = {
    ...data.orders[orderIndex],
    status
  };

  writeData(data);
  res.json({ success: true, order: data.orders[orderIndex] });
});

app.delete('/api/orders/:id', requireAdmin, (req, res) => {
  const orderId = req.params.id;
  const data = readData();
  const orderIndex = data.orders.findIndex(order => order.id === orderId);

  if (orderIndex < 0) {
    return res.status(404).json({ error: 'Order not found' });
  }

  data.orders.splice(orderIndex, 1);
  writeData(data);
  res.json({ success: true });
});

app.put('/api/admin/fund-requests/:id', requireAdmin, (req, res) => {
  const requestId = req.params.id;
  const { status } = req.body || {};
  const data = readData();
  const fundIndex = data.fundRequests.findIndex(request => request.id === requestId);

  if (fundIndex < 0) {
    return res.status(404).json({ error: 'Fund request not found' });
  }

  const currentRequest = data.fundRequests[fundIndex];

  if (currentRequest.status === 'Pending' && status === 'Approved') {
    const userIndex = findUserIndex(data, currentRequest.email);

    if (userIndex >= 0) {
      const user = mapUser(data.users[userIndex]);
      user.walletBalance += Number(currentRequest.amount) || 0;
      data.users[userIndex] = {
        ...user,
        lastLoginAt: user.lastLoginAt || new Date().toISOString()
      };
    }
  }

  data.fundRequests[fundIndex] = {
    ...currentRequest,
    status
  };

  writeData(data);
  res.json({ success: true, fundRequest: data.fundRequests[fundIndex] });
});

app.delete('/api/admin/fund-requests/:id', requireAdmin, (req, res) => {
  const requestId = req.params.id;
  const data = readData();
  const fundIndex = data.fundRequests.findIndex(request => request.id === requestId);

  if (fundIndex < 0) {
    return res.status(404).json({ error: 'Fund request not found' });
  }

  data.fundRequests.splice(fundIndex, 1);
  writeData(data);
  res.json({ success: true });
});

app.post('/api/settings', requireAdmin, (req, res) => {
  const { settings, packages } = req.body || {};
  const data = readData();

  if (settings && typeof settings === 'object') {
    data.settings = settings;
  }

  if (packages && typeof packages === 'object') {
    data.packages = packages;
  }

  writeData(data);
  res.json({ success: true });
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'social_media_marketplace.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
