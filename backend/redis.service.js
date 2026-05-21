// ============================================================
//  OBJECTIVE 2 — Redis Real-Time Order Management
//  Order lifecycle, delivery queue, TTL, rate limiting
// ============================================================

const { createClient } = require('redis');

let client = null;
let redisAvailable = false;

async function initRedis() {
  try {
    client = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    client.on('error', (err) => {
      redisAvailable = false;
      console.warn('[Redis] Connection error — fallback to MongoDB only:', err.message);
    });
    client.on('connect', () => {
      redisAvailable = true;
      console.log('[Redis] ✅ Connected to Redis server');
    });
    await client.connect();
    redisAvailable = true;
  } catch (err) {
    redisAvailable = false;
    console.warn('[Redis] ⚠️  Redis unavailable — running in MongoDB-only mode');
  }
}

function isAvailable() { return redisAvailable && client && client.isOpen; }

// ── (a) ORDER STATUS TRACKING — Hashes ────────────────────────────────────
// HSET order:<id> status restaurant customer eta ...
async function setOrderHash(orderId, data) {
  if (!isAvailable()) return false;
  const key = `order:${orderId}`;
  await client.hSet(key, {
    status:          data.status || 'placed',
    restaurant_id:   String(data.restaurant_id),
    restaurant_name: data.restaurant_name || '',
    customer_id:     String(data.user_id),
    customer_name:   data.customer_name || '',
    eta:             String(data.eta || 35),
    total:           String(data.total || 0),
    placed_at:       data.placed_at || new Date().toISOString(),
    updated_at:      new Date().toISOString()
  });
  // Active orders expire after 24 hours if not cleaned up
  await client.expire(key, 86400);
  console.log(`[Redis] HSET ${key} → status=placed`);
  return key;
}

async function updateOrderStatus(orderId, status) {
  if (!isAvailable()) return false;
  const key = `order:${orderId}`;
  await client.hSet(key, {
    status,
    updated_at:    new Date().toISOString(),
    [`${status}_at`]: new Date().toISOString()
  });
  console.log(`[Redis] HSET ${key} → status=${status}`);
  return true;
}

async function getOrderHash(orderId) {
  if (!isAvailable()) return null;
  const key = `order:${orderId}`;
  const data = await client.hGetAll(key);
  return Object.keys(data).length > 0 ? data : null;
}

async function deleteOrderHash(orderId) {
  if (!isAvailable()) return false;
  const key = `order:${orderId}`;
  await client.del(key);
  console.log(`[Redis] DEL ${key} (migrated to MongoDB)`);
  return true;
}

// ── (b) DELIVERY QUEUE — Lists (FIFO) ─────────────────────────────────────
// RPUSH delivery:queue <orderId>  — add to tail
// LPOP  delivery:queue            — delivery agent picks from head
const DELIVERY_QUEUE_KEY = 'delivery:queue';

async function pushToDeliveryQueue(orderId) {
  if (!isAvailable()) return false;
  await client.rPush(DELIVERY_QUEUE_KEY, String(orderId));
  const len = await client.lLen(DELIVERY_QUEUE_KEY);
  console.log(`[Redis] RPUSH ${DELIVERY_QUEUE_KEY} ${orderId} → queue length: ${len}`);
  return len;
}

async function popFromDeliveryQueue() {
  if (!isAvailable()) return null;
  const orderId = await client.lPop(DELIVERY_QUEUE_KEY);
  if (orderId) console.log(`[Redis] LPOP ${DELIVERY_QUEUE_KEY} → ${orderId}`);
  return orderId;
}

async function getQueueLength() {
  if (!isAvailable()) return 0;
  return await client.lLen(DELIVERY_QUEUE_KEY);
}

async function getQueueContents() {
  if (!isAvailable()) return [];
  return await client.lRange(DELIVERY_QUEUE_KEY, 0, -1);
}

// ── (c) RESTAURANT ONLINE/OFFLINE — Strings with TTL ─────────────────────
// Key: restaurant:online:<id>  Value: 1  TTL: 300s (heartbeat)
async function setRestaurantOnline(restaurantId) {
  if (!isAvailable()) return false;
  const key = `restaurant:online:${restaurantId}`;
  await client.setEx(key, 300, '1');  // 300s heartbeat TTL
  console.log(`[Redis] SETEX ${key} 300 1 (restaurant online heartbeat)`);
  return true;
}

async function isRestaurantOnline(restaurantId) {
  if (!isAvailable()) return null; // unknown if Redis down
  const key = `restaurant:online:${restaurantId}`;
  const val = await client.get(key);
  return val === '1';
}

async function getOnlineRestaurantCount() {
  if (!isAvailable()) return 0;
  const keys = await client.keys('restaurant:online:*');
  return keys.length;
}

// ── (d) RATE LIMITING — INCR + EXPIRE ────────────────────────────────────
// Max 5 orders per hour per user
const RATE_LIMIT_MAX = 5;

async function checkRateLimit(userId) {
  if (!isAvailable()) return { allowed: true, count: 0, remaining: RATE_LIMIT_MAX };
  const key = `rate:order:${userId}`;
  const current = await client.incr(key);
  if (current === 1) {
    // First order this window — set 1 hour expiry
    await client.expire(key, 3600);
    console.log(`[Redis] INCR ${key}=1, EXPIRE 3600 (rate window started)`);
  } else {
    console.log(`[Redis] INCR ${key}=${current} (rate check)`);
  }
  const ttl = await client.ttl(key);
  return {
    allowed:   current <= RATE_LIMIT_MAX,
    count:     current,
    remaining: Math.max(0, RATE_LIMIT_MAX - current),
    reset_in:  ttl
  };
}

async function getRateLimitStatus(userId) {
  if (!isAvailable()) return { count: 0, remaining: RATE_LIMIT_MAX };
  const key = `rate:order:${userId}`;
  const val = await client.get(key);
  const count = parseInt(val || '0');
  const ttl = await client.ttl(key);
  return { count, remaining: Math.max(0, RATE_LIMIT_MAX - count), reset_in: ttl };
}

// ── ACTIVE ORDER COUNT ────────────────────────────────────────────────────
async function getActiveOrderCount() {
  if (!isAvailable()) return 0;
  const keys = await client.keys('order:*');
  return keys.length;
}

async function getAllActiveOrders() {
  if (!isAvailable()) return [];
  const keys = await client.keys('order:*');
  const orders = [];
  for (const key of keys) {
    const data = await client.hGetAll(key);
    if (data && data.status && data.status !== 'delivered') {
      orders.push({ redis_key: key, order_id: key.replace('order:', ''), ...data });
    }
  }
  return orders;
}

module.exports = {
  initRedis,
  isAvailable,
  // Order hash
  setOrderHash, updateOrderStatus, getOrderHash, deleteOrderHash,
  // Delivery queue
  pushToDeliveryQueue, popFromDeliveryQueue, getQueueLength, getQueueContents,
  // Restaurant heartbeat
  setRestaurantOnline, isRestaurantOnline, getOnlineRestaurantCount,
  // Rate limiting
  checkRateLimit, getRateLimitStatus,
  // Dashboard
  getActiveOrderCount, getAllActiveOrders
};
