/* ═══════════════════════════════════════════════════════
   ORDER TRACKING SYSTEM — App Logic
   API-connected, MongoDB + Redis backend
═══════════════════════════════════════════════════════ */

const API = 'http://localhost:5000';

// ── APP STATE ─────────────────────────────────────────────────────────────
const App = {
  currentUser: null,
  token: null,
  cart: [],
  currentRestaurant: null,

  init() {
    const stored = localStorage.getItem('ots_user');
    const token  = localStorage.getItem('ots_token');
    if (stored && token) {
      this.currentUser = JSON.parse(stored);
      this.token = token;
    }
    const cartStored = localStorage.getItem('ots_cart');
    if (cartStored) this.cart = JSON.parse(cartStored);
  },

  login(user, token) {
    this.currentUser = user;
    this.token = token;
    localStorage.setItem('ots_user', JSON.stringify(user));
    localStorage.setItem('ots_token', token);
  },

  logout() {
    this.currentUser = null;
    this.token = null;
    this.cart = [];
    localStorage.removeItem('ots_user');
    localStorage.removeItem('ots_token');
    localStorage.removeItem('ots_cart');
    window.location.href = 'login.html';
  },

  saveCart() { localStorage.setItem('ots_cart', JSON.stringify(this.cart)); },

  addToCart(item, restaurantId, restaurantName) {
    if (this.cart.length > 0 && this.cart[0].restaurantId !== restaurantId)
      return { conflict: true };
    const existing = this.cart.find(c => c._id === item._id);
    if (existing) existing.qty++;
    else this.cart.push({ ...item, qty: 1, restaurantId, restaurantName });
    this.saveCart();
    return { success: true };
  },

  removeFromCart(itemId) {
    const idx = this.cart.findIndex(c => c._id === itemId);
    if (idx > -1) {
      if (this.cart[idx].qty > 1) this.cart[idx].qty--;
      else this.cart.splice(idx, 1);
    }
    this.saveCart();
  },

  clearCart() { this.cart = []; this.saveCart(); },
  getCartTotal()  { return this.cart.reduce((s, i) => s + i.price * i.qty, 0); },
  getCartCount()  { return this.cart.reduce((s, i) => s + i.qty, 0); },

  headers() {
    return { 'Content-Type': 'application/json', ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {}) };
  }
};

// ── API HELPERS ───────────────────────────────────────────────────────────
async function apiGet(path) {
  const res = await fetch(API + path, { headers: App.headers() });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Request failed'); }
  return res.json();
}
async function apiPost(path, body) {
  const res = await fetch(API + path, { method: 'POST', headers: App.headers(), body: JSON.stringify(body) });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Request failed'); }
  return res.json();
}
async function apiPatch(path, body) {
  const res = await fetch(API + path, { method: 'PATCH', headers: App.headers(), body: JSON.stringify(body) });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Request failed'); }
  return res.json();
}

// ── NAV HELPERS ───────────────────────────────────────────────────────────
function requireAuth() {
  if (!App.currentUser) { window.location.href = 'login.html'; return false; }
  return true;
}
function redirectIfLoggedIn() {
  if (App.currentUser) window.location.href = 'restaurants.html';
}

// ── NAVBAR RENDERER ───────────────────────────────────────────────────────
function renderNavbar(activePage = '') {
  const cartCount = App.getCartCount();
  return `
  <nav class="navbar">
    <a href="restaurants.html" class="navbar-logo">
      <div class="logo-icon">📦</div>
      Order<span>Tracking</span>
    </a>
    <nav class="navbar-nav">
      <a href="restaurants.html" class="${activePage==='restaurants'?'active':''}">Restaurants</a>
      <a href="orders.html"      class="${activePage==='orders'?'active':''}">My Orders</a>
      <a href="dashboard.html"   class="${activePage==='dashboard'?'active':''}">Dashboard</a>
    </nav>
    <div id="redisStatus" class="redis-indicator">
      <div class="redis-dot" id="redisDot"></div>
      <span id="redisLabel">Redis</span>
    </div>
    ${App.currentUser ? `
      <button class="nav-cart-btn" onclick="window.location.href='cart.html'">
        🛒 Cart ${cartCount > 0 ? `<span class="cart-badge">${cartCount}</span>` : ''}
      </button>
      <div class="user-pill">
        <div class="avatar">${App.currentUser.name.charAt(0).toUpperCase()}</div>
        ${App.currentUser.name.split(' ')[0]}
      </div>
      <button class="btn btn-sm nav-logout-btn" onclick="App.logout()" title="Logout">Logout</button>
    ` : `<a href="login.html" class="btn btn-primary btn-sm">Login</a>`}
  </nav>`;
}

// ── TOAST ─────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info', duration = 3200) {
  let c = document.querySelector('.toast-container');
  if (!c) { c = document.createElement('div'); c.className = 'toast-container'; document.body.appendChild(c); }
  const icons = { success:'✅', error:'❌', info:'ℹ️' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type]||'🔔'}</span>${msg}`;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transform='translateX(20px)'; t.style.transition='.3s'; setTimeout(()=>t.remove(),300); }, duration);
}

// ── HELPERS ───────────────────────────────────────────────────────────────
function renderStars(rating) {
  const full = Math.floor(rating), half = rating % 1 >= .5;
  let s = '';
  for (let i = 0; i < 5; i++) {
    if (i < full) s += '★'; else if (i === full && half) s += '✦'; else s += '☆';
  }
  return `<span class="stars">${s}</span>`;
}

function typeBadge(item) {
  if (item.type === 'veg')     return `<span class="badge badge-veg">🟢 Veg${item.is_jain?' · Jain':''}</span>`;
  if (item.type === 'non_veg') return `<span class="badge badge-nonveg">🔴 Non-Veg${item.spice_level?' · '+item.spice_level:''}</span>`;
  if (item.type === 'beverage')return `<span class="badge badge-bev">🥤 ${item.serving_size_ml}ml</span>`;
  return '';
}

function statusPill(status) {
  const labels = { placed:'Order Placed', accepted:'Accepted', preparing:'Preparing', out_for_delivery:'Out for Delivery', delivered:'Delivered', cancelled:'Cancelled' };
  return `<span class="status-pill status-${status}">${labels[status]||status}</span>`;
}

function formatCurrency(n) { return '₹' + Number(n).toLocaleString('en-IN'); }

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function timeSince(d) {
  if (!d) return '';
  const secs = Math.floor((Date.now() - new Date(d)) / 1000);
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs/60)}m ago`;
  return `${Math.floor(secs/3600)}h ago`;
}

// ── REDIS STATUS CHECK ────────────────────────────────────────────────────
async function checkRedisStatus() {
  try {
    const data = await apiGet('/dashboard/redis');
    const dot = document.getElementById('redisDot');
    const label = document.getElementById('redisLabel');
    if (dot && label) {
      if (data.redis_available) {
        dot.className = 'redis-dot';
        label.textContent = `Redis · ${data.active_orders.length} active`;
      } else {
        dot.className = 'redis-dot offline';
        label.textContent = 'Redis: offline';
      }
    }
  } catch (e) {
    const dot = document.getElementById('redisDot');
    if (dot) dot.className = 'redis-dot offline';
  }
}

App.init();
