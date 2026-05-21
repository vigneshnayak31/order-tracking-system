// ============================================================
//  OBJECTIVE 3 — API Integration & Dashboard
//  Express server with all endpoints, Redis↔MongoDB migration
// ============================================================

require('dotenv').config();
const express   = require('express');
const mongoose  = require('mongoose');
const cors      = require('cors');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const path      = require('path');

const { User, Restaurant, Order } = require('./models');
const redis = require('./redis.service');

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// ── AUTH MIDDLEWARE ───────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ═══════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ═══════════════════════════════════════════════════════════════

// POST /auth/register
app.post('/auth/register', async (req, res) => {
  try {
    const { name, email, password, phone, address } = req.body;
    if (!name || !email || !password || !phone)
      return res.status(400).json({ error: 'All fields required' });

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ error: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 10);
    const user   = await User.create({
      name, email, password: hashed, phone,
      addresses: address ? [{ label: 'Home', line1: address, city: 'Bengaluru', pincode: '560001' }] : []
    });

    const token = jwt.sign({ id: user._id, name: user.name, email: user.email }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
    res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email, phone: user.phone } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /auth/login
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ id: user._id, name: user.name, email: user.email }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, phone: user.phone, addresses: user.addresses } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  RESTAURANT ROUTES
// ═══════════════════════════════════════════════════════════════

