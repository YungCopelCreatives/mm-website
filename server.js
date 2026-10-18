import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

// Production Security & Performance Headers (TEO & SEO Standards)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Allow caching for static files while keeping API responses fresh
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  } else if (req.path.match(/\.(jpg|jpeg|png|webp|svg|ico)$/)) {
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  }
  next();
});

app.use(express.json());

// Explicit SEO & PWA Routes with strict MIME types
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'robots.txt'));
});

app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  res.sendFile(path.join(__dirname, 'sitemap.xml'));
});

app.get('/manifest.json', (req, res) => {
  res.type('application/manifest+json');
  res.sendFile(path.join(__dirname, 'manifest.json'));
});

app.get('/sw.js', (req, res) => {
  res.type('application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'sw.js'));
});

app.get('/app.js', (req, res) => {
  res.type('application/javascript');
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'app.js'));
});

app.get('/styles.css', (req, res) => {
  res.type('text/css');
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'styles.css'));
});

app.use(express.static(__dirname));

// Persistent DB file
const DB_FILE = path.join(__dirname, 'data_store.json');

// Initialize store with clean empty data structure
function getInitialData() {
  return {
    users: [],
    orders: [],
    driverApplications: [],
    laundromatPartners: [
      {
        id: "lnd_cpt_1",
        businessName: "Kloof Street Laundromat & Garment Care",
        address: "48 Kloof Street, Gardens",
        city: "Cape Town",
        suburb: "Gardens & City Bowl",
        status: "Active",
        rating: 4.9,
        turnaround: "24 Hours Standard",
        specialties: "Everyday Wash & Fold, Sneakers Care, Infant Sensitive",
        pricingPolicy: "Rates determined by laundromat based on basket size and individual pricing for sneakers, blankets & carpets",
        services: ["wash_fold", "iron_press", "sneakers", "blankets", "baby_clothes"]
      },
      {
        id: "lnd_cpt_2",
        businessName: "Atlantic Seaboard Laundry Hub",
        address: "112 Regent Road, Sea Point",
        city: "Cape Town",
        suburb: "Sea Point, Camps Bay & Green Point",
        status: "Active",
        rating: 4.8,
        turnaround: "Same-Day & 24h",
        specialties: "Airbnb Linens, Blankets & Duvets, Carpets & Rugs",
        pricingPolicy: "Rates determined by laundromat based on basket size and individual pricing for sneakers, blankets & carpets",
        services: ["wash_fold", "blankets", "carpets", "sneakers", "dry_clean"]
      },
      {
        id: "lnd_jhb_1",
        businessName: "Rosebank Master Laundromat & Dry Cleaners",
        address: "15 Tyrwhitt Avenue, Rosebank",
        city: "Johannesburg",
        suburb: "Rosebank, Parkhurst & Houghton",
        status: "Active",
        rating: 4.9,
        turnaround: "24 Hours Standard",
        specialties: "Suits & Dry Cleaning, Sneakers Deep Clean, Wash & Fold",
        pricingPolicy: "Rates determined by laundromat based on basket size and individual pricing for sneakers, blankets & carpets",
        services: ["wash_fold", "dry_clean", "sneakers", "iron_press", "blankets"]
      },
      {
        id: "lnd_jhb_2",
        businessName: "Sandton Elite Laundry & Commercial Wash",
        address: "Sandton Drive & Rivonia Road, Sandhurst",
        city: "Johannesburg",
        suburb: "Sandton, Morningside & Bryanston",
        status: "Active",
        rating: 4.9,
        turnaround: "12h Express & 24h Standard",
        specialties: "Executive Shirts, Blankets & Duvets, Carpets & Area Rugs",
        pricingPolicy: "Rates determined by laundromat based on basket size and individual pricing for sneakers, blankets & carpets",
        services: ["wash_fold", "iron_press", "blankets", "carpets", "express"]
      },
      {
        id: "lnd_dbn_1",
        businessName: "Umhlanga Ridge Laundromat",
        address: "Palm Boulevard, Gateway Precinct, Umhlanga",
        city: "Durban / eThekwini",
        suburb: "Umhlanga, Durban North & La Lucia",
        status: "Active",
        rating: 4.8,
        turnaround: "24 Hours Standard",
        specialties: "Holiday Linens, Blankets, Sneakers, Wash & Fold",
        pricingPolicy: "Rates determined by laundromat based on basket size and individual pricing for sneakers, blankets & carpets",
        services: ["wash_fold", "blankets", "sneakers", "carpets", "iron_press"]
      },
      {
        id: "lnd_pta_1",
        businessName: "Pretoria East Gentle Laundry & Press",
        address: "Atterbury Road, Menlyn",
        city: "Pretoria / Tshwane",
        suburb: "Menlyn, Brooklyn & Faerie Glen",
        status: "Active",
        rating: 4.9,
        turnaround: "24 Hours Standard",
        specialties: "Steam Press, Hypoallergenic Wash, Blankets & Duvets",
        pricingPolicy: "Rates determined by laundromat based on basket size and individual pricing for sneakers, blankets & carpets",
        services: ["wash_fold", "iron_press", "blankets", "sneakers", "baby_clothes"]
      }
    ],
    businessInquiries: [],
    supportTickets: []
  };
}

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error reading DB, using initial data:', err);
  }
  const initial = getInitialData();
  saveDB(initial);
  return initial;
}

function saveDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing DB:', err);
  }
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// In-memory active tokens/sessions
const sessions = new Map();

// Helper to get user from Auth header
function getAuthenticatedUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' ')[1];
  const userId = sessions.get(token);
  if (!userId) return null;
  const db = loadDB();
  return db.users.find(u => u.id === userId) || null;
}

/* =========================================================================
   AUTH ROUTES
   ========================================================================= */

app.post('/api/auth/signup', (req, res) => {
  const { name, email, password, phone, role, address } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  const db = loadDB();
  const existing = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const newUser = {
    id: 'usr_' + Date.now(),
    name: name.trim(),
    email: email.toLowerCase().trim(),
    password: password, // In production, bcrypt hash
    phone: phone ? phone.trim() : '',
    role: role || 'customer',
    address: address ? address.trim() : '',
    savedAddresses: address ? [{ label: 'Primary', address: address.trim() }] : [],
    preferences: {
      detergent: 'Hypoallergenic (Eco)',
      temperature: 'Cold wash',
      foldStyle: 'Standard fold'
    },
    createdAt: new Date().toISOString()
  };

  db.users.push(newUser);
  saveDB(db);

  const token = 'tok_' + Math.random().toString(36).substring(2) + Date.now();
  sessions.set(token, newUser.id);

  const { password: _, ...safeUser } = newUser;
  res.json({ user: safeUser, token });
});

// Alias register to signup
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, phone, role, address } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  const db = loadDB();
  const existing = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const newUser = {
    id: 'usr_' + Date.now(),
    name: name.trim(),
    email: email.toLowerCase().trim(),
    password: password,
    phone: phone ? phone.trim() : '',
    role: role || 'customer',
    address: address ? address.trim() : '',
    savedAddresses: address ? [{ label: 'Primary', address: address.trim() }] : [],
    preferences: {
      detergent: 'Hypoallergenic (Eco)',
      temperature: 'Cold wash',
      foldStyle: 'Standard fold'
    },
    createdAt: new Date().toISOString()
  };

  db.users.push(newUser);
  saveDB(db);

  const token = 'tok_' + Math.random().toString(36).substring(2) + Date.now();
  sessions.set(token, newUser.id);

  const { password: _, ...safeUser } = newUser;
  res.json({ user: safeUser, token });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const db = loadDB();
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = 'tok_' + Math.random().toString(36).substring(2) + Date.now();
  sessions.set(token, user.id);

  const { password: _, ...safeUser } = user;
  res.json({ user: safeUser, token });
});

app.get('/api/auth/me', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized or session expired' });
  }
  const { password: _, ...safeUser } = user;
  res.json({ user: safeUser });
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    sessions.delete(token);
  }
  res.json({ success: true });
});

