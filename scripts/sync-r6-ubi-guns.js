#!/usr/bin/env node

// Syncs official per-weapon PNGs from Ubisoft operator pages
// (staticctf CDN) into web/r6_images/ubi/. One file per distinct gun;
// Unique Ability PNGs recorded for the later gadget-icon upgrade.
// Downloads only, never hotlinked. Failures warn per-op/per-file.
// Usage: node scripts/sync-r6-ubi-guns.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const OPERATORS_PATH = path.join(CONTENT_DIR, 'operators.json');
const UBI_GUNS_PATH = path.join(CONTENT_DIR, 'ubi-guns.json');
const UBI_INDEX = 'https://www.ubisoft.com/en-us/game/rainbow-six/siege/game-info/operators';
const UBI_OP = 'https://www.ubisoft.com/en-us/game/rainbow-six/siege/game-info/operators/';
const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0';
const SLEEP_MS = 800;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ubiGet(url) {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function slugify(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ø/gi, 'o').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Ubisoft display names that differ from our loadout names (typos included).
const NAME_MAP = {
  'LE ROC SHIELD': 'Extendable Shield',
  'CCE SHIELD MK2': 'CCE Shield',
  '9X19SVN': '9×19VSN',
};

function parseLoadout(html) {
  const guns = [];
  const abilities = [];
  const blocks = [...String(html).matchAll(/operator__loadout__category__title.*?data-innertext="([^"]+)".*?(?=operator__loadout__category__title|operator__biography)/gis)];
  for (const b of blocks) {
    const cat = b[1];
    const items = [...b[0].matchAll(/<p>([^<]{1,50})<\/p><div class="media"><img src="([^"]+)"/gi)]
      .map((m) => ({ name: m[1].trim(), url: m[2] }));
    if (/primary|secondary/i.test(cat)) guns.push(...items);
    else if (/unique ability/i.test(cat)) abilities.push(...items);
  }
  return { guns, abilities };
}

async function main() {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  const operators = JSON.parse(fs.readFileSync(OPERATORS_PATH, 'utf8')).operators;
  const manifestPath = path.join(ROOT, 'review', 'r6-image-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.images = manifest.images || {};
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const fileOf = (url, fallback) => {
    const base = (url.split('/').pop() || '').split('?')[0] || fallback;
    return `r6_images/ubi/${base.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/-+/g, '-')}`;
  };
  const guns = {};
  const abilities = {};
  const seenUrl = new Map();
  let opsOk = 0;
  for (const op of operators) {
    const slug = slugify(op.name);
    let html;
    try {
      html = await ubiGet(UBI_OP + slug);
    } catch (error) {
      console.warn(`sync-ubi-guns: page failed for ${op.name} (${error.message.split('\n')[0]})`);
      await sleep(SLEEP_MS);
      continue;
    }
    const { guns: ug, abilities: ua } = parseLoadout(html);
    if (!ug.length && !ua.length) {
      console.warn(`sync-ubi-guns: empty loadout for ${op.name}`);
      await sleep(SLEEP_MS);
      continue;
    }
    opsOk += 1;
    for (const g of ug) {
      const display = NAME_MAP[g.name] || g.name;
      const key = norm(display);
      if (!seenUrl.has(g.url)) {
        const rel = fileOf(g.url, `${slug}-${key}.png`);
        manifest.images[rel] = { url: g.url, referer: UBI_OP + slug };
        seenUrl.set(g.url, rel);
      }
      const rel = seenUrl.get(g.url);
      // Multiple loadout names can share one PNG; keep every alias.
      for (const alias of [g.name, display]) {
        const k = norm(alias);
        if (k && !guns[k]) guns[k] = { file: rel, label: alias };
      }
    }
    for (const a of ua) {
      const k = norm(a.name);
      if (k && !abilities[k]) abilities[k] = { file: null, url: a.url, label: a.name, referer: UBI_OP + slug };
    }
    await sleep(SLEEP_MS);
  }
  const generatedAt = new Date().toISOString();
  fs.writeFileSync(UBI_GUNS_PATH, JSON.stringify({
    generatedAt,
    metadata: { sources: { ubisoft: 'operator loadout blocks (downloaded, not hotlinked)' }, operators: opsOk, guns: Object.keys(guns).length },
    guns,
    abilities,
  }, null, 2) + '\n');
  manifest.generatedAt = generatedAt;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`sync-ubi-guns: wrote content/ubi-guns.json (${opsOk}/${operators.length} ops, ${Object.keys(guns).length} gun aliases, ${Object.keys(abilities).length} abilities)`);
}

main().catch((error) => { console.error(`sync-ubi-guns: ${error.message}`); process.exit(1); });
