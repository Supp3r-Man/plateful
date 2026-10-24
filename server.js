'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const argon2 = require('argon2');
const express = require('express');
const { db, createRecipe } = require('./db');
const { parseQty, mergeShopping } = require('./units');

const PORT = 3000;
const ORIGINS = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];
const UPLOADS = path.join(__dirname, 'uploads');
const PAGE = 12;
const TAG_RE = /^[a-z0-9][a-z0-9 -]{0,23}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
fs.mkdirSync(UPLOADS, { recursive: true });

// ---- small helpers -------------------------------------------------------
const now = () => new Date().toISOString();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SAFE = ['GET', 'HEAD'];

function bad(msg, status = 422) {
  const e = new Error(msg);
  e.status = status;
  throw e;
}
function str(v, name, min, max, trim = true) {
  if (typeof v !== 'string') bad(`${name} is required`);
  const s = trim ? v.trim() : v;
  if (s.length < min || s.length > max) bad(`${name} must be ${min}-${max} characters`);
  return s;
}
function int(v, name, min, max) {
  const ok = typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v));
  const n = ok ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) bad(`${name} must be a whole number from ${min} to ${max}`);
  return n;
}
const hits = new Map();
function limit(key, n, windowMs) {
  const t = Date.now();
  const q = (hits.get(key) || []).filter((x) => t - x < windowMs);
  if (q.length >= n) {
    hits.set(key, q);
    bad('Too many requests, slow down', 429);
  }
  q.push(t);
  hits.set(key, q);
}

const DUMMY = argon2.hash('not-a-real-password'); // verified against on unknown emails to even out timing

// ---- app + security middleware ------------------------------------------
const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy':
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  const origin = req.headers.origin;
  if (origin && ORIGINS.includes(origin)) {
    res.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE',
      Vary: 'Origin',
    });
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (!SAFE.includes(req.method) && origin && !ORIGINS.includes(origin)) return res.status(403).json({ error: 'Bad origin' });
  next();
});

app.use('/api', express.json({ limit: '50kb' }));
app.use('/api', (req, res, next) => {
  const m = /(?:^|;\s*)sid=([\w-]+)/.exec(req.headers.cookie || '');
  req.user = m
    ? db.prepare(
        'SELECT u.id, u.email, u.name, s.csrf, s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?'
      ).get(sha(m[1]), now()) || null
    : null;
  next();
});

function protect(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in' });
  if (!SAFE.includes(req.method)) {
    const sent = Buffer.from(String(req.headers['x-csrf-token'] || ''));
    const want = Buffer.from(req.user.csrf);
    if (sent.length !== want.length || !crypto.timingSafeEqual(sent, want)) return res.status(403).json({ error: 'Bad CSRF token' });
  }
  next();
}

// ---- auth ----------------------------------------------------------------
function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now());
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sha(token), userId, csrf, new Date(Date.now() + 7 * 864e5).toISOString());
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 864e5, path: '/' });
  return csrf;
}

app.post('/api/register', async (req, res) => {
  const b = req.body || {};
  limit(`auth:${req.ip}`, 10, 60000);
  const email = str(b.email, 'Email', 5, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) bad('Enter a valid email');
  const name = str(b.name, 'Name', 2, 40);
  const password = str(b.password, 'Password', 10, 128, false);
  let id;
  try {
    id = Number(db.prepare('INSERT INTO users(email, name, pw_hash, created_at) VALUES(?,?,?,?)').run(email, name, await argon2.hash(password), now()).lastInsertRowid);
  } catch (e) {
    if (String(e.code).startsWith('SQLITE_CONSTRAINT')) bad('Email already registered', 409);
    throw e;
  }
  res.status(201).json({ user: { id, name, email, csrf: startSession(res, id) } });
});

app.post('/api/login', async (req, res) => {
  const b = req.body || {};
  limit(`auth:${req.ip}`, 10, 60000);
  const email = str(b.email, 'Email', 5, 254).toLowerCase();
  const password = str(b.password, 'Password', 1, 128, false);
  limit(`login:${email}`, 5, 60000);
  const row = db.prepare('SELECT id, name, pw_hash FROM users WHERE email=?').get(email);
  let ok = false;
  try {
    ok = await argon2.verify(row ? row.pw_hash : await DUMMY, password);
  } catch {
    ok = false;
  }
  if (!row || !ok) bad('Wrong email or password', 401);
  res.json({ user: { id: row.id, name: row.name, email, csrf: startSession(res, row.id) } });
});

app.post('/api/logout', protect, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.user.token_hash);
  res.clearCookie('sid', { path: '/' });
  res.sendStatus(204);
});

app.get('/api/me', (req, res) => {
  const u = req.user;
  res.json({ user: u ? { id: u.id, name: u.name, email: u.email, csrf: u.csrf } : null });
});