app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email address is required' });
  }
  const db = loadDB();
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  // Even if user not found, return friendly message for security
  res.json({
    success: true,
    message: `If an account exists for ${email}, a password reset verification link has been dispatched.`
  });
});

/* =========================================================================
   USER PROFILE & ADDRESS MANAGEMENT (PARITY)
   ========================================================================= */

app.get('/api/user/profile', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { password: _, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
});

app.put('/api/user/profile', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { name, phone, address, preferences, defaultPayment } = req.body;
  const db = loadDB();
  const targetUser = db.users.find(u => u.id === user.id);
  if (!targetUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (name) targetUser.name = name.trim();
  if (phone !== undefined) targetUser.phone = phone.trim();
  if (address) {
    targetUser.address = address.trim();
    if (!targetUser.savedAddresses) targetUser.savedAddresses = [];
    if (!targetUser.savedAddresses.some(sa => sa.address === address.trim())) {
      targetUser.savedAddresses.push({ label: 'Primary', address: address.trim() });
    }
  }
  if (preferences) {
    targetUser.preferences = { ...targetUser.preferences, ...preferences };
  }
  if (defaultPayment) {
    targetUser.defaultPayment = defaultPayment;
  }

  saveDB(db);
  const { password: _, ...safeUser } = targetUser;
  res.json({ success: true, user: safeUser, message: 'Profile & preferences updated successfully.' });
});

app.post('/api/user/addresses', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { label, address } = req.body;
  if (!address || !address.trim()) {
    return res.status(400).json({ error: 'Address is required' });
  }

  const db = loadDB();
  const targetUser = db.users.find(u => u.id === user.id);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  if (!Array.isArray(targetUser.savedAddresses)) {
    targetUser.savedAddresses = [];
  }

  const newAddr = {
    id: 'addr_' + Date.now(),
    label: (label || 'Home').trim(),
    address: address.trim()
  };

  targetUser.savedAddresses.push(newAddr);
  if (!targetUser.address) {
    targetUser.address = newAddr.address;
  }

  saveDB(db);
  res.json({ success: true, savedAddresses: targetUser.savedAddresses, message: 'New address saved to your account.' });
});

app.delete('/api/user/addresses/:id', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = loadDB();
  const targetUser = db.users.find(u => u.id === user.id);
  if (!targetUser || !Array.isArray(targetUser.savedAddresses)) {
    return res.status(404).json({ error: 'Address not found' });
  }

  targetUser.savedAddresses = targetUser.savedAddresses.filter(sa => sa.id !== req.params.id && sa.address !== req.params.id);
  saveDB(db);
  res.json({ success: true, savedAddresses: targetUser.savedAddresses, message: 'Address removed.' });
});

/* =========================================================================
   LIVE CUSTOMER SUPPORT CHAT & HELP DESK (PARITY)
   ========================================================================= */

