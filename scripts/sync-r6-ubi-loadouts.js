#!/usr/bin/env node

// Full Ubisoft operator truth scrape (en-us, obligatory).
// Parses server-rendered DOM (loadout categories incl. Gadget + Unique
// Ability icons) + __PRELOADED_STATE__-adjacent patterns for mp4/YouTube.
// Writes content/ubi-operators.json. Downloads icons+posters only (mp4s
// are hotlinked in <video>, never stored — Cloudflare size).
// Usage: node scripts/sync-r6-ubi-loadouts.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const { lookupStatOverride } = require('./r6-stat-truth');
const OPERATORS_PATH = path.join(CONTENT_DIR, 'operators.json');
const OUT_PATH = path.join(CONTENT_DIR, 'ubi-operators.json');
const UBI_INDEX = 'https://www.ubisoft.com/en-us/game/rainbow-six/siege/game-info/operators';
const UBI_OP = 'https://www.ubisoft.com/en-us/game/rainbow-six/siege/game-info/operators/';
const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0';
const SLEEP_MS = 0;
const FETCH_TIMEOUT_MS = 25000;
const CONCURRENCY = 8;

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function ubiGet(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

function slugify(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ø/gi, 'o').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Ubisoft display names that differ from our canonical names.
const NAME_MAP = {
  'LE ROC SHIELD': 'Extendable Shield',
  'CCE SHIELD MK2': 'CCE Shield',
  '9X19SVN': '9×19VSN',
  NITRO: 'Nitro Cell',
  'PROXIMITY ALARM': 'Proximity Alarm',
};

// Pinned user-supplied power art (vendored under review/local-assets/):
// Ubisoft hosts no H.U.L.L. schematic; the user's line-art is canonical.
// Wiki can never clobber it; resyncs converge.
const POWER_ART_OVERRIDES = {
  blackbeard: { local: 'review/local-assets/r6s-operator-ability-blackbeard-hull.png' },
};

function parsePage(html, slug) {
  // --- loadout categories (DOM, stable across locales) ---
  const catRe = /operator__loadout__category__title.*?data-innertext="([^"]+)"/gi;
  const cats = [...String(html).matchAll(catRe)];
  const primaries = [];
  const secondaries = [];
  const gadgets = [];
  const powers = [];
  for (let i = 0; i < cats.length; i += 1) {
    const cat = cats[i][1];
    const start = cats[i].index;
    const end = i + 1 < cats.length ? cats[i + 1].index : start + 20000;
    const seg = String(html).slice(start, end);
    const items = [...seg.matchAll(/<p>([^<]{1,60})<\/p>\s*<div class="media"><img src="([^"]+)"/gi)]
      .map((m) => ({ raw: m[1].trim(), url: m[2] }));
    if (/primary/i.test(cat)) primaries.push(...items);
    else if (/secondary/i.test(cat)) secondaries.push(...items);
    else if (/unique ability/i.test(cat)) powers.push(...items);
    else gadgets.push(...items);
  }
  // --- ability prose + posters ---
  const abilityText = (String(html).match(/UNIQUE ABILITIES AND PLAYSTYLE<\/h2>\s*<p>([^<]{10,800})<\/p>/i) || [])[1] || null;
  const abilityPoster = (String(html).match(/promo__wrapper__content__btn mp4-modal[^>]*>.*?<img[^>]+src="([^"]+)"/is) || [])[1] || null;
  const mp4 = (String(html).match(/https:\/\/staticctf\.ubisoft\.com\/[^"'\s]+\.mp4/i) || [])[0] || null;
  // --- reveal trailer (biography youtube-modal) ---
  let youtubeId = null;
  const yt1 = String(html).match(/"buttonUrl"\s*:\s*"([^"]+)"[^}]{0,400}?"buttonType"\s*:\s*"youtube-modal"/i);
  const yt2 = String(html).match(/"buttonType"\s*:\s*"youtube-modal"[^}]{0,400}?"buttonUrl"\s*:\s*"([^"]+)"/i);
  const cand = (yt1 && yt1[1]) || (yt2 && yt2[1]) || null;
  if (cand && /^[A-Za-z0-9_-]{6,15}$/.test(cand.trim())) youtubeId = cand.trim();
  const revealPoster = (String(html).match(/promo__wrapper__content__btn youtube-modal[^>]*>.*?<img[^>]+src="([^"]+)"/is) || [])[1] || null;
  // --- header name/side ---
  const name = (String(html).match(/operator__header__icons__names">.*?<h1>([^<]{1,40})<\/h1>/is) || [])[1] || slug;
  const sideM = String(html).match(/operator__header__side__detail (attacker|defender)/i);
  const side = sideM ? (sideM[1].toLowerCase() === 'attacker' ? 'Attacker' : 'Defender') : null;
  // --- health/speed/difficulty stars (header stat blocks) ---
  const stats = { health: null, speed: null, difficulty: null };
  const statRe = /operator__header__stat__title[\s\S]*?data-innertext="([^"]+)"([\s\S]*?)(?=operator__header__stat__title|$)/gi;
  for (const m of String(html).matchAll(statRe)) {
    const title = m[1].trim().toLowerCase();
    const seg = m[2].slice(0, 2000);
    const active = (seg.match(/is-active/g) || []).length;
    if (active < 1 || active > 3) continue;
    if (title === 'health') stats.health = active;
    else if (title === 'speed') stats.speed = active;
    else if (title === 'difficulty') stats.difficulty = active;
  }
  return {
    name: String(name).trim(), side, primaries, secondaries, gadgets, powers,
    abilityText: abilityText ? abilityText.trim() : null,
    abilityPoster, mp4: mp4 ? mp4.slice(0, 300) : null, youtubeId, revealPoster,
    health: stats.health, speed: stats.speed, difficulty: stats.difficulty,
  };
}

