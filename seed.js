'use strict';
const argon2 = require('argon2');
const { db, createRecipe } = require('./db');

const PASSWORD = 'demo-password-123';
const R = (title, description, servings, cook_minutes, tags, ing, steps) => ({
  title, description, servings, cook_minutes, tags, steps,
  ingredients: ing.map(([qty, unit, name]) => ({ qty, unit, name })),
});

const RECIPES = [
  R('Spaghetti Aglio e Olio', 'Garlic, chili and olive oil. The pantry hero.', 4, 20, ['pasta', 'vegetarian', 'quick'], [
    [400, 'g', 'spaghetti'], [6, 'cloves', 'garlic'], [80, 'ml', 'olive oil'], [1, 'tsp', 'chili flakes'], [1, 'bunch', 'parsley'], [null, 'to taste', 'salt'],
  ], ['Boil the spaghetti in well-salted water.', 'Slowly warm sliced garlic and chili in the oil.', 'Toss the pasta in the oil with a splash of pasta water.', 'Finish with chopped parsley.']),
  R('Chicken Tikka Masala', 'Creamy, mildly spiced tomato curry.', 4, 50, ['curry', 'chicken', 'dinner'], [
    [700, 'g', 'chicken thigh'], [200, 'g', 'plain yogurt'], [2, 'tbsp', 'garam masala'], [1, '', 'onion'], [3, 'cloves', 'garlic'], [400, 'g', 'canned tomatoes'], [150, 'ml', 'heavy cream'],
  ], ['Marinate the chicken in yogurt and half the spice for 30 minutes.', 'Sear the chicken and set aside.', 'Cook onion and garlic, add tomatoes and remaining spice, simmer 15 minutes.', 'Add chicken and cream, simmer 10 minutes.']),
  R('Veggie Stir-Fry', 'Whatever is in the crisper, but faster.', 3, 25, ['vegan', 'quick', 'dinner'], [
    [1, '', 'broccoli'], [2, '', 'carrot'], [1, '', 'bell pepper'], [3, 'tbsp', 'soy sauce'], [1, 'tbsp', 'ginger'], [2, 'tbsp', 'vegetable oil'], [250, 'g', 'rice noodles'],
  ], ['Cook the noodles and drain.', 'Stir-fry ginger, then the vegetables on high heat for 5 minutes.', 'Add soy sauce and noodles, toss and serve.']),
  R('Classic Pancakes', 'Fluffy, with an optional banana.', 4, 25, ['breakfast', 'vegetarian'], [
    [250, 'g', 'flour'], [2, 'tbsp', 'sugar'], [2, 'tsp', 'baking powder'], [300, 'ml', 'milk'], [2, '', 'eggs'], [30, 'g', 'butter'],
  ], ['Whisk the dry ingredients.', 'Whisk milk, eggs and melted butter, then fold into the dry mix.', 'Cook ladlefuls in a buttered pan until bubbles form, flip once.']),
  R('Black Bean Tacos', 'Ten-minute filling, hours of smug.', 4, 30, ['vegan', 'mexican', 'quick'], [
    [2, 'cans', 'black beans'], [8, '', 'corn tortillas'], [1, '', 'avocado'], [1, '', 'lime'], [1, 'tsp', 'ground cumin'], [0.5, '', 'red onion'], [1, 'bunch', 'cilantro'],
  ], ['Simmer beans with cumin and a splash of water.', 'Warm the tortillas in a dry pan.', 'Fill with beans, sliced avocado, onion and cilantro, then squeeze lime over.']),
  R('Tomato Basil Soup', 'Smooth, bright, great with grilled cheese.', 4, 40, ['soup', 'vegetarian'], [
    [800, 'g', 'canned tomatoes'], [1, '', 'onion'], [3, 'cloves', 'garlic'], [500, 'ml', 'vegetable stock'], [1, 'bunch', 'basil'], [2, 'tbsp', 'olive oil'], [100, 'ml', 'cream'],
  ], ['Soften onion and garlic in oil.', 'Add tomatoes and stock, simmer 20 minutes.', 'Blend with the basil, stir in cream and season.']),
  R('Lemon Herb Salmon', 'One tray, one lemon, minimal dishes.', 2, 25, ['fish', 'dinner', 'gluten-free'], [
    [2, '', 'salmon fillets'], [1, '', 'lemon'], [2, 'tbsp', 'olive oil'], [2, 'cloves', 'garlic'], [1, 'tbsp', 'dill'], [null, 'to taste', 'salt'],
  ], ['Heat the oven to 200C.', 'Rub the salmon with oil, garlic, dill and salt, top with lemon slices.', 'Bake for 12 to 15 minutes.']),
  R('Greek Salad', 'No lettuce, no regrets.', 4, 15, ['salad', 'vegetarian', 'quick'], [
    [4, '', 'tomatoes'], [1, '', 'cucumber'], [1, '', 'red onion'], [200, 'g', 'feta cheese'], [100, 'g', 'olives'], [3, 'tbsp', 'olive oil'], [1, 'tsp', 'dried oregano'],
  ], ['Chop the vegetables into chunks.', 'Add olives and top with a slab of feta.', 'Drizzle with oil and sprinkle with oregano.']),
  R('Beef Chili', 'Better on day two.', 6, 90, ['beef', 'dinner', 'make-ahead'], [
    [500, 'g', 'ground beef'], [2, 'cans', 'kidney beans'], [800, 'g', 'canned tomatoes'], [1, '', 'onion'], [2, 'tbsp', 'chili powder'], [1, 'tsp', 'ground cumin'], [1, '', 'bell pepper'],
  ], ['Brown the beef with onion and pepper.', 'Add spices, tomatoes and beans.', 'Simmer gently for an hour, stirring now and then.']),
  R('Mushroom Risotto', 'Stir, sip, stir, sip.', 4, 45, ['rice', 'vegetarian', 'dinner'], [
    [300, 'g', 'arborio rice'], [400, 'g', 'mushrooms'], [1, 'l', 'vegetable stock'], [1, '', 'onion'], [100, 'ml', 'white wine'], [50, 'g', 'parmesan'], [30, 'g', 'butter'],
  ], ['Brown the mushrooms and set aside.', 'Cook onion, toast the rice, add wine.', 'Add hot stock a ladle at a time for about 20 minutes.', 'Stir in mushrooms, butter and parmesan.']),
  R('Banana Bread', 'For bananas that have given up.', 8, 75, ['baking', 'breakfast', 'vegetarian'], [
    [3, '', 'ripe bananas'], [200, 'g', 'flour'], [100, 'g', 'sugar'], [80, 'g', 'butter'], [1, '', 'egg'], [1, 'tsp', 'baking soda'],
  ], ['Heat the oven to 175C and grease a loaf tin.', 'Mash the bananas and mix in melted butter, sugar and egg.', 'Fold in flour and baking soda.', 'Bake for 55 to 60 minutes.']),
  R('Chickpea Curry', 'Weeknight curry from the cupboard.', 4, 35, ['curry', 'vegan', 'dinner'], [
    [2, 'cans', 'chickpeas'], [400, 'ml', 'coconut milk'], [1, '', 'onion'], [2, 'cloves', 'garlic'], [2, 'tbsp', 'curry powder'], [200, 'g', 'spinach'], [300, 'g', 'basmati rice'],
  ], ['Cook the onion and garlic with the curry powder.', 'Add chickpeas and coconut milk, simmer 15 minutes.', 'Stir in spinach until wilted and serve over rice.']),
  R('Caprese Sandwich', 'Lunch that looks like effort.', 2, 10, ['sandwich', 'vegetarian', 'quick'], [
    [1, '', 'baguette'], [2, '', 'tomatoes'], [200, 'g', 'mozzarella'], [1, 'bunch', 'basil'], [1, 'tbsp', 'olive oil'],
  ], ['Slice the baguette and tomatoes.', 'Layer mozzarella, tomato and basil, drizzle with oil.']),
  R('Shakshuka', 'Eggs poached in spicy tomato sauce.', 3, 30, ['eggs', 'breakfast', 'vegetarian'], [
    [6, '', 'eggs'], [800, 'g', 'canned tomatoes'], [1, '', 'onion'], [1, '', 'bell pepper'], [2, 'tsp', 'paprika'], [1, 'tsp', 'ground cumin'], [2, 'cloves', 'garlic'],
  ], ['Cook onion, pepper and garlic with the spices.', 'Add tomatoes and simmer 10 minutes.', 'Make wells, crack in the eggs, cover and cook until just set.']),
  R('Overnight Oats', 'Breakfast made by past you.', 2, 5, ['breakfast', 'vegetarian', 'make-ahead'], [
    [100, 'g', 'rolled oats'], [250, 'ml', 'milk'], [100, 'g', 'yogurt'], [2, 'tbsp', 'honey'], [100, 'g', 'blueberries'],
  ], ['Stir oats, milk, yogurt and honey in a jar.', 'Refrigerate overnight.', 'Top with blueberries.']),
];

