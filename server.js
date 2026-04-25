const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const ADMIN_USERNAME = 'darknet';
const ADMIN_PASSWORD = 'insider';
const ADMIN_COOKIE_NAME = 'booststore_admin_session';
const USER_COOKIE_NAME = 'booststore_user_session';

const FIREBASE_WEB_CONFIG = {
  apiKey: process.env.FIREBASE_WEB_API_KEY || '',
  authDomain: process.env.FIREBASE_WEB_AUTH_DOMAIN || '',
  projectId: process.env.FIREBASE_WEB_PROJECT_ID || '',
  storageBucket: process.env.FIREBASE_WEB_STORAGE_BUCKET || '',
  messagingSenderId: process.env.FIREBASE_WEB_MESSAGING_SENDER_ID || '',
  appId: process.env.FIREBASE_WEB_APP_ID || ''
};

let db = null;

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  const blockedPaths = ['server.js', 'package.json', 'package-lock.json', '.env', 'serviceAccountKey.json'];

  if (blockedPaths.some(fileName => req.path.includes(fileName))) {
    return res.status(403).send('Forbidden');
  }

  next();
});

function initializeFirebaseAdmin() {
  try {
    if (admin.apps.length) {
      db = admin.firestore();
      return;
    }

    const credentialsFile = process.env.FIREBASE_CREDENTIALS || './serviceAccountKey.json';
    const credentialsPath = path.resolve(credentialsFile);

    if (!fs.existsSync(credentialsPath)) {
      console.warn(`Firebase credentials not found at ${credentialsPath}.`);
      return;
    }

    const rawCredentials = fs.readFileSync(credentialsPath, 'utf8');

    if (rawCredentials.includes('REPLACE_ME')) {
      console.warn('Firebase credentials file still contains REPLACE_ME placeholders.');
      return;
    }

    const serviceAccount = JSON.parse(rawCredentials);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id || FIREBASE_WEB_CONFIG.projectId || undefined
    });

    db = admin.firestore();
    console.log('Firebase Admin initialized successfully.');
  } catch (error) {
    console.error('Firebase initialization error:', error.message);
  }
}

initializeFirebaseAdmin();

function isFirebaseReady() {
  return Boolean(db && admin.apps.length);
}

function hasFirebaseWebConfig() {
  return Boolean(
    FIREBASE_WEB_CONFIG.apiKey &&
      FIREBASE_WEB_CONFIG.authDomain &&
      FIREBASE_WEB_CONFIG.projectId &&
      FIREBASE_WEB_CONFIG.appId
  );
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
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
  req.userUid = session.uid;
  next();
}

function ensureDatabase(res) {
  if (!isFirebaseReady()) {
    res.status(500).json({ error: 'Firebase is not configured on the server' });
    return false;
  }

  return true;
}

function mapUser(data = {}) {
  return {
    uid: data.uid || '',
    email: normalizeEmail(data.email),
    walletBalance: Number(data.walletBalance) || 0
  };
}

async function getGlobalData() {
  if (!db) {
    return { settings: {}, packages: {} };
  }

  const snapshot = await db.collection('global').doc('config').get();
  return snapshot.exists ? snapshot.data() : { settings: {}, packages: {} };
}

async function saveGlobalData(data) {
  await db.collection('global').doc('config').set(data, { merge: true });
}

app.use(express.static(__dirname));

// =======================
// PUBLIC API
// =======================

