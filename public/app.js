'use strict';
const $ = (s) => document.querySelector(s);
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO = 2 * 1024 * 1024;
let me = null; // {id, name, email, csrf} when logged in

// Elements are built with properties and textContent only, so user text can never become markup.
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v == null) continue;
    if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  e.append(...kids.flat().filter((k) => k != null && k !== false));
  return e;
}

const say = (text) => ($('#msg').textContent = text);
const act = (fn) => async (...a) => {
  try { await fn(...a); } catch (e) { say(e.message); }
};
const go = (hash) => (location.hash === hash ? route() : (location.hash = hash));

async function api(path, { method = 'GET', body, raw } = {}) {
  const headers = {};
  if (me) headers['X-CSRF-Token'] = me.csrf;
  if (raw) headers['Content-Type'] = raw.type;
  else if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch('/api' + path, {
    method, headers, credentials: 'same-origin',
    body: raw || (body !== undefined ? JSON.stringify(body) : undefined),
  });
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

// ---- formatting ----------------------------------------------------------
const FR = [[0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, '']];
function fmt(n) {
  let whole = Math.floor(n);
  const f = n - whole;
  const [val, sym] = FR.reduce((a, b) => (Math.abs(b[0] - f) < Math.abs(a[0] - f) ? b : a));
  if (Math.abs(val - f) > 0.04) return String(Math.round(n * 100) / 100);
  if (val === 1) whole += 1;
  return [whole || (sym ? '' : '0'), sym].filter(Boolean).join(' ');
}
const ingText = (i, k = 1) =>
  i.qty == null ? `${i.name}${i.unit ? ` (${i.unit})` : ''}` : [fmt(i.qty * k), i.unit, i.name].filter(Boolean).join(' ');
const ratingText = (r) => (r.rating_count ? `★ ${r.avg_rating.toFixed(1)} (${r.rating_count})` : 'No ratings yet');

function show(title, ...nodes) {
  document.title = `${title} · plateful`;
  $('#view').replaceChildren(h('h1', { tabIndex: -1 }, title), ...nodes);
  $('#view h1').focus();
}

function checkPhoto(file) {
  if (!PHOTO_TYPES.includes(file.type) || file.size > MAX_PHOTO) throw new Error('Photo must be JPEG, PNG or WebP and under 2 MB');
}
async function uploadPhoto(id, file) {
  if (!file) return;
  checkPhoto(file);
  await api(`/recipes/${id}/photo`, { method: 'POST', raw: file });
}

// ---- nav + router --------------------------------------------------------
function renderNav() {
  const links = [['#/', 'Browse']];
  if (me) links.push(['#/favorites', 'Favorites'], ['#/planner', 'Planner'], ['#/new', 'Add recipe']);
  const cur = (location.hash || '#/').split('?')[0];
  $('#nav').replaceChildren(
    ...links.map(([href, text]) => h('a', { href, 'aria-current': cur === href ? 'page' : null }, text)),
    me
      ? h('button', { type: 'button', className: 'ghost', onclick: act(async () => { await api('/logout', { method: 'POST' }); me = null; go('#/'); }) }, `Log out (${me.name})`)
      : h('a', { href: '#/login' }, 'Log in'));
}

async function route() {
  const [path, qs = ''] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(qs);
  say('');
  renderNav();
  try {
    let m;
    if (path === '/') await browse(params, false);
    else if (path === '/login') loginPage();
    else if ((m = path.match(/^\/recipe\/(\d+)$/))) await recipePage(Number(m[1]));
    else if (['/favorites', '/new', '/planner'].includes(path)) {
      if (!me) return go('#/login');
      if (path === '/favorites') await browse(params, true);
      else if (path === '/new') newRecipe();
      else await planner();
    } else show('Not found', h('p', {}, 'Nothing here.'));
  } catch (e) {
    say(e.message);
  }
}
window.addEventListener('hashchange', route);

// ---- login / register ----------------------------------------------------
function loginPage() {
  let reg = false;
  const nameBox = h('input', { name: 'name', maxLength: 40, autocomplete: 'name' });
  const nameLabel = h('label', { hidden: true }, 'Name ', nameBox);
  const pw = h('input', { name: 'password', type: 'password', required: true, minLength: 10, maxLength: 128, autocomplete: 'current-password' });
  const submit = h('button', {}, 'Log in');
  const toggle = h('button', { type: 'button', className: 'link' }, 'Need an account? Register');
  toggle.onclick = () => {
    reg = !reg;
    nameLabel.hidden = !reg;
    nameBox.required = reg;
    pw.autocomplete = reg ? 'new-password' : 'current-password';
    submit.textContent = reg ? 'Create account' : 'Log in';
    toggle.textContent = reg ? 'Have an account? Log in' : 'Need an account? Register';
  };
  const form = h('form', {
    className: 'card narrow',
    onsubmit: act(async (e) => {
      e.preventDefault();
      const d = await api(reg ? '/register' : '/login', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      me = d.user;
      go('#/');
    }),
  },
  h('label', {}, 'Email ', h('input', { name: 'email', type: 'email', required: true, maxLength: 254, autocomplete: 'email' })),
  nameLabel,
  h('label', {}, 'Password (10+ characters) ', pw),
  submit, toggle);
  show('Log in or register', form);
}

// ---- browse --------------------------------------------------------------
function card(r) {
  const btn = me && h('button', { type: 'button', className: 'fav ghost', 'aria-pressed': String(r.is_fav), 'aria-label': `Favorite ${r.title}` }, r.is_fav ? '♥' : '♡');
  if (btn) {
    btn.onclick = act(async () => {
      const on = btn.getAttribute('aria-pressed') !== 'true';
      await api(`/favorites/${r.id}`, { method: on ? 'PUT' : 'DELETE' });
      btn.setAttribute('aria-pressed', String(on));
      btn.textContent = on ? '♥' : '♡';
    });
  }
  return h('li', { className: 'card' },
    r.photo ? h('img', { src: `/uploads/${r.photo}`, alt: '', loading: 'lazy', className: 'thumb' }) : h('div', { className: 'thumb ph' }, 'No photo'),
    h('h2', {}, h('a', { href: `#/recipe/${r.id}` }, r.title)),
    h('p', { className: 'meta' }, `${r.cook_minutes} min · serves ${r.servings} · ${ratingText(r)}`),
    h('p', {}, r.tags.map((t) => h('a', { className: 'chip', href: `#/?tag=${encodeURIComponent(t)}` }, t))),
    btn);
}

async function browse(params, favs) {
  const p = new URLSearchParams(params);
  if (favs) p.set('fav', '1');
  const [data, tags] = await Promise.all([api('/recipes?' + p), favs ? [] : api('/tags')]);
  const base = favs ? '#/favorites' : '#/';
  const href = (over) => {
    const n = new URLSearchParams(params);
    for (const [k, v] of Object.entries(over)) (v ? n.set(k, v) : n.delete(k));
    const s = n.toString();
    return base + (s ? '?' + s : '');
  };
  const form = h('form', {
    className: 'filters', role: 'search',
    onsubmit: (e) => {
      e.preventDefault();
      const f = new FormData(form);
      go(href({ q: f.get('q'), max: f.get('max'), page: '' }));
    },
  },
  h('label', {}, 'Search ', h('input', { name: 'q', type: 'search', value: params.get('q') || '', maxLength: 100 })),
  h('label', {}, 'Cook time ', h('select', { name: 'max' },
    [['', 'Any'], ['15', '15 min or less'], ['30', '30 min or less'], ['60', '1 hour or less'], ['120', '2 hours or less']]
      .map(([v, t]) => h('option', { value: v, selected: (params.get('max') || '') === v }, t)))),
  h('button', {}, 'Search'));

  const chips = h('p', { className: 'chips' }, tags.map((t) =>
    h('a', { className: 'chip', href: href({ tag: t.tag, page: '' }), 'aria-current': params.get('tag') === t.tag ? 'true' : null }, t.tag)),
  params.get('tag') && h('a', { href: href({ tag: '', page: '' }) }, 'Clear tag'));

  const pager = h('nav', { className: 'pager', 'aria-label': 'Pages' },
    data.page > 1 && h('a', { href: href({ page: data.page - 1 }) }, '← Previous'),
    h('span', {}, `Page ${data.page} of ${data.pages} · ${data.total} recipes`),
    data.page < data.pages && h('a', { href: href({ page: data.page + 1 }) }, 'Next →'));

  show(favs ? 'Your favorites' : 'Recipes', form, favs ? null : chips,
    data.items.length ? h('ul', { className: 'grid' }, data.items.map(card)) : h('p', {}, 'No recipes found.'), pager);
}

// ---- recipe page ---------------------------------------------------------
async function recipePage(id) {
  const r = await api(`/recipes/${id}`);
  let k = 1;
  const list = h('ul', { className: 'ingredients' });
  const draw = () => list.replaceChildren(...r.ingredients.map((i) => h('li', {}, ingText(i, k))));
  const sv = h('input', {
    type: 'number', id: 'sv', min: 1, max: 100, value: r.servings,
    oninput: () => { const n = Number(sv.value); if (n >= 1 && n <= 100) { k = n / r.servings; draw(); } },
  });
  draw();

  const summary = h('p', { className: 'meta' });
  const setRating = (d) => (summary.textContent = d.rating_count ? `★ ${d.avg_rating.toFixed(1)} from ${d.rating_count} rating${d.rating_count === 1 ? '' : 's'}` : 'No ratings yet');
  setRating(r);

  const commentItem = (c) => {
    const del = c.mine && h('button', { type: 'button', className: 'ghost', onclick: act(async () => { await api(`/comments/${c.id}`, { method: 'DELETE' }); li.remove(); }) }, 'Delete');
    const li = h('li', {}, h('strong', {}, c.author), h('small', {}, ` ${c.created_at.slice(0, 10)}`), h('p', { className: 'body' }, c.body), del);
    return li;
  };
  const clist = h('ul', { className: 'plain' }, r.comments.map(commentItem));

  const fav = me && h('button', { type: 'button', className: 'ghost noprint', 'aria-pressed': String(r.is_fav) }, r.is_fav ? '♥ Favorited' : '♡ Favorite');
  if (fav) {
    fav.onclick = act(async () => {
      const on = fav.getAttribute('aria-pressed') !== 'true';
      await api(`/favorites/${id}`, { method: on ? 'PUT' : 'DELETE' });
      fav.setAttribute('aria-pressed', String(on));
      fav.textContent = on ? '♥ Favorited' : '♡ Favorite';
    });
  }

  const rate = me ? h('fieldset', { className: 'stars noprint' }, h('legend', {}, 'Your rating'),
    [1, 2, 3, 4, 5].map((n) => h('label', {},
      h('input', {
        type: 'radio', name: 'stars', value: n, checked: r.my_rating === n,
        onchange: act(async () => { setRating(await api(`/recipes/${id}/rating`, { method: 'PUT', body: { stars: n } })); say('Rating saved.'); }),
      }), ` ${n}★`)))
    : h('p', { className: 'noprint' }, h('a', { href: '#/login' }, 'Log in'), ' to rate, comment and favorite.');

  const cform = me && h('form', {
    className: 'noprint',
    onsubmit: act(async (e) => {
      e.preventDefault();
      const ta = cform.elements.body;
      clist.prepend(commentItem(await api(`/recipes/${id}/comments`, { method: 'POST', body: { body: ta.value } })));
      ta.value = '';
    }),
  }, h('label', {}, 'Add a comment ', h('textarea', { name: 'body', required: true, maxLength: 1000, rows: 3 })), h('button', {}, 'Post'));

  const del = h('button', { type: 'button', className: 'ghost' }, 'Delete recipe');
  del.onclick = act(async () => {
    if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Really delete?'; return; }
    await api(`/recipes/${id}`, { method: 'DELETE' });
    go('#/');
  });
  const own = r.owner && h('div', { className: 'row noprint' },
    h('label', {}, 'Replace photo ', h('input', { type: 'file', accept: PHOTO_TYPES.join(','), onchange: act(async (e) => { await uploadPhoto(id, e.target.files[0]); await recipePage(id); }) })),
    del);

  show(r.title,
    h('article', { className: 'recipe' },
      r.photo && h('img', { src: `/uploads/${r.photo}`, alt: r.title, className: 'hero' }),
      h('p', { className: 'meta' }, `${r.cook_minutes} min · by ${r.author}`),
      summary,
      r.description && h('p', {}, r.description),
      h('p', {}, r.tags.map((t) => h('a', { className: 'chip', href: `#/?tag=${encodeURIComponent(t)}` }, t))),
      h('div', { className: 'row noprint' }, fav, h('button', { type: 'button', className: 'ghost', onclick: () => window.print() }, 'Print')),
      h('h2', {}, 'Ingredients'),
      h('p', { className: 'scaler' }, h('label', { htmlFor: 'sv' }, 'Servings '), sv),
      list,
      h('h2', {}, 'Steps'),
      h('ol', {}, r.steps.map((s) => h('li', {}, s))),
      own),
    h('section', { className: 'comments' }, h('h2', {}, 'Rating and comments'), rate, h('h3', {}, 'Comments'), cform, clist));
}

// ---- add recipe ----------------------------------------------------------
function newRecipe() {
  const ing = h('div', { className: 'rows' });
  const steps = h('div', { className: 'rows' });
  const rm = (row, what) => h('button', { type: 'button', className: 'ghost', 'aria-label': `Remove ${what}`, onclick: () => row.remove() }, '✕');
  const addIng = () => {
    const row = h('div', { className: 'ing-row' },
      h('input', { 'aria-label': 'Quantity', placeholder: '1 1/2', maxLength: 12 }),
      h('input', { 'aria-label': 'Unit', placeholder: 'cup', maxLength: 20 }),
      h('input', { 'aria-label': 'Ingredient', placeholder: 'flour', required: true, maxLength: 80 }));
    row.append(rm(row, 'ingredient'));
    ing.append(row);
  };
  const addStep = () => {
    const row = h('div', { className: 'ing-row' }, h('textarea', { 'aria-label': 'Step', required: true, maxLength: 1000, rows: 2 }));
    row.append(rm(row, 'step'));
    steps.append(row);
  };
  addIng(); addIng(); addStep();

  const form = h('form', {
    className: 'card',
    onsubmit: act(async (e) => {
      e.preventDefault();
      const f = form.elements;
      const file = f.photo.files[0];
      if (file) checkPhoto(file);
      const { id } = await api('/recipes', {
        method: 'POST',
        body: {
          title: f.title.value, description: f.description.value,
          servings: Number(f.servings.value), cook_minutes: Number(f.cook_minutes.value),
          tags: f.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
          ingredients: [...ing.children].map((r) => ({ qty: r.children[0].value, unit: r.children[1].value, name: r.children[2].value })),
          steps: [...steps.children].map((r) => r.children[0].value),
        },
      });
      try { await uploadPhoto(id, file); } catch (err) { say(`Recipe saved, but the photo failed: ${err.message}`); }
      go(`#/recipe/${id}`);
    }),
  },
  h('label', {}, 'Title ', h('input', { name: 'title', required: true, minLength: 3, maxLength: 120 })),
  h('label', {}, 'Description ', h('textarea', { name: 'description', maxLength: 1000, rows: 2 })),
  h('div', { className: 'two' },
    h('label', {}, 'Servings ', h('input', { name: 'servings', type: 'number', min: 1, max: 100, value: 4, required: true })),
    h('label', {}, 'Cook time (minutes) ', h('input', { name: 'cook_minutes', type: 'number', min: 1, max: 2880, value: 30, required: true }))),
  h('label', {}, 'Tags (comma separated) ', h('input', { name: 'tags', placeholder: 'vegan, quick' })),
  h('fieldset', {}, h('legend', {}, 'Ingredients'), ing, h('button', { type: 'button', className: 'ghost', onclick: addIng }, 'Add ingredient')),
  h('fieldset', {}, h('legend', {}, 'Steps'), steps, h('button', { type: 'button', className: 'ghost', onclick: addStep }, 'Add step')),
  h('label', {}, 'Photo (JPEG, PNG or WebP, up to 2 MB) ', h('input', { name: 'photo', type: 'file', accept: PHOTO_TYPES.join(',') })),
  h('button', {}, 'Save recipe'));
  show('Add a recipe', form);
}

// ---- planner -------------------------------------------------------------
async function planner() {
  let items = await api('/plan');
  const week = h('div', { className: 'week' });
  const picker = h('ul', { className: 'plain picker' });
  const shop = h('div', { className: 'shop', 'aria-live': 'polite' });

  const reload = async () => { items = await api('/plan'); draw(); shop.replaceChildren(); };
  const add = act(async (recipe_id, day) => {
    await api('/plan', { method: 'POST', body: { recipe_id, day } });
    await reload();
    say(`Added to ${DAYS[day]}.`);
  });

  const chip = (i) => {
    const sv = h('input', {
      type: 'number', min: 1, max: 100, value: i.servings, 'aria-label': `Servings for ${i.title}`,
      onchange: act(async () => { await api(`/plan/${i.id}`, { method: 'PATCH', body: { servings: Number(sv.value) } }); shop.replaceChildren(); }),
    });
    return h('li', {}, h('a', { href: `#/recipe/${i.recipe_id}` }, i.title), sv,
      h('button', { type: 'button', className: 'ghost', 'aria-label': `Remove ${i.title} from ${DAYS[i.day]}`, onclick: act(async () => { await api(`/plan/${i.id}`, { method: 'DELETE' }); await reload(); }) }, '✕'));
  };

  function draw() {
    week.replaceChildren(...DAYS.map((name, d) => {
      const col = h('section', { className: 'day', 'aria-labelledby': `day${d}` },
        h('h3', { id: `day${d}` }, name),
        h('ul', { className: 'plain' }, items.filter((i) => i.day === d).map(chip)));
      col.ondragover = (e) => { e.preventDefault(); col.classList.add('over'); };
      col.ondragleave = () => col.classList.remove('over');
      col.ondrop = (e) => {
        e.preventDefault();
        col.classList.remove('over');
        const rid = Number(e.dataTransfer.getData('text/plain'));
        if (rid) add(rid, d);
      };
      return col;
    }));
  }

  const pickerItem = (r) => {
    const sel = h('select', { 'aria-label': `Day for ${r.title}` }, DAYS.map((n, d) => h('option', { value: d }, n)));
    const li = h('li', { draggable: true }, h('span', {}, `${r.title} (${r.cook_minutes} min)`), sel,
      h('button', { type: 'button', onclick: () => add(r.id, Number(sel.value)) }, 'Add'));
    li.ondragstart = (e) => e.dataTransfer.setData('text/plain', String(r.id));
    return li;
  };
  const load = act(async (q) => {
    const d = await api('/recipes?' + new URLSearchParams(q ? { q } : {}));
    picker.replaceChildren(...d.items.map(pickerItem));
  });

  const gen = act(async () => {
    const groups = await api('/plan/shopping');
    if (!groups.length) return say('Plan some recipes first.');
    shop.replaceChildren(...groups.map((g) => h('section', {},
      h('h3', {}, g.aisle),
      h('ul', { className: 'plain' }, g.items.map((it) => h('li', {}, h('label', {}, h('input', { type: 'checkbox' }), ' ' + ingText(it))))))));
  });

  const search = h('form', { role: 'search', className: 'filters', onsubmit: (e) => { e.preventDefault(); load(search.elements.q.value); } },
    h('label', {}, 'Find recipes ', h('input', { name: 'q', type: 'search', maxLength: 100 })), h('button', {}, 'Search'));

  draw();
  show('Meal planner',
    h('p', {}, 'Drag a recipe onto a day, or use the day picker and Add button.'),
    week,
    h('h2', {}, 'Recipes'), search, picker,
    h('h2', {}, 'Shopping list'),
    h('button', { type: 'button', onclick: gen }, 'Generate shopping list'),
    shop);
  await load('');
}

api('/me').then((d) => { me = d.user; }).catch(() => {}).finally(route);
