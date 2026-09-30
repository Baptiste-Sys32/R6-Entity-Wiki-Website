#!/usr/bin/env node

// Adds Ubisoft-only personas (Striker/Sentry — no unique power/video) as
// first-class operators: Fandom "<Name> (Recruit)" infobox for role/armor/
// speed/season/bio (CC-BY-SA), Ubisoft en-us loadout (wins), Fandom portrait
// + icon downloaded locally. Idempotent: skips ids already present.
// Usage: node scripts/merge-ubi-personas.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const UBI_OPS_PATH = path.join(CONTENT_DIR, 'ubi-operators.json');
const OPERATORS_PATH = path.join(CONTENT_DIR, 'operators.json');
const LORE_PATH = path.join(CONTENT_DIR, 'lore.json');
const FANDOM_API = 'https://rainbowsix.fandom.com/api.php';
const UA = 'R6-Siege-Wiki-Sync/0.1 (fan wiki content sync; contact via repo issues)';
const SLEEP_MS = 350;

// Pinned B&W persona logos (vendored force-whitened line art, same look as
// the whitened Ubi set): the Gadgets list shows these for the "No Unique
// Gadget" rows instead of the "GA" placeholder doc. Operator pages stay
// text-only by design (art suppressed in index.html for personas).
const PERSONA_GADGET_ART = {
  'r6-sentry': 'review/local-assets/gadget-no-unique-sentry.png',
  'r6-striker': 'review/local-assets/gadget-no-unique-striker.png',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sleepFn = sleep;
async function fandom(params) {
  const url = `${FANDOM_API}?${new URLSearchParams({ format: 'json', ...params })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function cleanText(s) {
  return String(s || '')
    .replace(/'''?/g, '').replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/\{\{[^}]*\}\}/g, '').replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ').trim();
}
const dots = (s) => (s.match(/●/g) || []).length;

async function main() {
  const ubi = JSON.parse(fs.readFileSync(UBI_OPS_PATH, 'utf8')).operators;
  const opsDoc = JSON.parse(fs.readFileSync(OPERATORS_PATH, 'utf8'));
  const loreDoc = JSON.parse(fs.readFileSync(LORE_PATH, 'utf8'));
  loreDoc.entries = loreDoc.entries || {};
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'review', 'r6-image-manifest.json'), 'utf8'));
  manifest.images = manifest.images || {};
  const haveIds = new Set(opsDoc.operators.map((o) => o.id));
  let added = 0;
  for (const u of ubi) {
    const id = u.opId || `r6-${u.slug}`;
    if (haveIds.has(id)) continue;
    const title = `${u.name[0].toUpperCase()}${u.name.slice(1)} (Recruit)`;
    let wt = '';
    try {
      const d = await fandom({ action: 'parse', page: title, prop: 'wikitext' });
      if (!d.error) wt = d.parse.wikitext['*'] || '';
    } catch (e) { console.warn(`merge-personas: fandom failed ${title} (${e.message})`); }
    await sleepFn(SLEEP_MS);
    const role = (wt.match(/\|role\s*=\s*([^\n|]+)/i) || [])[1]?.trim() || 'Support';
    const armor = dots((wt.match(/\|armor\s*=\s*(.+)/i) || [])[1]) || 2;
    const speed = dots((wt.match(/\|speed\s*=\s*(.+)/i) || [])[1]) || 2;
    const quote = (wt.match(/\|imagecaption\s*=\s*([^\n|]+)/i) || [])[1]?.trim() || null;
    const intro = cleanText((wt.split('== Biography ==')[0].split('\n').find((l) => l.startsWith("'''")) || ''));
    // Portrait + icon from Fandom files.
    const files = [...wt.matchAll(/\|(?:image|image2)\s*=\s*([^\n|]+)/gi)].map((m) => `File:${m[1].trim()}`);
    const downloaded = {};
    for (const f of files.slice(0, 2)) {
      try {
        const d = await fandom({ action: 'query', titles: f, prop: 'imageinfo', iiprop: 'url', formatversion: 2 });
        const pg = d.query.pages[0];
        const url = pg.imageinfo && pg.imageinfo[0] && pg.imageinfo[0].url;
        if (!url) continue;
        const isIcon = /icon/i.test(f);
        const rel = `r6_images/operators/${isIcon ? 'icons' : 'heroes'}/${id}.png`;
        const abs = path.join(ROOT, 'web', rel);
        if (!fs.existsSync(abs) || fs.statSync(abs).size === 0) {
          const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, Buffer.from(await r.arrayBuffer()));
        }
        manifest.images[rel] = manifest.images[rel] || { url, referer: `https://rainbowsix.fandom.com/wiki/${encodeURIComponent(title)}` };
        downloaded[isIcon ? 'icon' : 'hero'] = rel;
      } catch (e) { console.warn(`merge-personas: image failed ${f} (${e.message})`); }
      await sleepFn(SLEEP_MS);
    }
    const weapons = [
      ...u.primaries.map((p) => ({ slot: 'primary', name: p.name, image: null })),
      ...u.secondaries.map((s) => ({ slot: 'secondary', name: s.name, image: null })),
      ...u.gadgets.map((g) => ({ slot: 'gadget', name: g.name, image: null })),
    ];
    const ability = intro
      ? `${intro.slice(0, 300)} Loadout is fully versatile — any primary, secondary and secondary gadget in the pool below.`
      : `Remaster of the Recruit (${u.side}), introduced in Operation New Blood. Fully versatile loadout — any combination below.`;
    opsDoc.operators.push({
      id, name: u.name[0].toUpperCase() + u.name.slice(1), side: u.side, squad: 'Rainbow',
      season: 'Operation New Blood', role, gadget: 'No Unique Gadget', ability,
      realname: undefined, quote: quote || undefined, armor, speed,
      icon: downloaded.icon || null, hero: downloaded.hero || null, gadgetIcon: null,
      weapons,
    });
    // Drop undefined keys (JSON-clean).
    const last = opsDoc.operators[opsDoc.operators.length - 1];
    Object.keys(last).forEach((k) => last[k] === undefined && delete last[k]);
    if (PERSONA_GADGET_ART[id]) {
      const rel = `r6_images/gadgets/${id}.png`;
      manifest.images[rel] = { local: PERSONA_GADGET_ART[id] };
      last.gadgetIcon = rel;
    }
    loreDoc.entries[id] = { biography: intro || null, quotes: quote ? [quote] : [] };
    if (!loreDoc.entries[id].biography) delete loreDoc.entries[id].biography;
    added += 1;
    console.log(`merge-personas: added ${id} (${u.side}, ${weapons.length} loadout entries)`);
  }
  // Ensure pass (runs every time, including for already-merged personas):
  // lore stats must survive re-runs, and the season roster must stay whole
  // (the data sync only adds ops present at its run). Personas are
  // Recruit-standard 2 health / 2 speed.
  const seasonsDoc = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'seasons.json'), 'utf8'));
  let seasonsDirty = false;
  for (const u of ubi.filter((o) => ['r6-sentry', 'r6-striker'].includes(o.opId))) {
    const id = u.opId;
    if (PERSONA_GADGET_ART[id]) {
      const rel = `r6_images/gadgets/${id}.png`;
      manifest.images[rel] = { local: PERSONA_GADGET_ART[id] };
      const op = opsDoc.operators.find((o) => o.id === id);
      if (op) op.gadgetIcon = rel;
    }
    const prev = loreDoc.entries[id] || {};
    loreDoc.entries[id] = {
      biography: prev.biography || null,
      quotes: prev.quotes || [],
      health: prev.health !== undefined ? prev.health : 2,
      speed: prev.speed !== undefined ? prev.speed : 2,
      difficulty: prev.difficulty !== undefined ? prev.difficulty : 1,
    };
    if (!loreDoc.entries[id].biography) delete loreDoc.entries[id].biography;
    const displayName = u.name[0].toUpperCase() + u.name.slice(1);
    const nb = seasonsDoc.seasons.find((s) => s.name === 'Operation New Blood');
    if (nb && !nb.operators.includes(displayName)) {
      nb.operators.push(displayName);
      seasonsDirty = true;
    }
  }
  if (seasonsDirty) {
    seasonsDoc.generatedAt = new Date().toISOString();
    fs.writeFileSync(path.join(CONTENT_DIR, 'seasons.json'), JSON.stringify(seasonsDoc, null, 2) + '\n');
  }
  opsDoc.generatedAt = new Date().toISOString();
  fs.writeFileSync(OPERATORS_PATH, JSON.stringify(opsDoc, null, 2) + '\n');
  fs.writeFileSync(LORE_PATH, JSON.stringify(loreDoc, null, 2) + '\n');
  manifest.generatedAt = opsDoc.generatedAt;
  fs.writeFileSync(path.join(ROOT, 'review', 'r6-image-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`merge-personas: done (added=${added}, operators=${opsDoc.operators.length})`);
}

main().catch((e) => { console.error(`merge-personas: ${e.message}`); process.exit(1); });