app.post('/api/support/message', (req, res) => {
  const { message, orderId, email, name } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }

  const db = loadDB();
  if (!Array.isArray(db.supportTickets)) {
    db.supportTickets = [];
  }

  const ticket = {
    id: 'tkt_' + Date.now(),
    customerName: name || 'Valued Customer',
    customerEmail: email || 'guest@client.co.za',
    orderId: orderId || null,
    message: message.trim(),
    createdAt: new Date().toISOString()
  };
  db.supportTickets.push(ticket);
  saveDB(db);

  // Contextual smart response algorithm
  const lowerMsg = message.toLowerCase();
  let reply = "Thanks for reaching out! Our dedicated M&M South Africa operations team is on duty. How can we assist you with your pickup or wash today?";

  if (lowerMsg.includes('track') || lowerMsg.includes('where is') || lowerMsg.includes('status')) {
    if (orderId) {
      const order = db.orders.find(o => o.id === orderId);
      if (order) {
        reply = `Order #${order.id} is currently in the **${order.status.toUpperCase()}** stage. Driver ${order.driver ? order.driver.name : 'assigned'} is managing your route. Handover PIN: **${order.deliveryPin || '4921'}**.`;
      } else {
        reply = `I couldn't locate order #${orderId}. Please check the ID in 'My Orders' or view your active wash tracker!`;
      }
    } else {
      reply = "To track an active order, click 'Track wash' in the menu or tap the Live Tracker to see real-time washer cycle telemetry and driver ETA.";
    }
  } else if (lowerMsg.includes('weight') || lowerMsg.includes('kg') || lowerMsg.includes('scale') || lowerMsg.includes('basket') || lowerMsg.includes('sneaker') || lowerMsg.includes('blanket') || lowerMsg.includes('carpet')) {
    reply = "Partner laundromats price everyday laundry by basket size (Small, Medium, or Large Basket) and provide individual item pricing for specialty items like sneakers, blankets, and carpets. You select your preferred local partner laundromat when scheduling your pickup!";
  } else if (lowerMsg.includes('detergent') || lowerMsg.includes('sensitive') || lowerMsg.includes('baby')) {
    reply = "We offer 100% plant-based, fragrance-free hypoallergenic detergent, standard fresh breeze detergent, and optional eco fabric softener. You can customize this in your order preferences.";
  } else if (lowerMsg.includes('cancel') || lowerMsg.includes('change time') || lowerMsg.includes('reschedule')) {
    reply = "Pickups can be rescheduled or cancelled free of charge up to 2 hours before the scheduled window. You can also contact dispatch at +27 21 555 4321.";
  } else if (lowerMsg.includes('pin') || lowerMsg.includes('handover') || lowerMsg.includes('security')) {
    reply = "For your security, every order generates a unique 4-digit Handover PIN. Share this PIN with the courier when handing over bags or receiving your clean clothes.";
  } else if (lowerMsg.includes('price') || lowerMsg.includes('cost') || lowerMsg.includes('how much') || lowerMsg.includes('rate')) {
    reply = "Only partner laundromats set their prices. Pricing is based on your selected basket size (Small, Medium, Family) and individual item rates for sneakers, blankets, carpets, and dry cleaning. Select a partner laundromat when scheduling pickup to see their tariffs!";
  }

  res.json({
    success: true,
    ticketId: ticket.id,
    reply,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });
});

/* =========================================================================
   ORDERS ROUTES
   ========================================================================= */

app.get('/api/orders', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Please sign in or create an account to view orders' });
  }
  const db = loadDB();
  const userOrders = db.orders.filter(o => o.userId === user.id);
  res.json({ orders: userOrders });
});

app.get('/api/orders/:id', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Please sign in or create an account to track orders' });
  }
  const db = loadDB();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  if (user.role !== 'admin' && order.userId && order.userId !== user.id) {
    return res.status(403).json({ error: 'Access denied to this order' });
  }
  res.json({ order });
});

