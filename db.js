'use strict';
const path = require('node:path');
const Database = require('better-sqlite3');
const { aisleFor } = require('./units');

const db = new Database(path.join(__dirname, 'plateful.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, pw_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recipes(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', servings INTEGER NOT NULL,
  cook_minutes INTEGER NOT NULL, steps TEXT NOT NULL, photo TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS recipes_cook ON recipes(cook_minutes);
CREATE TABLE IF NOT EXISTS ingredients(
  id INTEGER PRIMARY KEY, recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL, name TEXT NOT NULL, qty REAL, unit TEXT NOT NULL DEFAULT '', aisle TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ingredients_recipe ON ingredients(recipe_id, pos);
CREATE TABLE IF NOT EXISTS recipe_tags(
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE, tag TEXT NOT NULL,
  PRIMARY KEY(recipe_id, tag));
CREATE INDEX IF NOT EXISTS recipe_tags_tag ON recipe_tags(tag);
CREATE TABLE IF NOT EXISTS ratings(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5), PRIMARY KEY(user_id, recipe_id));
CREATE INDEX IF NOT EXISTS ratings_recipe ON ratings(recipe_id);
CREATE TABLE IF NOT EXISTS comments(
  id INTEGER PRIMARY KEY, recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS comments_recipe ON comments(recipe_id, id);
CREATE TABLE IF NOT EXISTS favorites(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE, PRIMARY KEY(user_id, recipe_id));
CREATE TABLE IF NOT EXISTS plan_items(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day INTEGER NOT NULL CHECK(day BETWEEN 0 AND 6),
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE, servings INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS plan_user ON plan_items(user_id, day);
CREATE VIRTUAL TABLE IF NOT EXISTS recipes_fts USING fts5(title, description, ingredients, tags, tokenize='porter unicode61');
`);

// The FTS row shares its rowid with the recipe id and is rebuilt from the normal tables.
function indexRecipe(id) {
  db.prepare('DELETE FROM recipes_fts WHERE rowid=?').run(id);
  db.prepare(`INSERT INTO recipes_fts(rowid, title, description, ingredients, tags)
    SELECT r.id, r.title, r.description,
      (SELECT group_concat(name, ' ') FROM ingredients WHERE recipe_id=r.id),
      (SELECT group_concat(tag, ' ') FROM recipe_tags WHERE recipe_id=r.id)
    FROM recipes r WHERE r.id=?`).run(id);
}

// r: {title, description, servings, cook_minutes, tags[], ingredients[{name, qty, unit}], steps[]} (already validated)
const createRecipe = db.transaction((userId, r) => {
  const id = Number(db.prepare(
    'INSERT INTO recipes(user_id, title, description, servings, cook_minutes, steps, created_at) VALUES(?,?,?,?,?,?,?)'
  ).run(userId, r.title, r.description, r.servings, r.cook_minutes, JSON.stringify(r.steps), new Date().toISOString()).lastInsertRowid);
  const addIng = db.prepare('INSERT INTO ingredients(recipe_id, pos, name, qty, unit, aisle) VALUES(?,?,?,?,?,?)');
  r.ingredients.forEach((i, n) => addIng.run(id, n, i.name, i.qty, i.unit, aisleFor(i.name)));
  const addTag = db.prepare('INSERT INTO recipe_tags(recipe_id, tag) VALUES(?,?)');
  for (const t of r.tags) addTag.run(id, t);
  indexRecipe(id);
  return id;
});

module.exports = { db, createRecipe, indexRecipe };