// GET /restaurants
app.get('/restaurants', async (req, res) => {
  try {
    const restaurants = await Restaurant.find({}, '-menu');
    // Attach Redis online status and merge into is_open
    const withStatus = await Promise.all(restaurants.map(async r => {
      const online = await redis.isRestaurantOnline(r._id.toString());
      const obj = r.toObject();
      // Restaurants are open 24x7 by default.
      const is_open = true;
      return { ...obj, is_open, redis_online: online };
    }));
    res.json(withStatus);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /restaurant/:id/menu  (Objective 3a)
app.get('/restaurant/:id/menu', async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    // Send heartbeat to Redis — marks restaurant as online for 300s
    await redis.setRestaurantOnline(req.params.id);
    // Also persist is_open=true in MongoDB so listing page reflects it immediately
    if (!restaurant.is_open) {
      await Restaurant.findByIdAndUpdate(req.params.id, { is_open: true });
      restaurant.is_open = true;
    }
    res.json(restaurant);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /restaurant/:id/heartbeat
app.post('/restaurant/:id/heartbeat', async (req, res) => {
  await redis.setRestaurantOnline(req.params.id);
  res.json({ ok: true, message: 'Heartbeat registered (TTL: 300s)' });
});

// ═══════════════════════════════════════════════════════════════
//  ORDER ROUTES  (Objective 3a)
// ═══════════════════════════════════════════════════════════════

// POST /order/place
app.post('/order/place', authMiddleware, async (req, res) => {
  try {
    const { restaurant_id, items, delivery_address } = req.body;
    if (!restaurant_id || !items || !items.length)
      return res.status(400).json({ error: 'restaurant_id and items are required' });

    // ── Rate limiting (Objective 2d) ─────────────────────────
    const rate = await redis.checkRateLimit(req.user.id);
    if (!rate.allowed) {
      return res.status(429).json({
        error: `Rate limit exceeded. Max ${5} orders/hour. Reset in ${rate.reset_in}s`,
        rate_limit: rate
      });
    }

    const restaurant = await Restaurant.findById(restaurant_id);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

    const total = items.reduce((s, i) => s + i.price * i.qty, 0) + restaurant.delivery_fee;

    let order;

    if (redis.isAvailable()) {
      // ── Save to MongoDB first ────────────────────────────────
      order = await Order.create({
        restaurant_id, user_id: req.user.id,
        restaurant_name: restaurant.name,
        customer_name:   req.user.name,
        items, total, delivery_fee: restaurant.delivery_fee,
        delivery_address: delivery_address || {},
        status: 'placed', eta: restaurant.avg_delivery_time,
        redis_key: `order:${null}`, // will update after creation
        timestamps: { placed: new Date() }
      });
      order.redis_key = `order:${order._id}`;
      await order.save();

      // ── Set order hash in Redis (Objective 2a) ───────────────
      await redis.setOrderHash(order._id.toString(), {
        status: 'placed', restaurant_id, restaurant_name: restaurant.name,
        user_id: req.user.id, customer_name: req.user.name,
        eta: restaurant.avg_delivery_time, total,
        placed_at: new Date().toISOString()
      });

      // ── Push to delivery queue (Objective 2b) ────────────────
      const queuePos = await redis.pushToDeliveryQueue(order._id.toString());

      // Update restaurant stats (Computed Pattern)
      await Restaurant.findByIdAndUpdate(restaurant_id, { $inc: { total_orders: 1 } });

      // ── Start auto-lifecycle (auto-advances through stages) ──
      startOrderLifecycle(order._id.toString());

      return res.status(201).json({
        order,
        redis: { key: `order:${order._id}`, queue_position: queuePos, rate_limit: rate },
        message: 'Order placed — tracked in Redis + saved to MongoDB'
      });

    } else {
      // ── FALLBACK: Direct MongoDB write if Redis unavailable (Objective 3d) ─
      order = await Order.create({
        restaurant_id, user_id: req.user.id,
        restaurant_name: restaurant.name, customer_name: req.user.name,
        items, total, delivery_fee: restaurant.delivery_fee,
        delivery_address: delivery_address || {},
        status: 'placed', eta: restaurant.avg_delivery_time,
        timestamps: { placed: new Date() }
      });
      await Restaurant.findByIdAndUpdate(restaurant_id, { $inc: { total_orders: 1 } });
      return res.status(201).json({ order, fallback: true, message: 'Redis unavailable — order saved directly to MongoDB' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /order/:id/status  — Redis first, fallback to MongoDB (Objective 3a)
app.get('/order/:id/status', authMiddleware, async (req, res) => {
  try {
    // 1. Try Redis first
    const redisData = await redis.getOrderHash(req.params.id);
    if (redisData) {
      return res.json({ source: 'redis', order_id: req.params.id, ...redisData });
    }
    // 2. Fallback to MongoDB
    const order = await Order.findById(req.params.id).populate('restaurant_id', 'name');
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({ source: 'mongodb', ...order.toObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /order/:id/status  (Objective 3a + migration on delivery)
app.patch('/order/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['placed', 'accepted', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status))
      return res.status(400).json({ error: 'Invalid status' });

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    order.status = status;
    order.timestamps[status] = new Date();

    if (status === 'delivered') {
      // ── Redis → MongoDB migration (Objective 3b) ────────────
      order.delivered_at   = new Date();
      const placedTime     = order.timestamps.placed || order.placed_at;
      order.delivery_time_mins = Math.round((Date.now() - new Date(placedTime).getTime()) / 60000);
      order.migrated_from_redis = true;

      await order.save();

      // Update restaurant computed fields ($inc)
      await Restaurant.findByIdAndUpdate(order.restaurant_id, {
        $inc: { total_revenue: order.total }
      });

      // Delete from Redis (migration complete)
      await redis.deleteOrderHash(req.params.id);

      return res.json({
        order: order.toObject(),
        migration: { from: 'redis', to: 'mongodb', completed: true },
        message: 'Order delivered — migrated from Redis to MongoDB, Redis key deleted'
      });
    }

    await order.save();

    // Update Redis hash
    await redis.updateOrderStatus(req.params.id, status);

    res.json({ order: order.toObject(), redis_updated: redis.isAvailable() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /orders/my — user's order history
app.get('/orders/my', authMiddleware, async (req, res) => {
  try {
    const orders = await Order.find({ user_id: req.user.id })
      .populate('restaurant_id', 'name image cuisine')
      .sort({ placed_at: -1 })
      .limit(50);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  DELIVERY AGENT ROUTES
// ═══════════════════════════════════════════════════════════════

// POST /delivery/pop — delivery agent picks next order
app.post('/delivery/pop', async (req, res) => {
  const orderId = await redis.popFromDeliveryQueue();
  if (!orderId) return res.json({ message: 'No orders in queue', orderId: null });
  const order = await Order.findById(orderId);
  await redis.updateOrderStatus(orderId, 'out_for_delivery');
  if (order) { order.status = 'out_for_delivery'; order.timestamps.out_for_delivery = new Date(); await order.save(); }
  res.json({ orderId, order, message: `LPOP delivery:queue → ${orderId}` });
});

// ═══════════════════════════════════════════════════════════════
//  DASHBOARD & ANALYTICS  (Objective 3c)
// ═══════════════════════════════════════════════════════════════

// GET /dashboard/analytics
app.get('/dashboard/analytics', async (req, res) => {
  try {
    // MongoDB aggregations (Objective 1d)

    // Total revenue per restaurant
    const revenuePerRestaurant = await Order.aggregate([
      { $match: { status: 'delivered' } },
      { $group: { _id: '$restaurant_id', total_revenue: { $sum: '$total' }, order_count: { $sum: 1 } } },
      { $lookup: { from: 'restaurants', localField: '_id', foreignField: '_id', as: 'restaurant' } },
      { $unwind: '$restaurant' },
      { $project: { restaurant_name: '$restaurant.name', total_revenue: 1, order_count: 1 } },
      { $sort: { total_revenue: -1 } }
    ]);

    // Most ordered item (across all restaurants)
    const mostOrderedItems = await Order.aggregate([
      { $unwind: '$items' },
      { $group: { _id: '$items.name', total_ordered: { $sum: '$items.qty' } } },
      { $sort: { total_ordered: -1 } },
      { $limit: 5 }
    ]);

    // Average delivery time per restaurant
    const avgDeliveryTime = await Order.aggregate([
      { $match: { status: 'delivered', delivery_time_mins: { $gt: 0 } } },
      { $group: { _id: '$restaurant_id', avg_delivery_time: { $avg: '$delivery_time_mins' }, count: { $sum: 1 } } },
      { $lookup: { from: 'restaurants', localField: '_id', foreignField: '_id', as: 'restaurant' } },
      { $unwind: '$restaurant' },
      { $project: { restaurant_name: '$restaurant.name', avg_delivery_time: { $round: ['$avg_delivery_time', 1] }, count: 1 } }
    ]);

    // Order status distribution
    const statusDistribution = await Order.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Daily orders (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const dailyOrders = await Order.aggregate([
      { $match: { placed_at: { $gte: sevenDaysAgo } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$placed_at' } }, orders: { $sum: 1 }, revenue: { $sum: '$total' } } },
      { $sort: { _id: 1 } }
    ]);

    // Redis live data
    const [activeOrders, queueLength, onlineRestaurants, queueContents] = await Promise.all([
      redis.getAllActiveOrders(),
      redis.getQueueLength(),
      redis.getOnlineRestaurantCount(),
      redis.getQueueContents()
    ]);

    // Summary stats
    const totalOrders = await Order.countDocuments();
    const totalRevenue = await Order.aggregate([{ $match: { status: 'delivered' } }, { $group: { _id: null, total: { $sum: '$total' } } }]);

    res.json({
      mongodb: {
        revenue_per_restaurant:   revenuePerRestaurant,
        most_ordered_items:       mostOrderedItems,
        avg_delivery_time:        avgDeliveryTime,
        status_distribution:      statusDistribution,
        daily_orders_last_7_days: dailyOrders,
        total_orders:             totalOrders,
        total_revenue:            totalRevenue[0]?.total || 0
      },
      redis: {
        available:           redis.isAvailable(),
        active_orders:       activeOrders,
        active_order_count:  activeOrders.length,
        delivery_queue:      queueContents,
        queue_length:        queueLength,
        online_restaurants:  onlineRestaurants
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /dashboard/redis — Redis status board
app.get('/dashboard/redis', async (req, res) => {
  try {
    const [activeOrders, queueLength, queueContents, onlineCount] = await Promise.all([
      redis.getAllActiveOrders(),
      redis.getQueueLength(),
      redis.getQueueContents(),
      redis.getOnlineRestaurantCount()
    ]);
    res.json({
      redis_available: redis.isAvailable(),
      active_orders: activeOrders,
      delivery_queue: queueContents,
      queue_length: queueLength,
      online_restaurants: onlineCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AUTO-ADVANCE LIFECYCLE ────────────────────────────────────────────────
// Stage durations (ms). Total ~20 min realistic; scaled to ~4 min for demo.
// placed → accepted: 30s, accepted → preparing: 60s,
// preparing → out_for_delivery: 90s, out_for_delivery → delivered: 60s
const STAGE_DURATIONS = {
  placed:           30  * 1000,   // 30 s  → accepted
  accepted:         60  * 1000,   // 60 s  → preparing
  preparing:        90  * 1000,   // 90 s  → out_for_delivery
  out_for_delivery: 60  * 1000,   // 60 s  → delivered
};
const NEXT_STATUS = {
  placed:           'accepted',
  accepted:         'preparing',
  preparing:        'out_for_delivery',
  out_for_delivery: 'delivered',
};

// In-memory map: orderId → timeoutHandle (survives server restarts within session)
const orderTimers = {};

async function advanceOrder(orderId) {
  try {
    const order = await Order.findById(orderId);
    if (!order || ['delivered', 'cancelled'].includes(order.status)) return;

    const next = NEXT_STATUS[order.status];
    if (!next) return;

    order.status = next;
    order.timestamps[next] = new Date();

    if (next === 'delivered') {
      const placedTime = order.timestamps.placed || order.placed_at;
      order.delivered_at = new Date();
      order.delivery_time_mins = Math.round((Date.now() - new Date(placedTime).getTime()) / 60000);
      order.migrated_from_redis = true;
      await order.save();
      await Restaurant.findByIdAndUpdate(order.restaurant_id, { $inc: { total_revenue: order.total } });
      await redis.deleteOrderHash(orderId);
      delete orderTimers[orderId];
      console.log(`[Auto] ✅ Order ${orderId} delivered — migrated Redis→MongoDB`);
    } else {
      await order.save();
      await redis.updateOrderStatus(orderId, next);
      // Schedule the next stage
      const delay = STAGE_DURATIONS[next];
      if (delay) {
        orderTimers[orderId] = setTimeout(() => advanceOrder(orderId), delay);
      }
      console.log(`[Auto] 🔄 Order ${orderId} → ${next}`);
    }
  } catch (err) {
    console.error(`[Auto] Error advancing order ${orderId}:`, err.message);
  }
}

// Start the auto-lifecycle for a newly placed order
function startOrderLifecycle(orderId) {
  // Clear any existing timer first
  if (orderTimers[orderId]) clearTimeout(orderTimers[orderId]);
  const delay = STAGE_DURATIONS['placed'];
  orderTimers[orderId] = setTimeout(() => advanceOrder(orderId), delay);
  console.log(`[Auto] ⏱ Lifecycle started for order ${orderId} (first advance in ${delay/1000}s)`);
}

// Resume timers for any active orders on server restart
async function resumeActiveOrders() {
  try {
    const active = await Order.find({ status: { $nin: ['delivered', 'cancelled'] } });
    for (const order of active) {
      const now = Date.now();
      const stageStart = order.timestamps[order.status] || order.placed_at || order.created_at;
      const elapsed = now - new Date(stageStart).getTime();
      const totalDelay = STAGE_DURATIONS[order.status] || 0;
      const remaining = Math.max(0, totalDelay - elapsed);
      if (NEXT_STATUS[order.status]) {
        orderTimers[order._id.toString()] = setTimeout(() => advanceOrder(order._id.toString()), remaining);
        console.log(`[Auto] ↩ Resumed order ${order._id} at '${order.status}', advancing in ${Math.round(remaining/1000)}s`);
      }
    }
  } catch (err) {
    console.error('[Auto] Resume error:', err.message);
  }
}

// GET /order/:id/lifecycle — returns timing info for frontend countdown
app.get('/order/:id/lifecycle', authMiddleware, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const stageStart = order.timestamps[order.status] || order.placed_at;
    const totalDelay = STAGE_DURATIONS[order.status] || 0;
    const elapsed    = Date.now() - new Date(stageStart).getTime();
    const remaining  = Math.max(0, totalDelay - elapsed);
    res.json({
      current_status: order.status,
      next_status:    NEXT_STATUS[order.status] || null,
      stage_duration: totalDelay,
      elapsed_ms:     elapsed,
      remaining_ms:   remaining,
      pct_complete:   totalDelay > 0 ? Math.min(100, Math.round((elapsed / totalDelay) * 100)) : 100,
      auto_advance:   !!NEXT_STATUS[order.status]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SERVE FRONTEND PAGES ─────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── STARTUP ──────────────────────────────────────────────────────────────
async function start() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('[MongoDB] ✅ Connected to MongoDB');
    await redis.initRedis();
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`\n🚀 Order Tracking System running at http://localhost:${PORT}`);
      console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard.html`);
      console.log(`🔴 Redis:     ${redis.isAvailable() ? 'Connected' : 'Not connected (fallback mode)'}`);
    });
    // Resume lifecycle for any orders that were active before restart
    await resumeActiveOrders();
  } catch (err) {
    console.error('Startup error:', err);
    process.exit(1);
  }
}

start();