app.post('/api/orders', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({
      error: 'Authentication required. Please log in or create an account before completing payment and placing your order.'
    });
  }

  const {
    customerName,
    phone,
    pickupAddress,
    serviceType,
    laundromatId,
    laundromatName,
    basketSize,
    bagCount,
    estimatedWeight,
    detergent,
    specialInstructions,
    pickupTime,
    items,
    total,
    paymentMethod,
    discount
  } = req.body;

  const targetAddress = pickupAddress || req.body.address;
  const targetService = serviceType || req.body.service;

  if (!targetAddress || !targetService) {
    return res.status(400).json({ error: 'Pickup Address and Service Type are required.' });
  }

  if (!laundromatId && !laundromatName) {
    return res.status(400).json({ error: 'Please select a partner laundromat to process your pickup or delivery.' });
  }

  const db = loadDB();
  const orderId = 'MM-' + Math.floor(1000 + Math.random() * 9000);

  // Look up laundromat details
  let selectedLaundromat = null;
  if (Array.isArray(db.laundromatPartners)) {
    selectedLaundromat = db.laundromatPartners.find(l => l.id === laundromatId || l.businessName === laundromatName);
  }
  const verifiedLaundromatName = selectedLaundromat ? selectedLaundromat.businessName : (laundromatName || 'Selected Laundromat Partner');
  const verifiedLaundromatAddress = selectedLaundromat ? selectedLaundromat.address : '';

  const calculatedItems = items && items.length > 0 ? items : [
    { name: serviceType, price: parseFloat(total) || 360.00 }
  ];
  const calculatedTotal = parseFloat(total) || 360.00;
  // 15% South African Value-Added Tax (VAT)
  const calculatedSubtotal = +(calculatedTotal / 1.15).toFixed(2);
  const calculatedTax = +(calculatedTotal - calculatedSubtotal).toFixed(2);

  // Secure 4-digit handover delivery PIN (excludes easily guessed PINs)
  let deliveryPin = '';
  while (true) {
    const pinNum = Math.floor(1000 + Math.random() * 9000);
    deliveryPin = pinNum.toString();
    if (deliveryPin !== '1234' && deliveryPin !== '0000') break;
  }

  const newOrder = {
    id: orderId,
    userId: user.id,
    customerName: customerName || user.name || 'Customer',
    phone: phone || user.phone || '',
    pickupAddress: pickupAddress,
    serviceType: serviceType,
    laundromatId: laundromatId || (selectedLaundromat ? selectedLaundromat.id : null),
    laundromatName: verifiedLaundromatName,
    laundromatAddress: verifiedLaundromatAddress,
    basketSize: basketSize || 'Medium Basket',
    bagCount: bagCount || 1,
    estimatedWeight: estimatedWeight || 'Basket size / item count',
    pricingModel: 'Laundromat Tariff · Basket Size & Individual Item Rates',
    detergent: detergent || 'Hypoallergenic (Eco)',
    specialInstructions: specialInstructions || 'Standard handling',
    deliveryPin: deliveryPin,
    protectionPlan: req.body.protectionPlan || false,
    status: 'placed',
    statusStep: 1,
    totalSteps: 7,
    pickupTime: pickupTime || 'Scheduled pickup window',
    estimatedDelivery: '24 hours from pickup',
    driver: null,
    items: calculatedItems,
    subtotal: calculatedSubtotal,
    tax: calculatedTax,
    discount: parseFloat(discount) || 0,
    total: calculatedTotal,
    paymentMethod: paymentMethod || 'Instant EFT / Capitec Pay',
    paymentStatus: 'paid',
    createdAt: new Date().toISOString(),
    history: [
      { status: 'Order Confirmed', time: 'Just now', description: `Order ${orderId} placed and confirmed. Payment processed via ${paymentMethod || 'Instant EFT'}. Handover delivery PIN is ${deliveryPin}.` }
    ]
  };

  // Update user's default address if not present
  const userIndex = db.users.findIndex(u => u.id === user.id);
  if (userIndex !== -1) {
    if (!db.users[userIndex].address) {
      db.users[userIndex].address = pickupAddress;
    }
    if (!db.users[userIndex].savedAddresses) {
      db.users[userIndex].savedAddresses = [];
    }
    const alreadySaved = db.users[userIndex].savedAddresses.some(a => a.address.toLowerCase() === pickupAddress.toLowerCase());
    if (!alreadySaved) {
      db.users[userIndex].savedAddresses.push({
        label: db.users[userIndex].savedAddresses.length === 0 ? 'Home' : `Address ${db.users[userIndex].savedAddresses.length + 1}`,
        address: pickupAddress
      });
    }
  }

  db.orders.unshift(newOrder);
  saveDB(db);

  res.status(201).json({ success: true, order: newOrder });
});

