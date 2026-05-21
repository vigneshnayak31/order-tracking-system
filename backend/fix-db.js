// ============================================================
//  fix-db.js — One-time Migration Script (FIXED)
//  Fixes all restaurants in MongoDB:
//  1. Converts menu {veg:[], nonVeg:[], beverages:[]} → flat array with type field
//  2. Sets is_open: true for all restaurants
//  3. Ensures cuisine field is present
//  Run once: node fix-db.js
// ============================================================

require('dotenv').config();
const mongoose = require('mongoose');
const { Restaurant } = require('./models');

// ── Unsplash image map for common menu items (best-effort) ───────────────
const IMAGE_MAP = {
  'paneer butter masala': 'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=400&q=80',
  'veg biryani': 'https://images.unsplash.com/photo-1563379091339-03246963d96c?w=400&q=80',
  'chicken biryani': 'https://images.unsplash.com/photo-1563379091339-03246963d96c?w=400&q=80',
  'mutton biryani': 'https://images.unsplash.com/photo-1563379091339-03246963d96c?w=400&q=80',
  'lassi': 'https://images.unsplash.com/photo-1553361371-9b22f78e8b1d?w=400&q=80',
  'coke': 'https://images.unsplash.com/photo-1554866585-cd94860890b7?w=400&q=80',
  'pepsi': 'https://images.unsplash.com/photo-1554866585-cd94860890b7?w=400&q=80',
  'margherita pizza': 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=400&q=80',
  'farmhouse pizza': 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400&q=80',
  'chicken pizza': 'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=400&q=80',
  'pepperoni pizza': 'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=400&q=80',
  'cold coffee': 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=400&q=80',
  'masala dosa': 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=400&q=80',
  'idli vada': 'https://images.unsplash.com/photo-1606491956689-2ea866880c84?w=400&q=80',
  'egg dosa': 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=400&q=80',
  'filter coffee': 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=400&q=80',
  'tea': 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=400&q=80',
  'veg burger': 'https://images.unsplash.com/photo-1520072959219-c595dc870360?w=400&q=80',
  'chicken burger': 'https://images.unsplash.com/photo-1607013251379-e6eecfffe234?w=400&q=80',
  'double chicken burger': 'https://images.unsplash.com/photo-1607013251379-e6eecfffe234?w=400&q=80',
  'milkshake': 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=400&q=80',
  'veg noodles': 'https://images.unsplash.com/photo-1612929633738-8fe44f7ec841?w=400&q=80',
  'gobi manchurian': 'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=400&q=80',
  'chicken fried rice': 'https://images.unsplash.com/photo-1563699896604-9ea0e1d83082?w=400&q=80',
  'chicken noodles': 'https://images.unsplash.com/photo-1612929633738-8fe44f7ec841?w=400&q=80',
  'green tea': 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=400&q=80',
  'cold drink': 'https://images.unsplash.com/photo-1554866585-cd94860890b7?w=400&q=80',
};

function getImage(name) {
  return IMAGE_MAP[(name || '').toLowerCase()] ||
    'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400&q=80';
}

// ── Cuisine guesser from restaurant name ─────────────────────────────────
function guessCuisine(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('pizza')) return 'Italian';
  if (n.includes('burger')) return 'American Fast Food';
  if (n.includes('south') || n.includes('delight')) return 'South Indian';
  if (n.includes('chinese') || n.includes('bowl') || n.includes('wok')) return 'Chinese';
  if (n.includes('spicy') || n.includes('treat') || n.includes('spice')) return 'North Indian';
  return 'Multi-Cuisine';
}

// ── Detect whether a menu is truly a flat array of items ─────────────────
// A flat array of items has elements with a `name` string field.
// An array-like Mongoose object wrapping {veg,nonVeg,beverages} will NOT.
function isTrulyFlatArray(menu) {
  if (!Array.isArray(menu) || menu.length === 0) return false;
  // Every item must have a non-empty name string and a numeric price
  return menu.every(item =>
    item && typeof item.name === 'string' && item.name.trim() !== '' &&
    typeof item.price === 'number'
  );
}

// ── Detect object-format menu (may arrive as plain object OR Mongoose doc) ─
function isObjectMenu(menu) {
  if (!menu || typeof menu !== 'object' || Array.isArray(menu)) return false;
  // Has at least one of the known sub-keys
  return !!(menu.veg || menu.nonVeg || menu.non_veg || menu.beverages || menu.beverage ||
    menu.Veg || menu.NonVeg || menu.Beverages);
}