app.get('/api/data', async (req, res) => {
  try {
    const data = await getGlobalData();
    res.json({
      settings: data.settings || {},
      packages: data.packages || {}
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load public data' });
  }
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
  if (!ensureDatabase(res)) {
    return;
  }

  const { idToken } = req.body || {};

  if (!idToken) {
    return res.status(400).json({ error: 'Missing Firebase ID token' });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const email = normalizeEmail(decodedToken.email);

    if (!email) {
      return res.status(400).json({ error: 'Firebase user email is required' });
    }

    const userRef = db.collection('users').doc(email);
    await userRef.set(
      {
        uid: decodedToken.uid,
        email,
        walletBalance: admin.firestore.FieldValue.increment(0),
        password: admin.firestore.FieldValue.delete(),
        lastLoginAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    const userDoc = await userRef.get();
    const user = mapUser(userDoc.data());

    setSignedCookie(
      req,
      res,
      USER_COOKIE_NAME,
      createSignedSessionValue({
        uid: decodedToken.uid,
        email
      })
    );

    res.json({ success: true, user });
  } catch (error) {
    clearSignedCookie(req, res, USER_COOKIE_NAME);
    res.status(401).json({ error: 'Invalid Firebase session' });
  }
});

app.post('/api/users/logout', (req, res) => {
  clearSignedCookie(req, res, USER_COOKIE_NAME);
  res.json({ success: true });
});

app.get('/api/users/me', requireUser, async (req, res) => {
  if (!ensureDatabase(res)) {
    return;
  }

  try {
    const userDoc = await db.collection('users').doc(req.userEmail).get();

    if (!userDoc.exists) {
      clearSignedCookie(req, res, USER_COOKIE_NAME);
      return res.status(404).json({ error: 'User not found' });
    }

    const [ordersSnapshot, fundsSnapshot] = await Promise.all([
      db.collection('orders').where('email', '==', req.userEmail).get(),
      db.collection('fundRequests').where('email', '==', req.userEmail).get()
    ]);

    res.json({
      user: mapUser(userDoc.data()),
      orders: ordersSnapshot.docs.map(doc => doc.data()),
      fundRequests: fundsSnapshot.docs.map(doc => doc.data())
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load user data' });
  }
});

// =======================
// USER ACTION API
// =======================

app.post('/api/orders', requireUser, async (req, res) => {
  if (!ensureDatabase(res)) {
    return;
  }

  const newOrder = req.body || {};
  const orderPrice = Number(newOrder.price);

  if (!newOrder.id || !Number.isFinite(orderPrice) || orderPrice <= 0) {
    return res.status(400).json({ error: 'Invalid order data' });
  }

  try {
    const userRef = db.collection('users').doc(req.userEmail);
    const orderRef = db.collection('orders').doc(newOrder.id);

    const newBalance = await db.runTransaction(async transaction => {
      const userDoc = await transaction.get(userRef);

      if (!userDoc.exists) {
        throw new Error('User not found');
      }

      const userData = userDoc.data();
      const walletBalance = Number(userData.walletBalance) || 0;

      if (walletBalance < orderPrice) {
        throw new Error('Insufficient wallet balance');
      }

      const updatedBalance = walletBalance - orderPrice;

      transaction.update(userRef, { walletBalance: updatedBalance });
      transaction.set(orderRef, {
        ...newOrder,
        price: orderPrice,
        email: req.userEmail,
        userId: req.userUid,
        payment: 'Wallet'
      });

      return updatedBalance;
    });

    res.status(201).json({
      success: true,
      order: {
        ...newOrder,
        price: orderPrice,
        email: req.userEmail,
        userId: req.userUid,
        payment: 'Wallet'
      },
      newBalance
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/fund-requests', requireUser, async (req, res) => {
  if (!ensureDatabase(res)) {
    return;
  }

  const { amount, paymentMethod, transactionRef } = req.body || {};
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !transactionRef) {
    return res.status(400).json({ error: 'Invalid fund request data' });
  }

  try {
    const requestId = '#FR-' + Math.floor(10000 + Math.random() * 90000);
    const fundRequest = {
      id: requestId,
      email: req.userEmail,
      userId: req.userUid,
      amount: numericAmount,
      paymentMethod: paymentMethod || 'Paytm',
      transactionRef,
      status: 'Pending',
      date: new Date().toLocaleString()
    };

    await db.collection('fundRequests').doc(requestId).set(fundRequest);
    res.json({ success: true, fundRequest });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit fund request' });
  }
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

app.get('/api/admin/data', requireAdmin, async (req, res) => {
  if (!ensureDatabase(res)) {
    return;
  }

  try {
    const [globalData, ordersSnapshot, fundsSnapshot, usersSnapshot] = await Promise.all([
      getGlobalData(),
      db.collection('orders').get(),
      db.collection('fundRequests').get(),
      db.collection('users').get()
    ]);

    const users = usersSnapshot.docs.map(doc => {
      const user = { ...doc.data() };
      delete user.password;
      return mapUser(user);
    });

    res.json({
      settings: globalData.settings || {},
      packages: globalData.packages || {},
      orders: ordersSnapshot.docs.map(doc => doc.data()),
      fundRequests: fundsSnapshot.docs.map(doc => doc.data()),
      users
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load admin data' });
  }
});

app.put('/api/orders/:id', requireAdmin, async (req, res) => {
  if (!ensureDatabase(res)) {
    return;
  }

  const orderId = req.params.id;
  const { status } = req.body || {};

  try {
    const orderRef = db.collection('orders').doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      return res.status(404).json({ error: 'Order not found' });
    }

    await orderRef.update({ status });
    res.json({ success: true, order: (await orderRef.get()).data() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update order' });
  }
});

app.delete('/api/orders/:id', requireAdmin, async (req, res) => {
  if (!ensureDatabase(res)) {
    return;
  }

  const orderId = req.params.id;

  try {
    const orderRef = db.collection('orders').doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      return res.status(404).json({ error: 'Order not found' });
    }

    await orderRef.delete();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete order' });
  }
});

app.put('/api/admin/fund-requests/:id', requireAdmin, async (req, res) => {
  if (!ensureDatabase(res)) {
    return;
  }

  const requestId = req.params.id;
  const { status } = req.body || {};

  try {
    const fundRef = db.collection('fundRequests').doc(requestId);

    await db.runTransaction(async transaction => {
      const fundDoc = await transaction.get(fundRef);

      if (!fundDoc.exists) {
        throw new Error('Fund request not found');
      }

      const fundData = fundDoc.data();

      if (fundData.status === 'Pending' && status === 'Approved') {
        const userRef = db.collection('users').doc(normalizeEmail(fundData.email));
        const userDoc = await transaction.get(userRef);

        if (userDoc.exists) {
          const walletBalance = Number(userDoc.data().walletBalance) || 0;
          transaction.update(userRef, { walletBalance: walletBalance + Number(fundData.amount || 0) });
        }
      }

      transaction.update(fundRef, { status });
    });

    res.json({ success: true, fundRequest: (await fundRef.get()).data() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/admin/fund-requests/:id', requireAdmin, async (req, res) => {
  if (!ensureDatabase(res)) {
    return;
  }

  const requestId = req.params.id;

  try {
    const fundRef = db.collection('fundRequests').doc(requestId);
    const fundDoc = await fundRef.get();

    if (!fundDoc.exists) {
      return res.status(404).json({ error: 'Fund request not found' });
    }

    await fundRef.delete();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete fund request' });
  }
});

app.post('/api/settings', requireAdmin, async (req, res) => {
  if (!ensureDatabase(res)) {
    return;
  }

  const { settings, packages } = req.body || {};
  const updateData = {};

  if (settings) {
    updateData.settings = settings;
  }

  if (packages) {
    updateData.packages = packages;
  }

  try {
    await saveGlobalData(updateData);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'social_media_marketplace.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