// Real-time server price calculation endpoint
app.post('/api/pricing/calculate', (req, res) => {
  const { serviceType = 'wash_fold', sizeValue = 'medium', promoCode = '' } = req.body;
  let subtotal = 360.00;
  let weightText = 'Up to 10kg (~22 lbs)';
  let bagCount = 2;

  if (serviceType === 'wash_fold') {
    if (sizeValue === 'small') { subtotal = 185.00; weightText = 'Up to 5kg (~11 lbs)'; bagCount = 1; }
    else if (sizeValue === 'medium') { subtotal = 360.00; weightText = 'Up to 10kg (~22 lbs)'; bagCount = 2; }
    else { subtotal = 680.00; weightText = 'Up to 20kg (~44 lbs)'; bagCount = 3; }
  } else if (serviceType === 'dry_clean') {
    const items = sizeValue === 'small' ? 4 : (sizeValue === 'medium' ? 8 : 16);
    subtotal = items * 85.00;
    weightText = `${items} tailored garments`;
    bagCount = sizeValue === 'small' ? 1 : 2;
  } else if (serviceType === 'iron_press') {
    if (sizeValue === 'small') { subtotal = 240.00; weightText = 'Up to 5kg (~11 lbs) iron pressed'; bagCount = 1; }
    else if (sizeValue === 'medium') { subtotal = 460.00; weightText = 'Up to 10kg (~22 lbs) iron pressed'; bagCount = 2; }
    else { subtotal = 880.00; weightText = 'Up to 20kg (~44 lbs) iron pressed'; bagCount = 3; }
  } else if (serviceType === 'bedding') {
    if (sizeValue === 'small') { subtotal = 165.00; weightText = '1 duvet & bedding bundle (Single/3-Quarter)'; bagCount = 1; }
    else if (sizeValue === 'medium') { subtotal = 320.00; weightText = '2 duvet & linen bundles (Double/Queen)'; bagCount = 2; }
    else { subtotal = 475.00; weightText = '3 duvet & sheet bundles (King/Feather)'; bagCount = 3; }
  }

  const deliveryFee = subtotal >= 350 ? 0.00 : 45.00;
  
  let discount = 0;
  const upperCode = (promoCode || '').trim().toUpperCase();
  if (upperCode === 'FIRSTWASH' || upperCode === 'WELCOME50' || upperCode === 'MM50') {
    discount = 50.00;
  }

  const total = Math.max(0, subtotal + deliveryFee - discount);
  const vat = +(total - (total / 1.15)).toFixed(2);
  const beforeVat = +(total / 1.15).toFixed(2);

  res.json({
    subtotal,
    deliveryFee,
    discount,
    vat,
    beforeVat,
    total,
    weightText,
    bagCount,
    currency: 'ZAR',
    symbol: 'R'
  });
});

// Advance order status for live tracking simulation
app.post('/api/orders/:id/advance', (req, res) => {
  const db = loadDB();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const steps = [
    { key: 'placed', label: 'Order Confirmed', desc: 'Order placed and logged in system.' },
    { key: 'assigned', label: 'Driver Dispatched', desc: 'Local courier dispatched to your address.' },
    { key: 'picked_up', label: 'Picked Up & Verified', desc: 'Bags collected and verified by partner laundromat.' },
    { key: 'washing', label: 'In The Wash & Treatment', desc: 'Washing, sanitizing, and gentle cycle active.' },
    { key: 'inspection', label: 'Quality Check & Folding', desc: 'Hand-inspected, steam-pressed, and crisp folding.' },
    { key: 'out_for_delivery', label: 'Out for Return Delivery', desc: 'Courier en route back to your doorstep.' },
    { key: 'delivered', label: 'Delivered to Door', desc: 'Clean, fresh laundry delivered to doorstep.' }
  ];

  let currentIdx = steps.findIndex(s => s.key === order.status);
  if (currentIdx < steps.length - 1) {
    currentIdx++;
  } else {
    currentIdx = 0; // loop around for testing
  }

  const nextStep = steps[currentIdx];
  order.status = nextStep.key;
  order.statusStep = currentIdx + 1;

  if (!order.driver && currentIdx >= 1) {
    order.driver = {
      name: 'Thabo Mokoena',
      phone: '+27 (0)83 712 9043',
      vehicle: 'VW Polo Vivo (Silver) - CA 482-910',
      rating: 4.96
    };
  }

  const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  order.history.push({
    status: nextStep.label,
    time: nowTime,
    description: nextStep.desc
  });

  saveDB(db);
  res.json({ success: true, order });
});

