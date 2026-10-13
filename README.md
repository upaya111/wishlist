# Wishlist

A one-page wishlist site. You only ever edit `items.js`.

## Files

- `index.html`: the page. You don't need to touch it.
- `items.js`: your title, an optional line of text under it, and every item.
- `images/`: optional. Put photos here if you'd rather not link to them.
- `prices.json`: written automatically by the daily price check. Don't edit it.
- `scripts/check-prices.mjs` and `.github/workflows/check-prices.yml`: the daily price check.

## Adding an item

Open `items.js`, copy one of the `{ ... },` blocks, paste it into the list, and fill it in:

```js
{
  text: "Wool throw blanket",               // what the link says
  url: "https://www.target.com/p/...",      // product page
  price: "$45.00",                          // any text
  photo: "https://...image.jpg",            // or "images/blanket.jpg"
  added: "2026-10-02",                      // YYYY-MM-DD
  note: "Oatmeal or grey",                  // optional, can be ""
},
```

Items are sorted newest first by `added`, so the order you write them in doesn't matter (items with no date go last, in the order you wrote them). Visitors can also sort by price with the "Sort by" menu at the top. The store name ("Target", "Amazon") is filled in automatically from the link.

**Getting a photo URL:** on the product page, long-press (phone) or right-click (computer) the main product image and choose "Copy image address", then paste that as `photo`. If a store blocks that, save the image into `images/` and use `"images/filename.jpg"`. If a photo ever fails to load, a "no image" box shows instead.

**If the page shows no items after an edit,** there's almost always a missing comma or quote mark in `items.js`. Check the block you just added.

## Putting it on GitHub Pages

1. Create a new repository on github.com (for example `wishlist`). It can be public or private; private repos need a paid plan for Pages.
2. On the repo page, click **Add file → Upload files**, drag in `index.html`, `items.js`, `prices.json`, and the `images` and `scripts` folders, then **Commit changes**.
3. Go to **Settings → Pages**. Under "Build and deployment", set Source to **Deploy from a branch**, pick `main` and `/ (root)`, and click **Save**.
4. After a minute or two your site is live at `https://YOUR-USERNAME.github.io/wishlist/`.
5. Turn on the live price check (see "Live prices and stock").

To update later, click `items.js` in the repo, then the pencil icon, make your edits, and commit. The site refreshes within a minute or two. This works from the GitHub mobile site too.

Netlify, Cloudflare Pages, and similar hosts work the same way: upload the folder and you're done.

## Live prices and stock

Once a day, GitHub visits each link, reads the price and stock status if the store makes that readable, and saves the results to `prices.json`. The site then shows:

- the **current price** in place of the one you typed, when the check succeeded in the last 10 days
- "(out of stock)" next to the price, when the store says so
- **your typed price**, when the store couldn't be read

**What to expect:** many stores publish price data in a standard format, including Target, Best Buy, Etsy, most brand sites, and anything built on Shopify, but some block automated visits. Amazon usually does: it tends to show GitHub a "robot check" page, so expect most Amazon items to keep your typed price. Walmart is often similar. Add `live: false` to any item you want the check to skip.

**Turning it on** (one time, after uploading the other files):

1. Your computer probably hides the `.github` folder, so create the workflow file in GitHub instead. On the repo page, click **Add file → Create new file**.
2. For the file name, type `.github/workflows/check-prices.yml` (the slashes create the folders).
3. Paste in the workflow text from the end of this README, then **Commit changes**.
4. Go to the **Actions** tab, click **Check prices** on the left, then **Run workflow** to run it once right away.

When it finishes, click the run and open the **Read prices** step to see a table of which links worked. After that it runs every morning, and again whenever you edit `items.js`. Each run adds a small "Update prices" commit to the repo.

If GitHub ever emails you that the scheduled workflow was disabled, open the Actions tab and re-enable it.

## Privacy

The page includes a `noindex` tag, so search engines are asked not to list it. Anyone with the link can still view it.

## Workflow text

Paste this as `.github/workflows/check-prices.yml`:

```yaml
name: Check prices

on:
  schedule:
    - cron: "17 11 * * *"   # daily, around 7am Eastern
  workflow_dispatch:         # adds a "Run workflow" button on the Actions tab
  push:
    paths:
      - items.js

permissions:
  contents: write

concurrency:
  group: check-prices
  cancel-in-progress: false

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Read prices
        run: node scripts/check-prices.mjs

      - name: Save results
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898283+github-actions[bot]@users.noreply.github.com"
          git add prices.json
          if git diff --cached --quiet; then
            echo "No changes."
          else
            git commit -m "Update prices"
            git pull --rebase -X theirs   # on a clash with another run, keep this newer reading
            git push
          fi
```