// ---- recipes -------------------------------------------------------------
function parseRecipe(b) {
  const title = str(b.title, 'Title', 3, 120);
  const description = b.description == null || b.description === '' ? '' : str(b.description, 'Description', 0, 1000);
  const servings = int(b.servings, 'Servings', 1, 100);
  const cook_minutes = int(b.cook_minutes, 'Cook time', 1, 2880);
  if (!Array.isArray(b.ingredients) || b.ingredients.length < 1 || b.ingredients.length > 60) bad('Add 1 to 60 ingredients');
  const ingredients = b.ingredients.map((i) => {
    i = i || {};
    const name = str(i.name, 'Ingredient name', 1, 80);
    const unit = i.unit == null ? '' : str(i.unit, 'Unit', 0, 20).toLowerCase();
    let qty = null;
    if (i.qty != null && String(i.qty).trim() !== '') {
      qty = parseQty(i.qty);
      if (Number.isNaN(qty)) bad(`Quantity for "${name}" must be a number like 2, 1.5 or 1 1/2`);
    }
    return { name, qty, unit };
  });
  if (!Array.isArray(b.steps) || b.steps.length < 1 || b.steps.length > 40) bad('Add 1 to 40 steps');
  const steps = b.steps.map((s) => str(s, 'Step', 1, 1000));
  if (b.tags != null && (!Array.isArray(b.tags) || b.tags.length > 8)) bad('Use up to 8 tags');
  const tags = [...new Set((b.tags || []).map((t) => str(t, 'Tag', 1, 24).toLowerCase()))];
  if (!tags.every((t) => TAG_RE.test(t))) bad('Tags may only use letters, numbers, spaces and dashes');
  return { title, description, servings, cook_minutes, ingredients, steps, tags };
}

function placeholders(n) {
  return Array(n).fill('?').join(',');
}

app.get('/api/tags', (req, res) => {
  res.json(db.prepare('SELECT tag, COUNT(*) AS n FROM recipe_tags GROUP BY tag ORDER BY n DESC, tag LIMIT 30').all());
});

app.get('/api/recipes', (req, res) => {
  const qs = req.query;
  const words = (typeof qs.q === 'string' ? qs.q.match(/[\p{L}\p{N}]+/gu) : null) || [];
  const tag = typeof qs.tag === 'string' && TAG_RE.test(qs.tag) ? qs.tag : null;
  const max = /^\d{1,4}$/.test(qs.max) ? Number(qs.max) : null;
  const page = /^\d{1,6}$/.test(qs.page) && Number(qs.page) > 0 ? Number(qs.page) : 1;
  const fav = qs.fav === '1';
  if (fav && !req.user) bad('Please log in', 401);

  // Only the filters that are present are added, and every value is bound as a parameter.
  const conds = [];
  const p = {};
  if (words.length) {
    // FTS5 syntax is picky; reduce input to quoted prefix tokens so no operator can sneak in.
    conds.push('r.id IN (SELECT rowid FROM recipes_fts WHERE recipes_fts MATCH @fts)');
    p.fts = words.slice(0, 8).map((w) => `"${w}"*`).join(' ');
  }
  if (tag) { conds.push('r.id IN (SELECT recipe_id FROM recipe_tags WHERE tag=@tag)'); p.tag = tag; }
  if (max) { conds.push('r.cook_minutes<=@max'); p.max = max; }
  if (fav) { conds.push('r.id IN (SELECT recipe_id FROM favorites WHERE user_id=@uid)'); p.uid = req.user.id; }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

  const total = db.prepare(`SELECT COUNT(*) FROM recipes r ${where}`).pluck().get(p);
  const items = db.prepare(`
    SELECT r.id, r.title, r.photo, r.cook_minutes, r.servings,
      (SELECT AVG(stars) FROM ratings WHERE recipe_id=r.id) AS avg_rating,
      (SELECT COUNT(*) FROM ratings WHERE recipe_id=r.id) AS rating_count
    FROM recipes r ${where} ORDER BY r.id DESC LIMIT @limit OFFSET @offset`
  ).all({ ...p, limit: PAGE, offset: (page - 1) * PAGE });

  // Tags and favorites for the whole page in one query each (no N+1).
  if (items.length) {
    const ids = items.map((r) => r.id);
    const tagsBy = {};
    for (const t of db.prepare(`SELECT recipe_id, tag FROM recipe_tags WHERE recipe_id IN (${placeholders(ids.length)}) ORDER BY tag`).all(...ids)) {
      (tagsBy[t.recipe_id] ||= []).push(t.tag);
    }
    const favs = new Set(req.user
      ? db.prepare(`SELECT recipe_id FROM favorites WHERE user_id=? AND recipe_id IN (${placeholders(ids.length)})`).pluck().all(req.user.id, ...ids)
      : []);
    for (const r of items) {
      r.tags = tagsBy[r.id] || [];
      r.is_fav = favs.has(r.id);
    }
  }
  res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / PAGE)) });
});