// Cancel order
app.post('/api/orders/:id/cancel', (req, res) => {
  const db = loadDB();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  order.status = 'cancelled';
  order.history.push({
    status: 'Cancelled',
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    description: 'Order cancelled by customer.'
  });
  saveDB(db);
  res.json({ success: true, order });
});

/* =========================================================================
   PARTNERS & BUSINESS APPLICATION ROUTES
   ========================================================================= */

app.post('/api/partners/driver', (req, res) => {
  const { name, email, phone, city, vehicleType, experience } = req.body;
  if (!name || !email || !phone) {
    return res.status(400).json({ error: 'Name, email, and phone are required' });
  }
  const db = loadDB();
  const appItem = {
    id: 'drv_app_' + Date.now(),
    name,
    email,
    phone,
    city: city || 'Springfield',
    vehicleType: vehicleType || 'Standard Car',
    experience: experience || '1-3 years courier',
    status: 'Under Review',
    submittedAt: new Date().toISOString()
  };
  db.driverApplications.push(appItem);
  saveDB(db);
  res.json({ success: true, message: 'Driver application received! Our onboarding team will contact you within 24 hours.', application: appItem });
});

// Live Laundromats list endpoint (filtered by city/suburb if specified)
app.get('/api/laundromats', (req, res) => {
  const db = loadDB();
  const city = (req.query.city || '').toLowerCase().trim();
  const suburb = (req.query.suburb || '').toLowerCase().trim();
  let list = Array.isArray(db.laundromatPartners) ? db.laundromatPartners : [];

  if (city || suburb) {
    const q = city || suburb;
    list = list.filter(l => 
      (l.city && l.city.toLowerCase().includes(q)) || 
      (l.suburb && l.suburb.toLowerCase().includes(q)) ||
      (l.address && l.address.toLowerCase().includes(q)) ||
      (l.businessName && l.businessName.toLowerCase().includes(q))
    );
  }

  res.json({
    success: true,
    laundromats: list,
    total: list.length
  });
});

app.post('/api/partners/laundromat', (req, res) => {
  const { businessName, address, contactName, email, phone, machineCount, capacity } = req.body;
  if (!businessName || !email || !phone) {
    return res.status(400).json({ error: 'Business name, email, and phone are required' });
  }
  const db = loadDB();
  const appItem = {
    id: 'lnd_app_' + Date.now(),
    businessName,
    address,
    contactName,
    email,
    phone,
    machineCount: machineCount || '15-30 washers',
    capacity: capacity || '500+ lbs/day',
    status: 'In Review',
    submittedAt: new Date().toISOString()
  };
  db.laundromatPartners.push(appItem);
  saveDB(db);
  res.json({ success: true, message: 'Laundromat partnership request received! A local operations director will schedule an on-site visit.', application: appItem });
});

app.post('/api/business/inquiry', (req, res) => {
  const { companyName, contactName, email, phone, industry, estimatedVolume, notes } = req.body;
  if (!companyName || !email) {
    return res.status(400).json({ error: 'Company name and email are required' });
  }
  const db = loadDB();
  const inquiry = {
    id: 'biz_' + Date.now(),
    companyName,
    contactName,
    email,
    phone,
    industry: industry || 'Hospitality / Fitness / Corporate',
    estimatedVolume: estimatedVolume || '50-200 lbs/week',
    notes,
    status: 'Quote Prepared',
    submittedAt: new Date().toISOString()
  };
  db.businessInquiries.push(inquiry);
  saveDB(db);
  res.json({ success: true, message: 'Commercial account inquiry received! Your dedicated account manager will provide custom bulk rates today.', inquiry });
});

/* =========================================================================
   REAL-TIME DATABASE-DRIVEN LOCATIONS & FACTUAL OPERATIONAL STATS
   ========================================================================= */