async function main() {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  const operators = JSON.parse(fs.readFileSync(OPERATORS_PATH, 'utf8')).operators;
  const bySlug = new Map();
  operators.forEach((op) => bySlug.set(slugify(op.name), op));

  let slugs = [];
  try {
    const indexHtml = await ubiGet(UBI_INDEX);
    slugs = [...new Set([...indexHtml.matchAll(/\/game\/rainbow-six\/siege\/game-info\/operators\/([a-z0-9-]+)/g)].map((m) => m[1]))];
    console.log(`sync-ubi-loadouts: ubisoft slugs=${slugs.length}`);
  } catch (e) {
    console.error(`sync-ubi-loadouts: index failed (${e.message})`);
    process.exit(1);
  }
  await sleep(SLEEP_MS);

  const manifestPath = path.join(ROOT, 'review', 'r6-image-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.images = manifest.images || {};
  // Direct download (this script owns its files — no full-manifest resync).
  const fetchBin = async (url, referer) => {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: referer }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  };
  const ensureFile = async (url, rel, referer) => {
    const abs = path.join(ROOT, 'web', rel);
    if (!fs.existsSync(abs) || fs.statSync(abs).size === 0) {
      const bin = await fetchBin(url, referer);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, bin);
    }
    manifest.images[rel] = manifest.images[rel] || { url, referer };
    return rel;
  };

  const fileOf = (url, fallback, sub) => {
    const base = (String(url).split('/').pop() || '').split('?')[0] || fallback;
    const clean = base.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/-+/g, '-').slice(0, 80);
    return `r6_images/${sub}/${clean}`;
  };
  const canon = (raw) => NAME_MAP[raw] || NAME_MAP[String(raw).toUpperCase()] || raw;

  const out = [];
  let ok = 0;
  // Concurrent page pool: Ubisoft TTFB is slow (~10-20s), 8-way overlap
  // keeps wall time sane. Image downloads are cached on disk (ensureFile).
  const scrapeOne = async (slug) => {
    let html;
    try {
      html = await ubiGet(UBI_OP + slug);
    } catch (e) {
      console.warn(`sync-ubi-loadouts: page failed ${slug} (${String(e.message).split('\n')[0]})`);
      return null;
    }
    const p = parsePage(html, slug);
    // Known-stale Ubi pages (see scripts/r6-stat-truth.js): live truth wins.
    const statFix = lookupStatOverride(slug);
    if (statFix) {
      console.log(`sync-ubi-loadouts: stat-truth override ${slug} -> ${statFix.health}-${statFix.speed}`);
      p.health = statFix.health;
      p.speed = statFix.speed;
    }
    if (!p.primaries.length && !p.gadgets.length && !p.powers.length) {
      console.warn(`sync-ubi-loadouts: empty loadout ${slug}`);
      return null;
    }
    const referer = UBI_OP + slug;
    const mapItems = async (items, sub) => {
      const arr = [];
      for (const it of items) {
        const name = canon(it.raw);
        const rel = fileOf(it.url, `${slug}-${slugify(name)}.png`, sub);
        try { await ensureFile(it.url, rel, referer); }
        catch (e) { console.warn(`sync-ubi-loadouts: img failed ${slug}:${name} (${String(e.message).split('\n')[0]})`); }
        arr.push({ name, icon: rel });
      }
      return arr;
    };
    const primaries = await mapItems(p.primaries, 'ubi');
    const secondaries = await mapItems(p.secondaries, 'ubi');
    const gadgets = await mapItems(p.gadgets, 'ubi-gadgets');
    const powerRaw = p.powers[0] || null;
    let power = null;
    if (powerRaw) {
      const powerPin = POWER_ART_OVERRIDES[slug];
      const rel = powerPin?.local
        ? `r6_images/ubi-gadgets/${powerPin.local.split('/').pop()}`
        : fileOf(powerRaw.url, `${slug}-ability.png`, 'ubi-gadgets');
      if (powerPin?.local) {
        manifest.images[rel] = manifest.images[rel] || { local: powerPin.local };
        console.log(`sync-ubi-loadouts: pinned power art ${slug} (${powerPin.local})`);
      } else {
        try { await ensureFile(powerRaw.url, rel, referer); }
        catch (e) { console.warn(`sync-ubi-loadouts: img failed ${slug}:power (${String(e.message).split('\n')[0]})`); }
      }
      let mp4Poster = null;
      if (p.abilityPoster) {
        mp4Poster = fileOf(p.abilityPoster, `${slug}-ability-poster.jpg`, 'ubi');
        try { await ensureFile(p.abilityPoster, mp4Poster, referer); }
        catch (e) { console.warn(`sync-ubi-loadouts: img failed ${slug}:poster (${String(e.message).split('\n')[0]})`); }
      }
      power = { name: canon(powerRaw.raw), text: p.abilityText, icon: rel, mp4: p.mp4, mp4Poster };
    }
    let reveal = null;
    if (p.youtubeId || p.revealPoster) {
      let poster = null;
      if (p.revealPoster) {
        poster = fileOf(p.revealPoster, `${slug}-reveal.jpg`, 'ubi');
        try { await ensureFile(p.revealPoster, poster, referer); }
        catch (e) { console.warn(`sync-ubi-loadouts: img failed ${slug}:reveal (${String(e.message).split('\n')[0]})`); }
      }
      reveal = { youtubeId: p.youtubeId, poster };
    }
    const match = bySlug.get(slug) || null;
    return {
      slug, opId: match ? match.id : null, name: match ? match.name : p.name,
      side: match ? match.side : p.side, primaries, secondaries, gadgets, power, reveal,
      health: p.health, speed: p.speed, difficulty: p.difficulty,
    };
  };
  for (let i = 0; i < slugs.length; i += CONCURRENCY) {
    const batch = slugs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(scrapeOne));
    for (const r of results) { if (r) { out.push(r); ok += 1; } }
    console.log(`sync-ubi-loadouts: progress ${ok}/${slugs.length} slugs`);
  }
  out.sort((a, b) => String(a.slug).localeCompare(String(b.slug)));

  const generatedAt = new Date().toISOString();
  fs.writeFileSync(OUT_PATH, JSON.stringify({
    generatedAt,
    metadata: { sources: { ubisoft: 'https://www.ubisoft.com/en-us/game/rainbow-six/siege/game-info/operators/<slug> (downloaded icons+posters; mp4 hotlinked)' }, operators: ok, slugs: slugs.length },
    operators: out,
  }, null, 2) + '\n');
  manifest.generatedAt = generatedAt;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const unmatched = out.filter((o) => !o.opId).map((o) => o.slug);
  console.log(`sync-ubi-loadouts: wrote content/ubi-operators.json (${ok}/${slugs.length} ops, unmatched: ${unmatched.join(', ') || 'none'})`);
}

main().catch((e) => { console.error(`sync-ubi-loadouts: ${e.message}`); process.exit(1); });
