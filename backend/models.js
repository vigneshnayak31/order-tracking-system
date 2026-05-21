// ============================================================
//  OBJECTIVE 1 — MongoDB Schema & Data Layer
//  Polymorphic menu items, embedded addresses, computed fields
// ============================================================

const mongoose = require('mongoose');

// ── ADDRESS SUB-SCHEMA (embedded, one-to-few) ────────────────────────────
const AddressSchema = new mongoose.Schema({
  label:   { type: String, enum: ['Home', 'Work', 'Other'], default: 'Home' },
  line1:   { type: String, required: true },
  city:    { type: String, required: true },
  pincode: { type: String, required: true }
}, { _id: true });

// ── USER SCHEMA ───────────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  name:       { type: String, required: true, trim: true },
  email:      { type: String, required: true, unique: true, lowercase: true },
  password:   { type: String, required: true },
  phone:      { type: String, required: true },
  addresses:  [AddressSchema],           // Embedded one-to-few
  created_at: { type: Date, default: Date.now }
});

// ── POLYMORPHIC MENU ITEM SUB-SCHEMA ─────────────────────────────────────
//    Supports three types via discriminator-like pattern:
//    veg → has is_jain
//    non_veg → has spice_level
//    beverage → has serving_size_ml
const MenuItemSchema = new mongoose.Schema({
  name:    { type: String, required: true },
  price:   { type: Number, required: true },
  type:    { type: String, enum: ['veg', 'non_veg', 'beverage'], required: true },
  image:   String,
  desc:    String,
  rating:  { type: Number, default: 4.0 },
  popular: { type: Boolean, default: false },

  // Polymorphic fields
  is_jain:         Boolean,          // veg items only
  spice_level:     { type: String, enum: ['mild', 'medium', 'hot', 'very_hot'] }, // non_veg
  serving_size_ml: Number            // beverages
}, { _id: true });

// ── RESTAURANT SCHEMA ─────────────────────────────────────────────────────
const RestaurantSchema = new mongoose.Schema({
  name:              { type: String, required: true },
  cuisine:           { type: String, required: true },
  address:           { type: String, required: true },
  image:             String,
  cover:             String,
  is_open:           { type: Boolean, default: true },
  delivery_fee:      { type: Number, default: 20 },
  min_order:         { type: Number, default: 100 },
  tags:              [String],
  menu:              [MenuItemSchema],  // Polymorphic embedded array

  // Computed Pattern — maintained via $inc on order events
  total_orders:      { type: Number, default: 0 },
  avg_rating:        { type: Number, default: 4.0 },
  total_revenue:     { type: Number, default: 0 },
  avg_delivery_time: { type: Number, default: 30 }, // minutes

  created_at: { type: Date, default: Date.now }
});

// ── ORDER ITEM SUB-SCHEMA (embedded in Order) ────────────────────────────
const OrderItemSchema = new mongoose.Schema({
  menu_item_id: { type: mongoose.Schema.Types.ObjectId },
  name:   { type: String, required: true },
  price:  { type: Number, required: true },
  qty:    { type: Number, required: true, min: 1 },
  type:   String,
  image:  String
}, { _id: false });

// ── ORDER SCHEMA ──────────────────────────────────────────────────────────
const OrderSchema = new mongoose.Schema({
  restaurant_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
  user_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'User',       required: true },
  restaurant_name: String,
  customer_name:   String,

  items:   [OrderItemSchema],      // Embedded order items
  total:   { type: Number, required: true },
  delivery_fee:    { type: Number, default: 20 },
  delivery_address: AddressSchema,

  status: {
    type: String,
    enum: ['placed', 'accepted', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'],
    default: 'placed'
  },
  eta:          { type: Number, default: 35 }, // minutes

  // Redis key reference
  redis_key:    String,

  // Timestamps for each status transition
  timestamps: {
    placed:            Date,
    accepted:          Date,
    preparing:         Date,
    out_for_delivery:  Date,
    delivered:         Date,
    cancelled:         Date
  },

  // Computed delivery time (set when delivered)
  delivery_time_mins: Number,

  // Migration flag
  migrated_from_redis: { type: Boolean, default: false },

  placed_at:    { type: Date, default: Date.now },
  delivered_at: Date
});

const User       = mongoose.model('User',       UserSchema);
const Restaurant = mongoose.model('Restaurant', RestaurantSchema);
const Order      = mongoose.model('Order',      OrderSchema);

module.exports = { User, Restaurant, Order };
