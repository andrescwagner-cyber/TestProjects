# Meal Planner 3.0 — put it on your phone

**Version 3.0** — 60 recipes by category, folding sections, how-to links.

A weekly meal planner and grocery list that behaves like a phone app: its own
icon on your home screen, full screen, works with no signal in the shop.

Sixty recipes built in, sorted by category. No App Store, no account, no
monthly fee, nothing to install on your computer.

---

## Part 1 — Put it online (about 5 minutes)

You need the folder this file came in. Keep every file together — the app is
made of several files that reference each other.

### Step 1 — Make a free Netlify account

1. Go to **[netlify.com](https://www.netlify.com)** and click **Sign up**.
2. Sign up with your email (or your Google account — whichever is easier).
3. No credit card is asked for. The free tier is far more than this app needs.

### Step 2 — Drag the folder onto Netlify

1. Once you're signed in, go to **[app.netlify.com/drop](https://app.netlify.com/drop)**.
2. You'll see a large dashed box that says *"Drag and drop your project folder here"*.
3. Drag the **whole `meal-planner-v3.0` folder** from your computer into that box.
   Drag the folder itself — not the files inside it.
4. Wait about 20 seconds. You'll see "Deploying…" and then a success screen.

**What you should see:** a web address at the top of the page like
`https://extraordinary-kitten-4f21a9.netlify.app`. That is your app. It's live.

> **Tip:** that random name is just a default. Click **Site configuration →
> Change site name** to rename it to something like `andres-meals`, which gives
> you `https://andres-meals.netlify.app`. Easier to type on a phone.

### Step 3 — Put it on your home screen

Open that web address **on your phone**, then:

**iPhone (Safari):**

1. Tap the **Share** button (the square with an arrow pointing up, at the bottom).
2. Scroll down the list and tap **Add to Home Screen**.
3. Tap **Add** in the top right.

**Android (Chrome):**

1. Tap the **⋮** menu (three dots, top right).
2. Tap **Add to Home screen** (or **Install app** if that's offered).
3. Tap **Add** / **Install**.

**What you should see:** a dark shopping-basket icon called **Meals** on your
home screen. Tap it — it opens full screen with no address bar, exactly like a
normal app.

> **Do this step rather than just bookmarking it.** On iPhone, Safari deletes
> the saved data of websites you haven't opened in about a week. Adding it to
> the home screen protects your recipes from that.

---

## Part 2 — Using it

### First time

Open the app and tap **Add the built-in recipes**. That puts all 60 in, across
eight categories:

| Category | Recipes |
| --- | --- |
| Chicken | 8 |
| Beef & Pork | 8 |
| Seafood | 7 |
| Vegetarian | 8 |
| Pasta | 8 |
| Soups & Stews | 7 |
| Breakfast | 7 |
| Salads & Bowls | 7 |

Each one has a short description so you can tell at a glance what it is. Delete
any you don't want — open the recipe, then **Edit this recipe → Delete**.

### Finding recipes

The row of buttons under the search box filters by category. Tap **Chicken** to
see only chicken, tap **All** to come back. The search box looks at recipe
names, descriptions and ingredients, so searching "lemon" finds everything with
lemon in it.

### Adding your own recipes

**From a link:** Recipes tab → **Add a recipe → From a link** → paste a recipe
URL → **Get the ingredients**. It reads the page, shows you what it found, and
lets you fix anything before saving. (See the troubleshooting note below if this
says it isn't switched on.)

**Typing it in:** Recipes tab → **Add a recipe → Type it in**. Put one
ingredient per line, written normally:

```
1 lb ground beef
2 cloves garlic, minced
1 yellow onion, diced
1 tsp kosher salt
```

Leave *"Automatically move salt, spices and sauces to their own list"* ticked
and the app sorts the seasonings out for you.

### Seeing how a recipe is made

Open any recipe and you'll find **Watch how to make it** and **Search the
web**. Both run a search for that recipe's name, so they keep working as
videos come and go. If the recipe was imported from a link, or you pasted one
into the **Link to the original** field, **Open the original** appears first.

The built-in recipes list ingredients and quantities but no method — these
links are how you get the method.

### Folding sections away

Every section header on the Planner tab, and every aisle on the Grocery tab,
folds shut when you tap it — and stays that way next time you open the app. A
folded header still shows the important bit, so "How many people?" reads
"2 people · 2 each" even when it's closed. On the shopping list, finishing an
aisle lets you fold it out of the way so only what's left is on screen.

### Planning the week

Planner tab has two numbers:

- **People at the table** — how many you're feeding. Defaults to 2.
- **Spare portions per meal** — leave at 0 to cook exactly enough, or raise it
  if you want leftovers for lunch.

The app then spells out exactly what it's buying:

> **2 people** × **3 meals** = each recipe scaled to **2 servings**,
> **6 servings** of food in total.

That sentence appears on both the Planner and the Grocery tab, so the totals are
never a mystery. Each recipe is scaled independently: a recipe written for 4
that you're cooking for 2 is halved; one written for 2 is left alone.

**This week's meals** shows what you've chosen as a short list — number,
name, category, and what it's being scaled to — with an × to drop one. To add
meals, open **Add or change meals**: a searchable list of all your recipes with
the category and serving count on each row. Tap a row to add or remove it.

Can't decide? **Pick meals for me** chooses at random.

### Shopping

The Grocery tab merges everything into one list:

- **Duplicates are added together.** Garlic across three recipes becomes one
  line: `13 cloves Garlic`, with a numbered circle for each recipe that needs
  it. The numbered labels at the top of the list tell you which is which.
- **Numbers, not just colours.** Each recipe gets a number and a colour. The
  number is what identifies it — colours alone are hard to tell apart for some
  people, and two recipes can sit side by side on one line.
- **Amounts read like a recipe would write them.** Halving a recipe gives you
  `1 1/3 tbsp`, never `1/16 cup`. Things you buy whole — cloves, cans, onions —
  round up, because you can't buy 16 1/4 cloves of garlic.
- **Sorted by where things are in the shop** — Produce, Meat & Seafood, Dairy,
  Dry Pantry, Sauces & Seasonings, and anything you added yourself.
- **Tap anywhere on a line** to tick it off. It greys out with a line through it.
- **Your ticks are saved instantly.** Lock your phone, take a call, close the
  app halfway down the frozen aisle — everything is exactly where you left it.
- **Add something that isn't in a recipe** for paper towels, coffee and so on.
  You can type a quantity: `2 rolls paper towels` is understood.
- **Start a new week** clears the plan, your extras and every tick. Your saved
  recipes are kept.

---

## Part 3 — Keeping your recipes safe

Your recipes are stored **on your phone**, not on a server. That's what makes
the app free and instant, but it has one consequence worth understanding: if
you lose the phone, or delete the app, the recipes go with it.

So, once you've added recipes you'd miss:

**Recipes tab → Backup → Save backup file.**

That downloads a small `.json` file. Email it to yourself and it's safe forever.
To restore it — on a new phone, or after a mishap — open the app there and use
**Restore backup**.

### Using it on two devices

Each device keeps its own copy. To copy everything from your phone to a laptop,
export a backup on one and restore it on the other. There's no automatic sync —
that would need accounts and a server, which this deliberately avoids.

---

## Troubleshooting

### "Importing from a link isn't switched on for this site"

The link importer is a small helper that runs on Netlify's servers. It's needed
because browsers aren't allowed to fetch other websites directly.

Netlify's documentation doesn't state whether drag-and-drop deploys include
helpers like this, so it may or may not work on your site. **Everything else in
the app works either way** — typing recipes in is unaffected.

If you want link importing and the drag-and-drop deploy didn't enable it, use
this route instead. It's still all point-and-click, no commands:

1. Go to **[github.com](https://github.com)** and make a free account.
2. Click **+ → New repository**, give it a name, click **Create repository**.
3. On the next page click **uploading an existing file**, then drag in
   *everything inside* the `meal-planner-v3.0` folder. Click **Commit changes**.
4. Back on Netlify: **Add new site → Import an existing project → GitHub**,
   authorise it, and pick the repository you just made.
5. Leave all the build settings blank and click **Deploy**.

That route always deploys the helper. Your site address may change, so add the
new one to your home screen.

### A recipe site refuses to import

Some sites block automated readers, and some build their pages in a way that
can't be read. The app tells you which happened. Copy the ingredient list and
use **Type it in** — it takes under a minute.

### An ingredient landed in the wrong aisle

The app guesses the aisle from the ingredient name. It knows several hundred
foods, but it will occasionally be wrong. Edit the recipe and rename the
ingredient a little, or just remember that stray item. Nothing breaks either way.

Frozen items sit under Dry Pantry — there's no separate frozen section.

### I updated the files — how do I republish?

Go to your site in Netlify, open the **Deploys** tab, and drag the updated
folder onto the deploy area. The app updates the next time you open it.

### The app looks stale after I republish

Close it fully (swipe it away from your app switcher) and reopen. The app keeps
a copy of itself on your phone so it works offline, and it swaps in the new
version on the next launch.

---

## For the curious: what's inside

Nothing here needs editing for normal use.

| File | What it does |
| --- | --- |
| `index.html` | The page structure — the three tabs and all the forms |
| `css/styles.css` | All the styling, including the dark mode that follows your phone |
| `js/app.js` | The controller: tabs, buttons, rendering the three screens |
| `js/store.js` | Saving and loading your data; backup and restore |
| `js/grocery.js` | The maths: parsing ingredients, fractions, scaling, merging |
| `js/data.js` | The word lists: which foods belong in which aisle, unit conversions |
| `js/recipes.js` | The 60 built-in recipes |
| `netlify/functions/scrape-recipe.mjs` | The link importer that runs on Netlify |
| `sw.js` | Makes the app work offline |
| `manifest.webmanifest` | Tells your phone the name and icon to use |
| `netlify.toml` | Netlify settings — no build step, just publish the folder |

There is **no build step and no dependencies**. Nothing to install, nothing to
compile, no `npm install`.

### Adding your own recipes to the built-in set

Open `js/recipes.js` and copy the shape of an existing entry. Set `category` to
one of the names in `CATEGORIES` at the top of that file, or add a new category
to that list first.

### Colours

The eight recipe colours in `css/styles.css` (`--series-1` to `--series-8`) are
chosen so that neighbouring ones stay distinguishable with colour-vision
deficiency, in both light and dark mode — the dark values are separately picked
for the dark background rather than being an automatic flip. Because any two
recipes can land on the same grocery line, colour is never the only signal:
every chip carries its number too.

### Running it on your computer instead

Any static web server works. For example, with Python installed:

```bash
cd meal-planner-v3.0
python3 -m http.server 8788
```

Then open `http://127.0.0.1:8788`. (Link importing won't work this way — that
part only runs on Netlify.)

---

## How it was tested

- **Ingredient maths** — 49 automated checks: fraction formatting
  (`0.33 → 1/3`, `1.5 → 1 1/2`), scaling, cross-unit merging
  (`1 tbsp + 1 tsp = 1 1/3 tbsp`), aisle classification including plurals, and
  whole-item rounding up (`16 1/4 cloves → 17 cloves`).
- **Portion maths** — 21 checks against hand-calculated totals: that 1 lb of
  beef in a 4-serving recipe becomes 1/2 lb for 2 people, that doubling the
  people doubles every quantity, and that merging meals never loses or
  duplicates an ingredient.
- **The link importer** — 31 checks against saved copies of real recipe-page
  markup, its error paths, and a check that it refuses private network
  addresses.
- **The recipe library** — all 660 ingredient lines parsed and their aisles
  reviewed by hand.
- **The app itself** — 27 checks driving a real browser at iPhone screen size,
  in light and dark mode: categories, descriptions, the portion sentence,
  ticking items off, and reloading to prove the ticks come back.
- **The how-to links** — 15 checks: that the search carries the recipe name,
  that titles with an "&" encode correctly, that links open in a new tab, and
  that a `javascript:` URL pasted into the source field is refused rather than
  turned into a tappable link.
- **The planner list and folding sections** — a further 27 checks: that the
  meal list is one readable column of full-width rows, that search narrows it,
  that folded sections and folded aisles stay folded after a reload, and that
  every section header fits on one line at 320px, 390px and 430px wide.

Bugs caught and fixed this way, in order of how bad they'd have been:

1. An invisible dialog overlay was swallowing **every tap on the page** — the
   app would have looked completely frozen on your phone.
2. `2 cloves garlic` and `2 garlic cloves` produced two separate lines instead
   of adding up.
3. **Crushed tomatoes and diced tomatoes merged into one line.** They're
   different products; you'd have bought two tins of the wrong thing.
4. Halving a recipe produced amounts like `1/16 cup` and `1/4 tbsp` that nobody
   can measure.
5. `sushi-grade tuna` was filed under Dry Pantry instead of Meat & Seafood.
