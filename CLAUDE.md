# Wishlist site

A static, single-page wishlist hosted on GitHub Pages. Visitors only view items and click through to stores. It is not a registry: no accounts, no claiming, no forms.

## Files

- `index.html`: the page (inline CSS and JS, no build step, no dependencies).
- `items.js`: the owner's data. Defines `SETTINGS` (title, optional subtitle) and `ITEMS`. This is the file the owner edits.
- `prices.json`: written only by the price check. Never edit it by hand.
- `scripts/check-prices.mjs`: reads each item's URL and records price and stock status. Node 22, no npm packages.
- `.github/workflows/check-prices.yml`: runs the price check daily (11:17 UTC), on manual dispatch, and when `items.js` changes, then commits `prices.json`.
- `images/`: optional local photos, referenced from `items.js` as `"images/name.jpg"`.
- `README.md`: owner-facing instructions for editing through the GitHub website. Keep it in sync if behavior changes.

## Item fields

`text` (link text, required), `url` (required), `price` (free text, fallback), `photo` (URL or `images/` path), `added` (`YYYY-MM-DD`), `note` (optional), `live: false` (skip the price check).

Items sort newest first by `added`. The store name is derived from the URL hostname (`storeName()` in `index.html`; add special cases to `STORE_NAMES`).

## Live prices

`check-prices.mjs` tries, in order: the Shopify `/products/<handle>.js` endpoint, then schema.org JSON-LD `Product`/`Offer`, then `product:price` meta tags, plus an Amazon-specific HTML reader. A failed check keeps the last good reading. The page uses a reading only if it is 10 days old or newer (`MAX_AGE_DAYS`); otherwise it shows the typed `price`. Amazon and Walmart usually block requests from GitHub's servers, which is expected; don't try to work around their bot protection.

## Design constraints (owner's choices)

- Plain web 1.0 look: white background, Times serif, default blue and purple underlined links, a simple table, gray rules. No cards, shadows, rounded corners, icons, or dark mode.
- No flavor text. The subtitle is blank unless the owner sets one.
- Mobile first, and it must also look fine on desktop.
- Only the item name and photo are links. Links open in a new tab.

## Testing locally

- `python -m http.server 8000` in this folder, then open http://localhost:8000. Opening `index.html` directly as a file works, but skips `prices.json`.
- `node scripts/check-prices.mjs` runs the price check locally and rewrites `prices.json`. Revert that change before committing unless it's intended, since the workflow owns the file.

## Deploying (first time)

Confirm with the owner before creating anything on GitHub: the repo name (default `wishlist`), and that it will be public (Pages on a free plan needs a public repo). Also ask whether the three sample items in `items.js` should be replaced first.

0. If `setup/check-prices.yml` exists, move it to `.github/workflows/check-prices.yml` and delete the empty `setup/` folder. (It was delivered outside `.github` because the file transfer tool can't write there.)
1. `gh auth status`. If not logged in, ask the owner to run `gh auth login` themselves, since it's interactive. The token needs the `workflow` scope to push `.github/workflows`; if a push is rejected for that reason, have them run `gh auth refresh -s workflow`.
2. `git init -b main`, then `git add -A` and `git commit -m "Initial wishlist site"`.
3. `gh repo create <name> --public --source . --push`
4. Enable Pages from the main branch root:
   `gh api -X POST repos/<owner>/<name>/pages -f "source[branch]=main" -f "source[path]=/"`
   (HTTP 409 means it's already enabled.)
5. Start the first price check: `gh workflow run check-prices.yml`, then `gh run watch`. The "Read prices" step prints a table of which links worked.
6. Get the live URL: `gh api repos/<owner>/<name>/pages --jq .html_url`. The first build takes a minute or two.

## Updating later

The workflow pushes a `prices.json` commit most days, so always run `git pull --rebase` before pushing. Edit `items.js`, commit, pull, push. The push triggers a price check automatically.

## Owner preferences

The owner's shell is fish, so give commands that work there (no bash-only syntax like `VAR=x cmd` or `$(...)`; fish uses `(...)`). Never begin a sentence with "Worth", and don't sound like a redditor.
