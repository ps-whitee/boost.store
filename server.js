const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// Middleware
app.use(cors());
app.use(express.json());

// Security: Prevent serving sensitive files
app.use((req, res, next) => {
  if (req.path.includes('data.json') || req.path.includes('server.js') || req.path.includes('package.json')) {
    return res.status(403).send('Forbidden');
  }
  next();
});

app.use(express.static(__dirname));

// Helper to read data
function readData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { settings: {}, packages: {}, orders: [] };
  }
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("Error parsing data.json", e);
    return { settings: {}, packages: {}, orders: [] };
  }
}

// Helper to write data
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// =======================
// API ENDPOINTS
// =======================

// 1. Get all data (for Admin and initial load)
app.get('/api/data', (req, res) => {
  const data = readData();
  res.json(data);
});

// 2. Submit a new order (from Client)
app.post('/api/orders', (req, res) => {
  const newOrder = req.body;
  if (!newOrder.id) {
    return res.status(400).json({ error: "Invalid order data" });
  }
  
  const data = readData();
  data.orders.push(newOrder);
  writeData(data);
  
  res.status(201).json({ success: true, order: newOrder });
});

// 3. Update order status (from Admin)
app.put('/api/orders/:id', (req, res) => {
  const orderId = req.params.id;
  const { status } = req.body;
  
  const data = readData();
  const orderIndex = data.orders.findIndex(o => o.id === orderId);
  
  if (orderIndex === -1) {
    return res.status(404).json({ error: "Order not found" });
  }
  
  data.orders[orderIndex].status = status;
  writeData(data);
  
  res.json({ success: true, order: data.orders[orderIndex] });
});

// 4. Delete an order (from Admin)
app.delete('/api/orders/:id', (req, res) => {
  const orderId = req.params.id;
  
  const data = readData();
  const initialLength = data.orders.length;
  data.orders = data.orders.filter(o => o.id !== orderId);
  
  if (data.orders.length === initialLength) {
    return res.status(404).json({ error: "Order not found" });
  }
  
  writeData(data);
  res.json({ success: true });
});

// 5. Save settings/packages (from Admin)
app.post('/api/settings', (req, res) => {
  const { settings, packages } = req.body;
  
  const data = readData();
  if (settings) data.settings = settings;
  if (packages) data.packages = packages;
  
  writeData(data);
  res.json({ success: true });
});

// Fallback to social_media_marketplace.html
app.get('/(.*)', (req, res) => {
  res.sendFile(path.join(__dirname, 'social_media_marketplace.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