// ── Convert {veg:[], nonVeg:[], beverages:[]} → flat array ───────────────
function convertMenuToFlatArray(rawMenu, restaurantName) {
  console.log(`   ↳ raw menu type: ${Array.isArray(rawMenu) ? 'Array' : typeof rawMenu}`);

  // ── CASE 1: Already a proper flat array (each item has name + price) ───
  if (isTrulyFlatArray(rawMenu)) {
    console.log('   ↳ detected: valid flat array — fixing type values only');
    return rawMenu.map(item => {
      let type = item.type;
      if (type === 'nonVeg' || type === 'non-veg') type = 'non_veg';
      if (type === 'beverage' || type === 'beverages') type = 'beverage';
      if (!['veg', 'non_veg', 'beverage'].includes(type)) type = 'veg';
      return {
        name: item.name,
        price: item.price,
        type,
        rating: item.rating || 4.0,
        popular: item.popular || false,
        desc: item.desc || item.description || '',
        image: item.image || getImage(item.name),
      };
    });
  }

  // ── CASE 2: Flat array but items are missing name/price (corrupt) ──────
  if (Array.isArray(rawMenu) && rawMenu.length > 0) {
    console.log('   ↳ detected: flat array but items are MISSING name/price — checking for nested object inside');
    // Mongoose sometimes wraps the object-format as a single-element array
    // or the array contains the sub-document keys directly on element [0]
    const first = rawMenu[0];
    if (first && (first.veg || first.nonVeg || first.non_veg || first.beverages)) {
      console.log('   ↳ found object-format nested inside array[0], unwrapping...');
      return convertFromObjectFormat(first);
    }
    // Truly corrupt — items exist but have no name/price, skip them
    console.warn(`   ⚠️  Flat array items are corrupt (no name/price). Dropping ${rawMenu.length} bad item(s).`);
    return [];
  }

  // ── CASE 3: Object format { veg:[], nonVeg:[], beverages:[] } ──────────
  if (isObjectMenu(rawMenu)) {
    console.log('   ↳ detected: object-format menu — converting to flat array');
    return convertFromObjectFormat(rawMenu);
  }

  // ── CASE 4: Mongoose document (not plain object yet) ───────────────────
  // toObject() should handle this, but guard just in case
  if (rawMenu && typeof rawMenu.toObject === 'function') {
    console.log('   ↳ detected: Mongoose sub-document, calling toObject()');
    return convertMenuToFlatArray(rawMenu.toObject(), restaurantName);
  }

  console.warn('   ⚠️  Unknown menu format, returning empty array');
  return [];
}

function convertFromObjectFormat(menu) {
  const flat = [];

  const vegItems = menu.veg || menu.Veg || [];
  const nvItems = menu.nonVeg || menu.non_veg || menu.NonVeg || menu['non-veg'] || [];
  const bevItems = menu.beverages || menu.beverage || menu.Beverages || [];

  vegItems.forEach(item => {
    if (!item || !item.name) { console.warn('   ⚠️  Skipping veg item with no name:', item); return; }
    flat.push({
      name: item.name,
      price: item.price || 0,
      type: 'veg',
      rating: item.rating || 4.0,
      popular: item.popular || false,
      desc: item.desc || item.description || '',
      image: item.image || getImage(item.name),
    });
  });

  nvItems.forEach(item => {
    if (!item || !item.name) { console.warn('   ⚠️  Skipping non_veg item with no name:', item); return; }
    flat.push({
      name: item.name,
      price: item.price || 0,
      type: 'non_veg',
      spice_level: item.spice_level || 'medium',
      rating: item.rating || 4.0,
      popular: item.popular || false,
      desc: item.desc || item.description || '',
      image: item.image || getImage(item.name),
    });
  });

  bevItems.forEach(item => {
    if (!item || !item.name) { console.warn('   ⚠️  Skipping beverage item with no name:', item); return; }
    flat.push({
      name: item.name,
      price: item.price || 0,
      type: 'beverage',
      serving_size_ml: item.serving_size_ml || 300,
      rating: item.rating || 4.0,
      popular: item.popular || false,
      desc: item.desc || item.description || '',
      image: item.image || getImage(item.name),
    });
  });

  return flat;
}

async function main() {
  console.log('\n🔧 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to:', process.env.MONGO_URI);

  // Use lean() to get plain JS objects — avoids Mongoose re-casting the menu
  // into a schema shape that can destroy the original structure before we read it
  const rawDocs = await Restaurant.find({}).lean();
  console.log(`\n📦 Found ${rawDocs.length} restaurant(s) to process\n`);

  let fixed = 0;
  let skipped = 0;

  for (const raw of rawDocs) {
    console.log(`\n🍽️  Processing: "${raw.name}"`);

    // raw.menu is now a plain JS object/array — no Mongoose casting applied
    const flatMenu = convertMenuToFlatArray(raw.menu, raw.name);

    console.log(`   menu items: ${flatMenu.length} (veg: ${flatMenu.filter(i => i.type === 'veg').length}, non_veg: ${flatMenu.filter(i => i.type === 'non_veg').length}, beverage: ${flatMenu.filter(i => i.type === 'beverage').length})`);

    if (flatMenu.length === 0) {
      console.warn(`   ⚠️  No menu items produced for "${raw.name}" — skipping save`);
      skipped++;
      continue;
    }

    const cuisine = (raw.cuisine && raw.cuisine.trim()) ? raw.cuisine : guessCuisine(raw.name);

    const patch = {
      menu: flatMenu,
      is_open: true,
      cuisine: cuisine,
      avg_rating: raw.avg_rating || 4.0,
      avg_delivery_time: raw.avg_delivery_time || 30,
      delivery_fee: raw.delivery_fee || 20,
      min_order: raw.min_order || 100,
    };

    // runValidators: false during migration — we already validated the data above
    // Switch back to true once you've confirmed the schema matches
    await Restaurant.findByIdAndUpdate(raw._id, { $set: patch }, { runValidators: false });
    console.log(`   ✅ Fixed — cuisine: "${cuisine}", is_open: true, menu: ${flatMenu.length} items`);
    fixed++;
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`✅ Done! Fixed: ${fixed}, Skipped: ${skipped}`);
  console.log(`\nNext step: restart your backend with  npm start\n`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Migration failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});