// Reads each item's product page and saves the price / stock it finds to prices.json.
// Runs daily from .github/workflows/check-prices.yml. Best effort: when a store
// blocks the request or the page has no readable data, the site keeps showing
// the price you typed in items.js.

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const ITEMS_FILE = "items.js";
const OUT_FILE = "prices.json";
const TIMEOUT_MS = 20000;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// ---------- helpers ----------

function toNumber(v) {
  if (v == null) return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const s = String(v).replace(/[^0-9.,]/g, "");
  if (!s) return null;
  // "1,299.00" -> 1299.00 ; "12,99" -> 12.99
  const norm = /,\d{2}$/.test(s) && !s.includes(".") ? s.replace(",", ".") : s.replace(/,/g, "");
  const n = parseFloat(norm);
  return isFinite(n) && n > 0 ? n : null;
}

function stockFrom(v) {
  if (v == null) return null;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  if (/(outofstock|out of stock|out_of_stock|soldout|sold out|discontinued|unavailable)/.test(s)) return false;
  if (/(instock|in stock|in_stock|limitedavailability|onlineonly|instoreonly|preorder|presale|backorder|available)/.test(s)) return true;
  return null;
}

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function looksBlocked(status, html) {
  if ([401, 403, 429, 503].includes(status)) return true;
  return /captcha|robot check|are you a human|access denied|to discuss automated access|px-captcha|cf-chl/i.test(
    html.slice(0, 60000)
  );
}

// ---------- extractors (each returns {price, currency, inStock} or null) ----------

// Shopify stores expose /products/<handle>.js with exact price + availability.
async function fromShopify(url) {
  const u = new URL(url);
  const m = u.pathname.match(/^(.*\/products\/[^/]+?)\/?$/);
  if (!m) return null;
  const res = await get(`${u.origin}${m[1]}.js`, { Accept: "application/json" });
  if (!res || !res.ok) return null;
  let p;
  try { p = JSON.parse(res.text); } catch { return null; }
  if (!p || !Array.isArray(p.variants)) return null;
  const wanted = u.searchParams.get("variant");
  const v = (wanted && p.variants.find((x) => String(x.id) === wanted)) || null;
  if (v) return { price: v.price / 100, currency: null, inStock: !!v.available };
  const avail = p.variants.filter((x) => x.available);
  const pool = avail.length ? avail : p.variants;
  const price = Math.min(...pool.map((x) => x.price)) / 100;
  return { price, currency: null, inStock: !!p.available };
}

// schema.org Product data in <script type="application/ld+json"> — used by most big retailers.
export function fromJsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const products = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    const t = node["@type"];
    const types = Array.isArray(t) ? t : [t];
    if (types.some((x) => /^(Product|ProductGroup|IndividualProduct)$/i.test(String(x)))) products.push(node);
    if (node["@graph"]) walk(node["@graph"]);
    if (node.mainEntity) walk(node.mainEntity);
  };
  for (const b of blocks) {
    try { walk(JSON.parse(b[1].trim())); } catch { /* skip malformed block */ }
  }
  for (const prod of products) {
    let offers = prod.offers || (prod.hasVariant || []).flatMap((v) => v.offers || []);
    if (!offers) continue;
    offers = (Array.isArray(offers) ? offers : [offers]).flatMap((o) =>
      o && o.offers
        ? (Array.isArray(o.offers) ? o.offers : [o.offers])
            .map((c) => ({ priceCurrency: o.priceCurrency, ...c }))
            .concat(o)
        : [o]
    );
    const parsed = offers
      .filter(Boolean)
      .map((o) => ({
        price: toNumber(o.price ?? o.lowPrice ?? o.priceSpecification?.price),
        currency: o.priceCurrency || o.priceSpecification?.priceCurrency || null,
        inStock: stockFrom(o.availability),
      }))
      .filter((o) => o.price != null || o.inStock != null);
    if (!parsed.length) continue;
    const inStock = parsed.filter((o) => o.inStock === true);
    const pool = (inStock.length ? inStock : parsed).filter((o) => o.price != null);
    const best = pool.sort((a, b) => a.price - b.price)[0] || parsed[0];
    const anyStock = parsed.some((o) => o.inStock !== null);
    return {
      price: best.price ?? null,
      currency: best.currency,
      inStock: inStock.length ? true : anyStock ? false : null,
    };
  }
  return null;
}

// <meta property="product:price:amount"> and friends.
export function fromMeta(html) {
  const meta = (name) => {
    const re = new RegExp(
      `<meta[^>]+(?:property|name|itemprop)=["']${name}["'][^>]*>`, "i"
    );
    const tag = html.match(re)?.[0];
    return tag ? decodeEntities(tag.match(/content=["']([^"']*)["']/i)?.[1] || "") : null;
  };
  const price = toNumber(meta("product:price:amount") || meta("og:price:amount") || meta("price"));
  const currency = meta("product:price:currency") || meta("og:price:currency") || meta("priceCurrency");
  const inStock = stockFrom(meta("product:availability") || meta("og:availability") || meta("availability"));
  if (price == null && inStock == null) return null;
  return { price, currency, inStock };
}

