# Architecture

```
  Browser (HTML + vanilla JS, hash routes)
     |  fetch /api/*   cookie sid (httpOnly) + X-CSRF-Token on writes
     |  <img src=/uploads/<random>.jpg|png|webp>
     v
 +--------------------------------------------------------------------+
 | Express (server.js, 127.0.0.1:3000)                                |
 |  middleware: CSP + nosniff -> CORS (localhost) -> Origin check     |
 |              -> JSON parser -> session lookup -> protect (CSRF)    |
 |                                                                    |
 |  auth      recipes + search      ratings/comments/favorites        |
 |  planner + shopping list         photo upload (raw body, sniffed)  |
 |  rate limit (memory)             units.js: qty parse, units, aisles|
 +-----------------+------------------------------+-------------------+
                   |                              |
          SQLite plateful.db (db.js)        uploads/ (local files)
   users sessions recipes ingredients
   recipe_tags ratings comments favorites
   plan_items  recipes_fts (FTS5)
```

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | /api/register | none, rate limited | Create account and session |
| POST | /api/login | none, rate limited | Start session |
| POST | /api/logout | session + CSRF | End session |
| GET | /api/me | optional | Current user and CSRF token, or `null` |
| GET | /api/tags | none | Top tags with counts |
| GET | /api/recipes | none (`fav=1` needs login) | Search/filter: `q`, `tag`, `max` (minutes), `page`, `fav` |
| GET | /api/recipes/{id} | none | Recipe, ingredients, steps, tags, rating, latest 50 comments |
| POST | /api/recipes | session + CSRF | Create recipe |
| DELETE | /api/recipes/{id} | owner + CSRF | Delete recipe and photo |
| POST | /api/recipes/{id}/photo | owner + CSRF | Raw image body (`image/jpeg`, `png`, `webp`, max 2 MB) |
| PUT | /api/recipes/{id}/rating | session + CSRF | Set my rating (1 to 5, one per user) |
| POST | /api/recipes/{id}/comments | session + CSRF | Add comment |
| DELETE | /api/comments/{id} | author + CSRF | Delete own comment |
| PUT / DELETE | /api/favorites/{id} | session + CSRF | Add / remove favorite |
| GET | /api/plan | session | My planned items (day 0 = Monday) |
| POST | /api/plan | session + CSRF | Add `recipe_id` to `day`, optional `servings` |
| PATCH / DELETE | /api/plan/{id} | owner + CSRF | Change servings / remove |
| GET | /api/plan/shopping | session | Merged list grouped by aisle |
| GET | /uploads/{file} | none | Stored photos |

## Database

```sql
users(id PK, email UNIQUE, name, pw_hash, created_at)
sessions(token_hash PK, user_id FK, csrf, expires_at)
recipes(id PK, user_id FK, title, description, servings, cook_minutes,
        steps /*JSON array*/, photo NULL, created_at)          INDEX cook_minutes
ingredients(id PK, recipe_id FK, pos, name, qty REAL NULL, unit, aisle)  INDEX (recipe_id, pos)
recipe_tags(recipe_id FK, tag, PK(recipe_id, tag))             INDEX tag
ratings(user_id FK, recipe_id FK, stars 1..5, PK(user_id, recipe_id))
comments(id PK, recipe_id FK, user_id FK, body, created_at)    INDEX (recipe_id, id)
favorites(user_id FK, recipe_id FK, PK(user_id, recipe_id))
plan_items(id PK, user_id FK, day 0..6, recipe_id FK, servings) INDEX (user_id, day)
recipes_fts USING fts5(title, description, ingredients, tags, tokenize='porter unicode61')
            -- rowid = recipes.id, rebuilt on create, deleted with the recipe
```

All foreign keys cascade on delete. There is one plan per user (Monday to Sunday, no dates).