app.get('/api/recipes/:id', (req, res) => {
  const id = int(req.params.id, 'Recipe id', 1, 2 ** 31 - 1);
  const uid = req.user ? req.user.id : 0;
  const r = db.prepare(`
    SELECT r.*, u.name AS author,
      (SELECT AVG(stars) FROM ratings WHERE recipe_id=r.id) AS avg_rating,
      (SELECT COUNT(*) FROM ratings WHERE recipe_id=r.id) AS rating_count,
      (SELECT stars FROM ratings WHERE recipe_id=r.id AND user_id=?) AS my_rating,
      EXISTS(SELECT 1 FROM favorites WHERE recipe_id=r.id AND user_id=?) AS is_fav
    FROM recipes r JOIN users u ON u.id=r.user_id WHERE r.id=?`).get(uid, uid, id);
  if (!r) bad('Recipe not found', 404);
  r.owner = r.user_id === uid;
  delete r.user_id;
  r.is_fav = !!r.is_fav;
  r.steps = JSON.parse(r.steps);
  r.ingredients = db.prepare('SELECT name, qty, unit FROM ingredients WHERE recipe_id=? ORDER BY pos').all(id);
  r.tags = db.prepare('SELECT tag FROM recipe_tags WHERE recipe_id=? ORDER BY tag').pluck().all(id);
  r.comments = db.prepare(`
    SELECT c.id, c.body, c.created_at, u.name AS author, c.user_id=? AS mine
    FROM comments c JOIN users u ON u.id=c.user_id WHERE c.recipe_id=? ORDER BY c.id DESC LIMIT 50`).all(uid, id);
  res.json(r);
});

app.post('/api/recipes', protect, (req, res) => {
  limit(`mk:${req.user.id}`, 30, 60000);
  res.status(201).json({ id: createRecipe(req.user.id, parseRecipe(req.body || {})) });
});

function ownRecipe(req) {
  const id = int(req.params.id, 'Recipe id', 1, 2 ** 31 - 1);
  const r = db.prepare('SELECT id, user_id, photo FROM recipes WHERE id=?').get(id);
  if (!r) bad('Recipe not found', 404);
  if (r.user_id !== req.user.id) bad('Not your recipe', 403);
  return r;
}
const dropFile = (name) => name && fs.rmSync(path.join(UPLOADS, path.basename(name)), { force: true });

app.delete('/api/recipes/:id', protect, (req, res) => {
  const r = ownRecipe(req);
  db.transaction(() => {
    db.prepare('DELETE FROM recipes_fts WHERE rowid=?').run(r.id);
    db.prepare('DELETE FROM recipes WHERE id=?').run(r.id);
  })();
  dropFile(r.photo);
  res.sendStatus(204);
});