// Real-time algorithm extracting genuine locations from existing database records
app.get('/api/locations/popular', (req, res) => {
  const user = getAuthenticatedUser(req);
  const db = loadDB();

  const frequencyMap = {};

  // 1. Extract and aggregate pickup locations from real database orders
  if (Array.isArray(db.orders)) {
    db.orders.forEach(order => {
      if (order.pickupAddress && order.pickupAddress.trim()) {
        const fullAddr = order.pickupAddress.trim();
        frequencyMap[fullAddr] = (frequencyMap[fullAddr] || 0) + 1;

        // Also index by suburb / area if comma separated
        const parts = fullAddr.split(',').map(p => p.trim()).filter(Boolean);
        if (parts.length > 1) {
          const area = parts.slice(1).join(', ');
          frequencyMap[area] = (frequencyMap[area] || 0) + 1;
        }
      }
    });
  }

  // 2. Extract locations from real registered users and their saved addresses
  if (Array.isArray(db.users)) {
    db.users.forEach(u => {
      if (u.address && u.address.trim()) {
        const fullAddr = u.address.trim();
        frequencyMap[fullAddr] = (frequencyMap[fullAddr] || 0) + 1;
      }
      if (Array.isArray(u.savedAddresses)) {
        u.savedAddresses.forEach(sa => {
          if (sa.address && sa.address.trim()) {
            frequencyMap[sa.address.trim()] = (frequencyMap[sa.address.trim()] || 0) + 1;
          }
        });
      }
    });
  }

  // 3. Extract locations from verified laundromat partners
  if (Array.isArray(db.laundromatPartners)) {
    db.laundromatPartners.forEach(p => {
      if (p.address && p.address.trim()) {
        frequencyMap[p.address.trim()] = (frequencyMap[p.address.trim()] || 0) + 1;
      }
      if (p.city && p.city.trim()) {
        frequencyMap[p.city.trim()] = (frequencyMap[p.city.trim()] || 0) + 1;
      }
    });
  }

  // Sort by actual database order/record frequency descending
  const sortedLocations = Object.entries(frequencyMap)
    .sort((a, b) => b[1] - a[1])
    .map(([location, count]) => ({
      location,
      orderCount: count,
      isUserSaved: false
    }));

  // If user is authenticated, prioritize their real saved addresses from the database
  let userAddresses = [];
  if (user) {
    if (Array.isArray(user.savedAddresses) && user.savedAddresses.length > 0) {
      userAddresses = user.savedAddresses.map(sa => ({
        location: sa.address,
        label: sa.label || 'Saved Address',
        orderCount: 1,
        isUserSaved: true
      }));
    } else if (user.address) {
      userAddresses = [{
        location: user.address,
        label: 'Saved Address',
        orderCount: 1,
        isUserSaved: true
      }];
    }
  }

  res.json({
    success: true,
    userAddresses,
    popularLocations: sortedLocations,
    totalRecordsInDb: db.orders.length + db.users.length
  });
});

// Factual operational statistics derived strictly from real database records
app.get('/api/stats/operational', (req, res) => {
  const db = loadDB();
  const totalOrders = Array.isArray(db.orders) ? db.orders.length : 0;
  const activeOrders = Array.isArray(db.orders) ? db.orders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled').length : 0;
  const registeredUsers = Array.isArray(db.users) ? db.users.length : 0;
  const partnerApplications = (db.driverApplications ? db.driverApplications.length : 0) + (db.laundromatPartners ? db.laundromatPartners.length : 0);

  res.json({
    success: true,
    totalOrders,
    activeOrders,
    registeredUsers,
    partnerApplications
  });
});

/* =========================================================================
   SPA FALLBACK
   ========================================================================= */

app.get('*', (req, res) => {
  // If request is an API endpoint, return clean 404 JSON
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  // If request has a file extension (.js, .css, .jpg, .png, .map, etc.), return 404 text instead of index.html
  if (req.path.match(/\.[a-zA-Z0-9]+$/)) {
    return res.status(404).type('text/plain').send('Resource not found');
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