const COMMENTS = ['Made this twice already.', 'Halved the salt and it was still great.', 'Kids approved.', 'Even better the next day.', 'Needs more garlic, but I say that about everything.'];

(async () => {
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get('demo@example.com')) return console.log('Already seeded.');
  const hash = await argon2.hash(PASSWORD);
  const addUser = db.prepare('INSERT INTO users(email, name, pw_hash, created_at) VALUES(?,?,?,?)');
  const users = [['demo@example.com', 'Demo'], ['ana@example.com', 'Ana'], ['ben@example.com', 'Ben']]
    .map(([email, name]) => Number(addUser.run(email, name, hash, new Date().toISOString()).lastInsertRowid));

  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rate = db.prepare('INSERT INTO ratings(user_id, recipe_id, stars) VALUES(?,?,?)');
  const comment = db.prepare('INSERT INTO comments(recipe_id, user_id, body, created_at) VALUES(?,?,?,?)');
  const fav = db.prepare('INSERT INTO favorites(user_id, recipe_id) VALUES(?,?)');

  RECIPES.forEach((r, n) => {
    const id = createRecipe(users[n % users.length], r);
    for (const u of users) if (rnd() < 0.7) rate.run(u, id, 3 + Math.floor(rnd() * 3));
    if (rnd() < 0.6) comment.run(id, users[1 + Math.floor(rnd() * 2)], COMMENTS[Math.floor(rnd() * COMMENTS.length)], new Date().toISOString());
    if (n < 3) fav.run(users[0], id);
  });
  console.log(`Seeded ${RECIPES.length} recipes. Log in as demo@example.com / ${PASSWORD}`);
})();
