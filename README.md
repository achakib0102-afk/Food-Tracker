# Label Reader

A personal calorie and macro tracker built around European nutrition labels. Reads
Greek, German, Dutch and other EU labels, looks up barcodes, includes a bundled
whole-food reference table, and searches USDA FoodData Central for everything else.

No build step, no framework, no server. Plain HTML, CSS and ES modules.

---

## Deploy to GitHub Pages

1. Create a new repository. It must be **public** for free Pages hosting.
2. Upload every file in this folder, keeping the `icons/` folder intact.
3. Repo **Settings → Pages → Build and deployment**. Source: *Deploy from a branch*.
   Branch: `main`, folder: `/ (root)`. Save.
4. Wait a minute. Your site appears at
   `https://<username>.github.io/<repo>/`

Pages serves over HTTPS, which the service worker and camera access both require.

## Add to your home screen

- **iOS Safari** — open the URL, Share, *Add to Home Screen*.
- **Android Chrome** — open the URL, menu, *Install app* or *Add to Home Screen*.

It then opens without browser chrome and works offline.

## Editing from your phone

Open any file in the repo on github.com, tap the pencil, edit, commit. The site
redeploys in under a minute. If a change doesn't appear, bump the `CACHE` constant
at the top of `sw.js` — the service worker is serving the old cached copy.

---

## Keys

Both are optional and both are entered in the app under **Goal**, not in the code.
They are stored in your browser only.

| Key | What it unlocks | Where to get it | Cost |
|---|---|---|---|
| USDA | Higher rate limit on USDA search | fdc.nal.usda.gov/api-key-signup/ | Free |
| Anthropic | Reading nutrition labels from photos | console.anthropic.com | Billed per use |

Without either key you still get barcode lookup, 118 bundled reference foods,
USDA search on the shared demo key, and manual entry.

**Never commit a key to this repo.** It is public, and GitHub secret scanning will
revoke an exposed Anthropic key. The Anthropic key currently sits in the browser,
which is acceptable for personal use but is the thing a Supabase edge function
would fix later.

---

## How the numbers work

Energy factors follow **EU Regulation 1169/2011 Annex XIV**, which is what EU
labels are calculated from:

| Nutrient | kcal/g |
|---|---|
| Protein | 4 |
| Carbohydrate | 4 |
| Fat | 9 |
| Fibre | 2 |
| Polyols | 2.4 |

Consequences worth knowing:

- **Carbohydrate excludes fibre.** EU labels report it that way; USDA reports total
  carbohydrate *including* fibre. Every reference and USDA value is converted on the
  way in, so all sources are directly comparable. A checkbox under Goal switches the
  display to the Canadian total-carbohydrate convention if you prefer it.
- **Stated kcal wins** over a 4/4/9 calculation. When the two disagree by more than
  10% the app says so — normal for products containing polyols or lots of fibre.
- **Salt, not sodium.** EU labels give salt in grams. Sodium is derived as
  salt ÷ 2.5 and shown in the daily totals.
- **Raw vs cooked** are separate reference entries wherever it matters. Chicken is
  120 kcal/100 g raw and 165 cooked. Weigh it, then pick the matching entry.

---

## Files

```
index.html              shell and all styling
app.js                  all logic
reference.js            118 bundled whole foods
manifest.webmanifest    PWA metadata
sw.js                   offline cache
icons/                  app icons
```

## Data

Everything lives in `localStorage`, per device and per browser. Nothing is
uploaded. Two people using the same URL get entirely separate logs.

Clearing site data wipes it, so use **Export** for a CSV backup now and then.