// Photos: type allow-list on the header, size cap on the parser, then the real type is sniffed from the bytes.
const SIGS = {
  'image/jpeg': ['.jpg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  'image/png': ['.png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  'image/webp': ['.webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
};
const imageType = (req, res, next) => {
  if (!SIGS[req.headers['content-type']]) bad('Photos must be JPEG, PNG or WebP', 415);
  next();
};
app.post('/api/recipes/:id/photo', protect, imageType, express.raw({ type: () => true, limit: '2mb' }), (req, res) => {
  limit(`up:${req.user.id}`, 20, 60000);
  const r = ownRecipe(req);
  const body = req.body;
  const [ext, matches] = SIGS[req.headers['content-type']];
  if (!Buffer.isBuffer(body) || body.length < 12 || !matches(body)) bad('That file is not a valid image of the declared type');
  const name = crypto.randomBytes(16).toString('hex') + ext;
  fs.writeFileSync(path.join(UPLOADS, name), body, { flag: 'wx' });
  db.prepare('UPDATE recipes SET photo=? WHERE id=?').run(name, r.id);
  dropFile(r.photo);
  res.json({ photo: name });
});

// ---- ratings, comments, favorites ---------------------------------------
function recipeId(req) {
  const id = int(req.params.id, 'Recipe id', 1, 2 ** 31 - 1);
  if (!db.prepare('SELECT 1 FROM recipes WHERE id=?').get(id)) bad('Recipe not found', 404);
  return id;
}

app.put('/api/recipes/:id/rating', protect, (req, res) => {
  const id = recipeId(req);
  const stars = int((req.body || {}).stars, 'Rating', 1, 5);
  db.prepare('INSERT INTO ratings(user_id, recipe_id, stars) VALUES(?,?,?) ON CONFLICT(user_id, recipe_id) DO UPDATE SET stars=excluded.stars')
    .run(req.user.id, id, stars);
  res.json(db.prepare('SELECT AVG(stars) AS avg_rating, COUNT(*) AS rating_count FROM ratings WHERE recipe_id=?').get(id));
});

app.post('/api/recipes/:id/comments', protect, (req, res) => {
  limit(`cm:${req.user.id}`, 20, 60000);
  const id = recipeId(req);
  const body = str((req.body || {}).body, 'Comment', 1, 1000);
  const created_at = now();
  const cid = Number(db.prepare('INSERT INTO comments(recipe_id, user_id, body, created_at) VALUES(?,?,?,?)').run(id, req.user.id, body, created_at).lastInsertRowid);
  // Stored raw; the browser renders it with textContent, so markup is shown as text, never parsed.
  res.status(201).json({ id: cid, body, created_at, author: req.user.name, mine: 1 });
});

app.delete('/api/comments/:id', protect, (req, res) => {
  const id = int(req.params.id, 'Comment id', 1, 2 ** 31 - 1);
  const n = db.prepare('DELETE FROM comments WHERE id=? AND user_id=?').run(id, req.user.id).changes;
  if (!n) bad('Comment not found', 404);
  res.sendStatus(204);
});

app.put('/api/favorites/:id', protect, (req, res) => {
  db.prepare('INSERT OR IGNORE INTO favorites(user_id, recipe_id) VALUES(?,?)').run(req.user.id, recipeId(req));
  res.sendStatus(204);
});
app.delete('/api/favorites/:id', protect, (req, res) => {
  db.prepare('DELETE FROM favorites WHERE user_id=? AND recipe_id=?').run(req.user.id, int(req.params.id, 'Recipe id', 1, 2 ** 31 - 1));
  res.sendStatus(204);
});

// ---- planner + shopping list --------------------------------------------
app.get('/api/plan', protect, (req, res) => {
  res.json(db.prepare(`
    SELECT p.id, p.day, p.servings, r.id AS recipe_id, r.title, r.cook_minutes
    FROM plan_items p JOIN recipes r ON r.id=p.recipe_id WHERE p.user_id=? ORDER BY p.day, p.id`).all(req.user.id));
});

app.post('/api/plan', protect, (req, res) => {
  const b = req.body || {};
  const day = int(b.day, 'Day', 0, 6);
  const rid = int(b.recipe_id, 'Recipe', 1, 2 ** 31 - 1);
  const r = db.prepare('SELECT servings FROM recipes WHERE id=?').get(rid);
  if (!r) bad('Recipe not found', 404);
  if (db.prepare('SELECT COUNT(*) FROM plan_items WHERE user_id=?').pluck().get(req.user.id) >= 100) bad('Your plan is full (100 items)');
  const servings = b.servings == null ? r.servings : int(b.servings, 'Servings', 1, 100);
  const id = Number(db.prepare('INSERT INTO plan_items(user_id, day, recipe_id, servings) VALUES(?,?,?,?)').run(req.user.id, day, rid, servings).lastInsertRowid);
  res.status(201).json({ id });
});

app.get('/api/plan/shopping', protect, (req, res) => {
  const rows = db.prepare(`
    SELECT i.name, i.qty, i.unit, i.aisle, p.servings * 1.0 / r.servings AS scale
    FROM plan_items p JOIN recipes r ON r.id=p.recipe_id JOIN ingredients i ON i.recipe_id=r.id
    WHERE p.user_id=?`).all(req.user.id);
  res.json(mergeShopping(rows));
});

app.patch('/api/plan/:id', protect, (req, res) => {
  const id = int(req.params.id, 'Item id', 1, 2 ** 31 - 1);
  const servings = int((req.body || {}).servings, 'Servings', 1, 100);
  if (!db.prepare('UPDATE plan_items SET servings=? WHERE id=? AND user_id=?').run(servings, id, req.user.id).changes) bad('Plan item not found', 404);
  res.sendStatus(204);
});

app.delete('/api/plan/:id', protect, (req, res) => {
  const id = int(req.params.id, 'Item id', 1, 2 ** 31 - 1);
  if (!db.prepare('DELETE FROM plan_items WHERE id=? AND user_id=?').run(id, req.user.id).changes) bad('Plan item not found', 404);
  res.sendStatus(204);
});

// ---- static files, errors ------------------------------------------------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use('/uploads', express.static(UPLOADS, { index: false, dotfiles: 'deny' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  const msg = err.type === 'entity.parse.failed' ? 'Request body is not valid JSON' : err.message;
  res.status(status).json({ error: status >= 500 ? 'Server error' : msg });
});

app.listen(PORT, '127.0.0.1', () => console.log(`plateful on http://localhost:${PORT}`));
