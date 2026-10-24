'use strict';
// Quantity parsing, unit normalization, aisle guessing and shopping-list merging.

// [canonical key, dimension, factor to base unit (g or ml), aliases]
const DEFS = [
  ['g', 'mass', 1, ['gram', 'grams', 'gr']],
  ['kg', 'mass', 1000, ['kilogram', 'kilograms']],
  ['oz', 'mass', 28.3495, ['ounce', 'ounces']],
  ['lb', 'mass', 453.592, ['lbs', 'pound', 'pounds']],
  ['ml', 'volume', 1, ['milliliter', 'milliliters', 'millilitre', 'millilitres']],
  ['l', 'volume', 1000, ['liter', 'liters', 'litre', 'litres']],
  ['tsp', 'volume', 4.92892, ['teaspoon', 'teaspoons']],
  ['tbsp', 'volume', 14.7868, ['tablespoon', 'tablespoons', 'tbs']],
  ['cup', 'volume', 236.588, ['cups']],
  ['fl oz', 'volume', 29.5735, ['floz', 'fluid ounce', 'fluid ounces']],
  ['', 'count', 1, ['each', 'piece', 'pieces', 'whole', 'pc', 'pcs']],
];
const UNITS = new Map();
for (const [key, dim, factor, names] of DEFS) {
  const u = { key, dim, factor };
  for (const n of [key, ...names]) UNITS.set(n, u);
}
const BASE = { mass: 'g', volume: 'ml' };

function singular(w) {
  if (w.length > 3 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('oes')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

// Known units map to a dimension; anything else ("clove", "can") only merges with itself.
function normUnit(text) {
  const t = String(text || '').trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
  return UNITS.get(t) || { key: singular(t), dim: 'other', factor: 1 };
}

// Accepts 2, 1.5, 1/2 and "1 1/2". Returns NaN for anything else.
function parseQty(v) {
  const ok = (n) => (Number.isFinite(n) && n > 0 && n <= 100000 ? n : NaN);
  if (typeof v === 'number') return ok(v);
  const s = String(v).trim();
  let m;
  if ((m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[3] ? ok(+m[1] + +m[2] / +m[3]) : NaN;
  if ((m = s.match(/^(\d+)\/(\d+)$/))) return +m[2] ? ok(+m[1] / +m[2]) : NaN;
  if (/^(?:\d+\.?\d*|\.\d+)$/.test(s)) return ok(Number(s));
  return NaN;
}

const AISLE_ORDER = ['Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery', 'Pantry', 'Spices', 'Frozen', 'Other'];
// First match wins, so specific rules come before general ones.
const RULES = [
  ['Pantry', 'coconut milk|peanut butter|almond milk|stock|broth|soy sauce|tomato paste|tomato sauce|canned|chickpea|bean|lentil|oil\\b|vinegar'],
  ['Spices', 'salt\\b|black pepper|white pepper|pepper flakes|ground|powder|dried|seasoning|cumin|paprika|oregano|cinnamon|turmeric|nutmeg|cayenne|thyme|rosemary|garam masala|curry|chili flakes'],
  ['Meat & Seafood', 'chicken|beef|pork|bacon|sausage|salmon|shrimp|fish|turkey|lamb|tuna|ham\\b|steak|mince'],
  ['Dairy & Eggs', 'milk|butter|cheese|yogh?urt|cream|eggs?\\b|parmesan|mozzarella|feta|ghee'],
  ['Bakery', 'bread|buns?\\b|tortilla|bagel|pita|baguette|naan'],
  ['Frozen', 'frozen|ice cream'],
  ['Produce', 'apple|banana|lemon|lime|orange|onion|garlic|tomato|potato|carrot|lettuce|spinach|pepper|basil|parsley|cilantro|coriander|mint|ginger|mushroom|cucumber|celery|broccoli|avocado|zucchini|cabbage|kale|scallion|berry|berries|squash|corn\\b|peas?\\b|arugula|olives?\\b|chili|chile|jalape'],
  ['Pantry', 'flour|sugar|rice|pasta|spaghetti|noodle|sauce|oats|honey|syrup|nuts?\\b|almond|walnut|mustard|ketchup|mayo|yeast|baking|chocolate|cocoa|vanilla|water\\b|panko|breadcrumb|couscous|quinoa|tahini|wine'],
].map(([aisle, words]) => [aisle, new RegExp('\\b(?:' + words + ')', 'i')]);

function aisleFor(name) {
  for (const [aisle, re] of RULES) if (re.test(name)) return aisle;
  return 'Other';
}

// rows: {name, qty, unit, aisle, scale}. Same ingredient + compatible units are summed.
function mergeShopping(rows) {
  const map = new Map();
  for (const r of rows) {
    const u = normUnit(r.unit);
    const hasQty = r.qty != null;
    const name = r.name.trim().toLowerCase().replace(/\s+/g, ' ');
    const dim = !hasQty ? 'none' : u.dim === 'other' ? 'other:' + u.key : u.dim;
    const key = singular(name) + '|' + dim;
    let e = map.get(key);
    if (!e) map.set(key, (e = { name, aisle: AISLE_ORDER.includes(r.aisle) ? r.aisle : 'Other', dim, units: new Set(), base: 0 }));
    if (hasQty) {
      e.base += r.qty * r.scale * u.factor;
      e.units.add(u.key);
    }
  }

  const byAisle = new Map(AISLE_ORDER.map((a) => [a, []]));
  for (const e of map.values()) {
    let qty = null;
    let unit = '';
    if (e.dim !== 'none') {
      const [first] = e.units;
      if (e.dim === 'mass' || e.dim === 'volume') {
        if (e.units.size === 1) {
          unit = first;
          qty = e.base / UNITS.get(first).factor;
        } else {
          // mixed units: fall back to metric
          unit = BASE[e.dim];
          qty = e.base;
          if (qty >= 1000) {
            qty /= 1000;
            unit = e.dim === 'mass' ? 'kg' : 'l';
          }
        }
      } else {
        unit = first;
        qty = e.base;
      }
      qty = Math.round(qty * 100) / 100;
    }
    byAisle.get(e.aisle).push({ name: e.name, qty, unit });
  }
  return AISLE_ORDER.map((aisle) => ({ aisle, items: byAisle.get(aisle).sort((a, b) => a.name.localeCompare(b.name)) }))
    .filter((g) => g.items.length);
}

module.exports = { parseQty, normUnit, aisleFor, mergeShopping };
