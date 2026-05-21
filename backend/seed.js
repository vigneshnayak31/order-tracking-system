// ============================================================
//  OBJECTIVE 1 DELIVERABLE — Sample Data
//  5 Restaurants with polymorphic menus, 20 sample orders
// ============================================================

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
require('dotenv').config();

const { User, Restaurant, Order } = require('./models');

const RESTAURANTS_DATA = [
  {
    name: 'The Spice Garden', cuisine: 'North Indian',
    address: '12, MG Road, Bengaluru', is_open: true,
    delivery_fee: 30, min_order: 150,
    image: 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=600&q=80',
    cover: '#1E40AF', avg_delivery_time: 32, avg_rating: 4.5,
    tags: ['Butter Chicken', 'Biryani', 'Dal Makhani'],
    menu: [
      { name:'Butter Chicken',  type:'non_veg',  price:320, spice_level:'medium', rating:4.8, popular:true,  desc:'Rich creamy tomato-based curry with tender chicken pieces', image:'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=400&q=80' },
      { name:'Paneer Tikka',    type:'veg',      price:280, is_jain:false,         rating:4.6, popular:true,  desc:'Marinated cottage cheese grilled in tandoor',              image:'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=400&q=80' },
      { name:'Dal Makhani',     type:'veg',      price:220, is_jain:true,          rating:4.7, popular:false, desc:'Slow-cooked black lentils in butter and cream',            image:'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=400&q=80' },
      { name:'Chicken Biryani', type:'non_veg',  price:350, spice_level:'hot',     rating:4.9, popular:true,  desc:'Aromatic basmati rice layered with spiced chicken',        image:'https://images.unsplash.com/photo-1563379091339-03246963d96c?w=400&q=80' },
      { name:'Mango Lassi',     type:'beverage', price:80,  serving_size_ml:300,   rating:4.5, popular:false, desc:'Chilled mango yogurt drink',                              image:'https://images.unsplash.com/photo-1553361371-9b22f78e8b1d?w=400&q=80' },
      { name:'Garlic Naan',     type:'veg',      price:60,  is_jain:false,         rating:4.4, popular:false, desc:'Soft leavened bread baked in tandoor with garlic',        image:'https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=400&q=80' }
    ]
  },
  {
    name: 'Burger Republic', cuisine: 'American Fast Food',
    address: '5, Koramangala, Bengaluru', is_open: true,
    delivery_fee: 20, min_order: 100,
    image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&q=80',
    cover: '#1D4ED8', avg_delivery_time: 22, avg_rating: 4.2,
    tags: ['Smash Burger', 'Crispy Fries', 'Shakes'],
    menu: [
      { name:'Classic Smash Burger',  type:'non_veg',  price:249, spice_level:'mild', rating:4.7, popular:true,  desc:'Double smashed patty with cheese and special sauce',        image:'https://images.unsplash.com/photo-1607013251379-e6eecfffe234?w=400&q=80' },
      { name:'Crispy Veggie Burger',  type:'veg',      price:199, is_jain:false,       rating:4.3, popular:false, desc:'Crispy potato-veggie patty with fresh greens',              image:'https://images.unsplash.com/photo-1520072959219-c595dc870360?w=400&q=80' },
      { name:'Loaded Cheese Fries',   type:'veg',      price:149, is_jain:false,       rating:4.5, popular:true,  desc:'Golden fries topped with molten cheese sauce',              image:'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=400&q=80' },
      { name:'Chocolate Shake',       type:'beverage', price:129, serving_size_ml:450, rating:4.6, popular:false, desc:'Thick creamy chocolate milkshake',                          image:'https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=400&q=80' }
    ]
  },
  {
    name: 'Dragon Wok', cuisine: 'Chinese',
    address: '34, Indiranagar, Bengaluru', is_open: true,
    delivery_fee: 25, min_order: 120,
    image: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=600&q=80',
    cover: '#1E3A8A', avg_delivery_time: 28, avg_rating: 4.4,
    tags: ['Dim Sum', 'Fried Rice', 'Noodles'],
    menu: [
      { name:'Kung Pao Chicken',    type:'non_veg',  price:310, spice_level:'hot',  rating:4.8, popular:true,  desc:'Wok-tossed chicken with peanuts and dried chillies', image:'https://images.unsplash.com/photo-1525755662778-989d0524087e?w=400&q=80' },
      { name:'Veg Fried Rice',      type:'veg',      price:180, is_jain:false,       rating:4.2, popular:false, desc:'Wok-fried rice with seasonal vegetables',             image:'https://images.unsplash.com/photo-1563699896604-9ea0e1d83082?w=400&q=80' },
      { name:'Hakka Noodles',       type:'veg',      price:190, is_jain:false,       rating:4.4, popular:false, desc:'Stir-fried noodles with veggies and soy sauce',       image:'https://images.unsplash.com/photo-1612929633738-8fe44f7ec841?w=400&q=80' },
      { name:'Prawn Dim Sum 6 pcs', type:'non_veg',  price:280, spice_level:'mild', rating:4.9, popular:true,  desc:'Steamed prawn dumplings with chilli dip',             image:'https://images.unsplash.com/photo-1563245372-f21724e3856d?w=400&q=80' },
      { name:'Green Tea',           type:'beverage', price:60,  serving_size_ml:200, rating:4.0, popular:false, desc:'Authentic Chinese green tea',                         image:'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=400&q=80' }
    ]
  },
  {
    name: 'Pizza Piazza', cuisine: 'Italian',
    address: '8, JP Nagar, Bengaluru', is_open: false,
    delivery_fee: 35, min_order: 200,
    image: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=600&q=80',
    cover: '#2563EB', avg_delivery_time: 35, avg_rating: 4.6,
    tags: ['Wood-fired', 'Pasta', 'Tiramisu'],
    menu: [
      { name:'Margherita Pizza', type:'veg',      price:299, is_jain:false,       rating:4.7, popular:true,  desc:'Classic tomato, fresh mozzarella and basil on wood-fired base', image:'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=400&q=80' },
      { name:'Pepperoni Pizza',  type:'non_veg',  price:349, spice_level:'mild', rating:4.8, popular:true,  desc:'Loaded with premium pepperoni on crispy thin crust',              image:'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=400&q=80' },
      { name:'Penne Arrabiata',  type:'veg',      price:249, is_jain:false,       rating:4.3, popular:false, desc:'Penne pasta in spicy tomato and garlic sauce',                    image:'https://images.unsplash.com/photo-1598866594230-a7c12756260f?w=400&q=80' },
      { name:'Tiramisu',        type:'veg',      price:179, is_jain:false,       rating:4.9, popular:false, desc:'Classic Italian dessert with espresso and mascarpone',            image:'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=400&q=80' },
      { name:'Lemonade',        type:'beverage', price:79,  serving_size_ml:350, rating:4.3, popular:false, desc:'Chilled freshly squeezed lemonade',                               image:'https://images.unsplash.com/photo-1621263764928-df1444c5e859?w=400&q=80' }
    ]
  },
  {
    name: 'South Spice', cuisine: 'South Indian',
    address: '22, HSR Layout, Bengaluru', is_open: true,
    delivery_fee: 15, min_order: 80,
    image: 'https://images.unsplash.com/photo-1630383249896-424e482df921?w=600&q=80',
    cover: '#1E40AF', avg_delivery_time: 25, avg_rating: 4.3,
    tags: ['Dosa', 'Idli', 'Filter Coffee'],
    menu: [
      { name:'Masala Dosa',          type:'veg',      price:120, is_jain:false,        rating:4.8, popular:true,  desc:'Crispy rice crepe stuffed with spiced potato filling', image:'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=400&q=80' },
      { name:'Chicken Chettinad',    type:'non_veg',  price:340, spice_level:'very_hot', rating:4.7, popular:false, desc:'Aromatic Chettinad spice curry with chicken',         image:'https://images.unsplash.com/photo-1548943487-a2e4e43b4853?w=400&q=80' },
      { name:'Idli Sambar 4 pcs',   type:'veg',      price:80,  is_jain:true,         rating:4.5, popular:false, desc:'Steamed rice cakes with sambar and chutneys',          image:'https://images.unsplash.com/photo-1606491956689-2ea866880c84?w=400&q=80' },
      { name:'Filter Coffee',        type:'beverage', price:50,  serving_size_ml:150,  rating:4.9, popular:true,  desc:'Traditional South Indian decoction coffee',            image:'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=400&q=80' },
      { name:'Rasam',               type:'veg',      price:60,  is_jain:true,         rating:4.2, popular:false, desc:'Tangy tamarind-tomato soup',                           image:'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=400&q=80' }
    ]
  }
];

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  // Clear existing data
  await User.deleteMany({});
  await Restaurant.deleteMany({});
  await Order.deleteMany({});
  console.log('Cleared existing data');

  // Create demo users
  const hash = await bcrypt.hash('password123', 10);
  const users = await User.insertMany([
    { name:'Arjun Sharma',  email:'arjun@demo.com',  password:hash, phone:'9876543210', addresses:[{label:'Home', line1:'14B, MG Road', city:'Bengaluru', pincode:'560001'}] },
    { name:'Priya Nair',    email:'priya@demo.com',  password:hash, phone:'9876543211', addresses:[{label:'Home', line1:'22, Koramangala', city:'Bengaluru', pincode:'560034'}] },
    { name:'Rahul Gupta',   email:'rahul@demo.com',  password:hash, phone:'9876543212', addresses:[{label:'Work', line1:'Tech Park, Whitefield', city:'Bengaluru', pincode:'560066'}] }
  ]);
  console.log(`Seeded ${users.length} users`);

  // Create restaurants
  const restaurants = await Restaurant.insertMany(RESTAURANTS_DATA);
  console.log(`Seeded ${restaurants.length} restaurants`);

  // Create 20 sample orders across restaurants/users
  const statuses = ['placed','accepted','preparing','out_for_delivery','delivered'];
  const orders = [];
  for (let i = 0; i < 20; i++) {
    const rest  = restaurants[i % restaurants.length];
    const user  = users[i % users.length];
    const item  = rest.menu[i % rest.menu.length];
    const qty   = (i % 3) + 1;
    const total = item.price * qty + rest.delivery_fee;
    const st    = statuses[i % statuses.length];
    const placed = new Date(Date.now() - (20 - i) * 3600000);
    orders.push({
      restaurant_id:   rest._id,
      user_id:         user._id,
      restaurant_name: rest.name,
      customer_name:   user.name,
      items:           [{ menu_item_id: item._id, name: item.name, price: item.price, qty, type: item.type, image: item.image }],
      total,
      delivery_fee:    rest.delivery_fee,
      delivery_address: user.addresses[0],
      status: st,
      eta:    rest.avg_delivery_time,
      redis_key: `order:SEED${i + 1}`,
      timestamps: { placed: placed, ...(st !== 'placed' ? { accepted: new Date(placed.getTime() + 180000) } : {}) },
      placed_at: placed,
      ...(st === 'delivered' ? { delivered_at: new Date(placed.getTime() + rest.avg_delivery_time * 60000), delivery_time_mins: rest.avg_delivery_time, migrated_from_redis: true } : {})
    });
  }
  await Order.insertMany(orders);
  console.log(`Seeded 20 orders`);

  // Update restaurant stats using $inc pattern
  for (const rest of restaurants) {
    const restOrders = orders.filter(o => o.restaurant_id.equals ? o.restaurant_id.equals(rest._id) : String(o.restaurant_id) === String(rest._id));
    const revenue    = restOrders.filter(o => o.status === 'delivered').reduce((s, o) => s + o.total, 0);
    await Restaurant.findByIdAndUpdate(rest._id, {
      $inc: { total_orders: restOrders.length, total_revenue: revenue }
    });
  }
  console.log('Updated restaurant computed stats');

  console.log('\n✅ Seed complete!');
  console.log('Demo login: arjun@demo.com / password123');
  await mongoose.disconnect();
}

seed().catch(err => { console.error(err); process.exit(1); });
