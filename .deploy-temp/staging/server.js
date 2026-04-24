const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

const ADMIN_USERNAME = 'darknet';
const ADMIN_PASSWORD = 'insider';
const ADMIN_COOKIE_NAME = 'booststore_admin_session';
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Security: Prevent serving sensitive files directly
app.use((req, res, next) => {
  const blockedPaths = ['data.json', 'server.js', 'package.json', 'package-lock.json'];

  if (blockedPaths.some(fileName => req.path.includes(fileName))) {
    return res.status(403).send('Forbidden');
  }

  next();
});

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

function createAdminSessionValue() {
  const payload = Buffer.from(
    JSON.stringify({
      user: ADMIN_USERNAME,
      exp: Date.now() + ADMIN_SESSION_TTL_MS
    })
  ).toString('base64url');

  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');

  return `${payload}.${signature}`;
}

function setAdminCookie(res, value, maxAgeMs = ADMIN_SESSION_TTL_MS) {
  const cookieParts = [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`
  ];

  res.append('Set-Cookie', cookieParts.join('; '));
}

function clearAdminCookie(res) {
  setAdminCookie(res, '', 0);
}

function isAdminAuthenticated(req) {
  try {
    const cookies = parseCookies(req);
    const token = cookies[ADMIN_COOKIE_NAME];

    if (!token) {
      return false;
    }

    const [payload, signature] = token.split('.');

    if (!payload || !signature) {
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(payload)
      .digest('base64url');

    const providedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (providedBuffer.length !== expectedBuffer.length) {
      return false;
    }

    if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
      return false;
    }

    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

    if (session.user !== ADMIN_USERNAME || !session.exp || session.exp < Date.now()) {
      return false;
    }

    return true;
  } catch (error) {
    return false;
  }
}

function requireAdmin(req, res, next) {
  if (!isAdminAuthenticated(req)) {
    clearAdminCookie(res);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

app.use(express.static(__dirname));

// Helper to read data
function readData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { settings: {}, packages: {}, orders: [] };
  }

  const raw = fs.readFileSync(DATA_FILE, 'utf-8');

  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error('Error parsing data.json', error);
    return { settings: {}, packages: {}, orders: [] };
  }
}

// Helper to write data
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// =======================
// PUBLIC API ENDPOINTS
// =======================

// Public config + history feed used by the storefront
app.get('/api/data', (req, res) => {
  const data = readData();
  res.json(data);
});

// Submit a new order from the storefront
app.post('/api/orders', (req, res) => {
  const newOrder = req.body;

  if (!newOrder.id) {
    return res.status(400).json({ error: 'Invalid order data' });
  }

  const data = readData();
  data.orders.push(newOrder);
  writeData(data);

  res.status(201).json({ success: true, order: newOrder });
});

// =======================
// ADMIN AUTH ENDPOINTS
// =======================

app.get('/api/admin/session', (req, res) => {
  res.json({ authenticated: isAdminAuthenticated(req) });
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    clearAdminCookie(res);
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  setAdminCookie(res, createAdminSessionValue());
  res.json({ success: true });
});

app.post('/api/admin/logout', (req, res) => {
  clearAdminCookie(res);
  res.json({ success: true });
});

// =======================
// ADMIN API ENDPOINTS
// =======================

app.get('/api/admin/data', requireAdmin, (req, res) => {
  const data = readData();
  res.json(data);
});

app.put('/api/orders/:id', requireAdmin, (req, res) => {
  const orderId = req.params.id;
  const { status } = req.body;

  const data = readData();
  const orderIndex = data.orders.findIndex(order => order.id === orderId);

  if (orderIndex === -1) {
    return res.status(404).json({ error: 'Order not found' });
  }

  data.orders[orderIndex].status = status;
  writeData(data);

  res.json({ success: true, order: data.orders[orderIndex] });
});

app.delete('/api/orders/:id', requireAdmin, (req, res) => {
  const orderId = req.params.id;

  const data = readData();
  const initialLength = data.orders.length;
  data.orders = data.orders.filter(order => order.id !== orderId);

  if (data.orders.length === initialLength) {
    return res.status(404).json({ error: 'Order not found' });
  }

  writeData(data);
  res.json({ success: true });
});

app.post('/api/settings', requireAdmin, (req, res) => {
  const { settings, packages } = req.body;

  const data = readData();

  if (settings) {
    data.settings = settings;
  }

  if (packages) {
    data.packages = packages;
  }

  writeData(data);
  res.json({ success: true });
});

// Fallback to storefront
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'social_media_marketplace.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
