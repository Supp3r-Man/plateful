# Steps

1. **Schema.** Normal tables for recipes, ingredients and tags, plus an FTS5 table that shares its rowid with the recipe id and is rebuilt when a recipe is created.
2. **Auth.** argon2 hashes, random session token stored only as SHA-256, httpOnly SameSite=Lax cookie, per-session CSRF token on every write, Origin allow-list, in-memory rate limits on register/login.
3. **Recipe create.** One validator for title, servings, cook time, tags, ingredients and steps. Quantities accept `2`, `1.5`, `1/2` and `1 1/2`. Each ingredient gets an aisle guessed from keywords.
4. **Browse and search.** Filters are added to the SQL only when present and always bound as parameters. Search text is reduced to quoted prefix tokens before it reaches `MATCH`. Pages of 12, with tags and favorite flags fetched for the whole page in one query each.
5. **Photos.** Raw request body, content-type allow-list, 2 MB cap, magic-byte check, random server-side filename, served from `/uploads` with `nosniff`.
6. **Ratings, comments, favorites.** Rating is an upsert on `(user, recipe)`. Comments are stored as typed and rendered with `textContent`.
7. **Scaler.** Pure client-side multiply, printed as nice fractions.
8. **Planner.** Items live in `plan_items`. Dragging or the Add button posts `{recipe_id, day}`.
9. **Shopping list.** One join pulls every planned ingredient with a scale factor (planned servings / recipe servings). `units.js` normalizes names and units, sums compatible ones and groups by aisle.
10. **Frontend.** Three static files, hash routing, no innerHTML, strict CSP, print rules in CSS.
11. **Seed.** Three users, 15 recipes, ratings, a few comments and favorites.

## Interview Q&A

**1. FTS5 or LIKE for search?**
`LIKE '%word%'` can't use an index, scans every row, has no stemming and no ranking. FTS5 keeps an inverted index, supports prefix queries, the porter tokenizer matches "tomatoes" to "tomato", and `bm25()` can rank results. The costs are a second table to keep in sync and a query syntax that raises errors on stray quotes, so user text is reduced to quoted tokens. For a few dozen rows LIKE is fine; the design matters once there are thousands.

**2. How are file uploads kept safe?**
Never trust the filename or the client's content-type alone. The server allows three types, caps the body at 2 MB, checks the magic bytes against the declared type, and writes to a random name with an extension it chose. Files are served by a static route with `nosniff` under a CSP, so even a mislabeled file can't run as script. Remaining gaps: no virus scan, no EXIF stripping, no dimension limit.

**3. How is XSS in comments prevented?**
Comments are stored as typed and displayed by setting `textContent`, so `<script>` appears as visible text and is never parsed. The whole UI is built without `innerHTML`. A CSP forbids inline scripts and styles as a second layer. Escaping on output is the right place because the same text can be safe in one context (HTML text) and dangerous in another (an attribute or URL).

**4. Why is unit normalization hard?**
Cups and grams measure different things (volume vs mass) and can't be summed without a density per ingredient, so merging is only done within a dimension. Known units convert to a base (g or ml). If every entry used the same unit it stays in that unit; mixed units fall back to metric. Unknown units like "clove" only merge with themselves, and names are matched after lowercasing and a crude singularization. Real systems need a pantry database; this is a good-enough heuristic.

**5. Where could N+1 queries appear, and how are they avoided?**
Listing 12 recipes and then querying tags, ratings and favorites for each would be 1 + 36 queries. Ratings come from correlated subqueries in the main query, and tags and favorites are fetched for all page ids with one `IN (...)` query each. The shopping list is one join across plan items, recipes and ingredients, not a loop per item.

**6. How does pagination work and what are its limits?**
`LIMIT 12 OFFSET (page-1)*12` with a total count for "page x of y". It is simple and allows jumping to a page, but large offsets still scan skipped rows and results can shift if rows are added between page loads. Keyset pagination (`WHERE id < last_id`) fixes both at the cost of no random page access.

**7. How would you handle images properly in production?**
Re-encode every upload (for example with sharp) to strip metadata and neutralize polyglot files, generate a few sizes for thumbnails and `srcset`, store on object storage behind a CDN, add `Cache-Control` with content-hashed names, and set pixel-dimension limits to prevent decompression bombs. Here images are stored as-is on disk and the same file is used for thumbnails.

**8. Why cookie sessions with a CSRF token?**
An httpOnly cookie can't be read by injected script and a session can be revoked by deleting a row. Because browsers attach cookies automatically, writes need proof the request came from this app: SameSite=Lax, an Origin allow-list, and a per-session token in a custom header that a cross-site page can't set. Auth endpoints are also rate limited per IP and per email, and unknown emails still burn an argon2 verification so timing doesn't reveal accounts.