// Amazon has no structured data; read the main price box and availability text.
export function fromAmazon(html) {
  let price = null;
  for (const id of ["corePriceDisplay_desktop_feature_div", "corePrice_feature_div", "corePrice_desktop", "apex_desktop"]) {
    const i = html.indexOf(`id="${id}"`);
    if (i === -1) continue;
    const m = html.slice(i, i + 8000).match(/class="a-offscreen">\s*([^<]+)</);
    if (m) { price = toNumber(decodeEntities(m[1])); if (price) break; }
  }
  if (price == null) {
    const m = html.match(/"priceAmount"\s*:\s*([0-9.]+)/);
    if (m) price = toNumber(m[1]);
  }
  let inStock = null;
  const ai = html.indexOf('id="availability"');
  if (ai !== -1) {
    const text = html.slice(ai, ai + 3000).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    if (/currently unavailable|out of stock|temporarily out/i.test(text)) inStock = false;
    else if (/in stock|left in stock|usually ships|available to ship/i.test(text)) inStock = true;
  }
  if (inStock == null && /id="add-to-cart-button"/.test(html)) inStock = true;
  if (inStock == null && /id="outOfStock"/.test(html)) inStock = false;
  if (price == null && inStock == null) return null;
  return { price, currency: "USD", inStock };
}

// ---------- fetching ----------

async function get(url, extraHeaders = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { ...HEADERS, ...extraHeaders }, redirect: "follow", signal: ctrl.signal });
    return { ok: res.ok, status: res.status, url: res.url, text: await res.text() };
  } catch (e) {
    return { ok: false, status: 0, url, text: "", error: e.name === "AbortError" ? "timeout" : e.message };
  } finally {
    clearTimeout(t);
  }
}

export async function checkUrl(url) {
  try {
    const shop = await fromShopify(url);
    if (shop && (shop.price != null || shop.inStock != null)) return { status: "ok", source: "shopify", ...shop };
  } catch { /* fall through */ }

  const res = await get(url);
  if (res.status === 0) return { status: "error", note: res.error };
  if (looksBlocked(res.status, res.text)) return { status: "blocked", note: `HTTP ${res.status}` };
  if (!res.ok) return { status: "error", note: `HTTP ${res.status}` };

  const host = new URL(res.url || url).hostname;
  const tries = /amazon\./i.test(host)
    ? [["amazon", fromAmazon], ["jsonld", fromJsonLd], ["meta", fromMeta]]
    : [["jsonld", fromJsonLd], ["meta", fromMeta]];

  let merged = null;
  for (const [source, fn] of tries) {
    const r = fn(res.text);
    if (!r) continue;
    if (!merged) merged = { status: "ok", source, ...r };
    else {
      if (merged.price == null && r.price != null) { merged.price = r.price; merged.currency ||= r.currency; }
      if (merged.inStock == null && r.inStock != null) merged.inStock = r.inStock;
    }
    if (merged.price != null && merged.inStock != null) break;
  }
  return merged || { status: "nodata" };
}

// ---------- main ----------

async function loadItems() {
  const code = await readFile(ITEMS_FILE, "utf8");
  return vm.runInNewContext(`${code}\n;ITEMS`, {}, { filename: ITEMS_FILE });
}

async function loadPrevious() {
  try { return JSON.parse(await readFile(OUT_FILE, "utf8")); } catch { return { items: {} }; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function main() {
  const items = await loadItems();
  const prev = await loadPrevious();
  const now = new Date().toISOString();
  const out = { checked: now, items: {} };
  const urls = [...new Set(items.filter((i) => i && i.url && i.live !== false).map((i) => i.url))];
  const rows = [];

  for (const [n, url] of urls.entries()) {
    if (n > 0) await sleep(1500 + Math.random() * 2500);
    const r = await checkUrl(url);
    const old = prev.items?.[url];
    if (r.status === "ok") {
      out.items[url] = { status: "ok", price: r.price ?? null, currency: r.currency || null, inStock: r.inStock ?? null, checked: now };
    } else if (old && old.checked) {
      // Keep the last good reading; the site ignores it once it's too old.
      out.items[url] = { ...old, status: r.status, attempted: now };
    } else {
      out.items[url] = { status: r.status, price: null, currency: null, inStock: null, checked: null, attempted: now };
    }
    const e = out.items[url];
    rows.push({
      result: r.status + (r.source ? ` (${r.source})` : ""),
      price: r.status === "ok" ? (e.price ?? "-") : "-",
      stock: r.status === "ok" ? (e.inStock == null ? "?" : e.inStock ? "in stock" : "OUT") : "-",
      url: url.length > 70 ? url.slice(0, 67) + "..." : url,
    });
  }

  await writeFile(OUT_FILE, JSON.stringify(out, null, 2) + "\n");
  console.table(rows);
  const ok = rows.filter((r) => r.result.startsWith("ok")).length;
  console.log(`\n${ok} of ${rows.length} links read successfully.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
