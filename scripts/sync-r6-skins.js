#!/usr/bin/env node

// Syncs cosmetics data (uniforms, headgear, weapon skins, charms, drone +
// attachment skins, elite/paragon sets) from the Rainbow Six wiki into
// content/skins.json. DATA ONLY — no views consume it yet (catalog UI
// lands separately). Images register in the shared manifest; download via
// scripts/sync-r6-images.js.
// Usage: node scripts/sync-r6-skins.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const SKINS_PATH = path.join(CONTENT_DIR, 'skins.json');
const API = 'https://rainbowsix.fandom.com/api.php';
const UA = 'R6-Siege-Wiki-Sync/0.1 (fan wiki content sync; contact via repo issues)';
const SLEEP_MS = 350;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function apiGet(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', ...params })}`;
  const response = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function strip(text) {
  let out = String(text || '');
  out = out.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  for (let i = 0; i < 4 && /\{\{[^{}]*\}\}/.test(out); i += 1) {
    out = out.replace(/\{\{Color\|[^|}]+\|([^}]+)\}\}/gi, '$1');
    out = out.replace(/\{\{Currency\|[^}]*\}\}/gi, '');
    out = out.replace(/\{\{[^{}]*\}\}/g, '');
  }
  out = out.replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, (m) => ` ${m} `);
  out = out.replace(/\[\[([^|\]]*\|)?([^\]]+)\]\]/g, '$2');
  out = out.replace(/<\/?[a-z][^>]*>/gi, '').replace(/'''?/g, '');
  return out.replace(/\s+/g, ' ').trim();
}

function fileOf(cell) {
  const m = String(cell).match(/\[\[(?:File|Image):([^\]|]+)/i);
  return m ? m[1].trim() : null;
}

function costsOf(cell) {
  const renown = (String(cell).match(/\{\{Color\|renown\|(\d+)\}\}/i) || [])[1];
  const credits = (String(cell).match(/\{\{Color\|credits\|(\d+)\}\}/i) || [])[1];
  const out = {};
  if (renown) out.renown = Number(renown);
  if (credits) out.credits = Number(credits);
  return out;
}

function nameOf(cell) {
  const first = String(cell).split(/<br[^>]*>/i)[0];
  return strip(first).replace(/\s+(Default|Common|Rare|Epic|Legendary)\s*$/i, '').trim().slice(0, 80)
    || strip(cell).slice(0, 80);
}

// Splits hub wikitext into per-subject sections (===[[Op]]]=== or ==Op==).
function splitSections(wt) {
  const out = [];
  const re = /\n={2,}\s*(?:\[\[)?([^|\]\n=]+?)(?:\|[^\]\n]*)?(?:\]\])?\s*={2,}[ \t]*\n/g;
  let m;
  const heads = [];
  while ((m = re.exec(wt))) heads.push({ name: m[1].trim(), start: m.index, end: m.index + m[0].length });
  for (let i = 0; i < heads.length; i += 1) {
    const stop = i + 1 < heads.length ? heads[i + 1].start : wt.length;
    // Slice from the end of this header to the start of the next.
    out.push({ subject: heads[i].name.replace(/\(Siege\)/gi, '').trim(), body: wt.slice(heads[i].end, stop) });
  }
  return out;
}

// Parses wikitable rows of |image cell + |name/cost cell pairs.
function tableRows(body, manifest, dir, opId) {
  const items = [];
  const tables = [...String(body).matchAll(/\{\|class="wikitable[\s\S]*?\|\}/gi)].map((x) => x[0]);
  for (const table of tables) {
    const cells = [...table.matchAll(/\n\|([^\n|][^\n]*)/g)].map((x) => x[1]);
    for (let i = 0; i + 1 < cells.length; i += 2) {
      const file = fileOf(cells[i]);
      const name = nameOf(cells[i + 1]);
      if (!name || /^(Default)$/i.test(name) && !file) continue;
      if (!name) continue;
      const key = `${dir}/${opId}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
      const rel = `r6_images/skins/${key}.png`;
      if (file) manifest.images[rel] = { file, width: 320 };
      items.push({ name, image: file ? rel : null, ...costsOf(cells[i + 1]) });
    }
  }
  return items;
}

const slugOf = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[øØ]/g, 'o').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function wikitext(title) {
  const data = await apiGet({ action: 'parse', page: title, prop: 'wikitext' });
  if (data.error) throw new Error(`${title}: ${data.error.info}`);
  return data.parse.wikitext['*'];
}

async function categoryMembers(category) {
  const data = await apiGet({ action: 'query', list: 'categorymembers', cmtitle: category, cmlimit: 200, cmtype: 'page' });
  return (data.query?.categorymembers || []).map((m) => m.title);
}

async function main() {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  const manifestPath = path.join(ROOT, 'review', 'r6-image-manifest.json');
  let manifest = { images: {} };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.images = manifest.images || {};
  } catch { /* first run */ }
  const operators = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'operators.json'), 'utf8')).operators;
  const opIdByName = new Map(operators.map((o) => [o.name, o.id]));
  const opIdByNorm = new Map(operators.map((o) => [slugOf(o.name), o.id]));
  const resolveOp = (subject) => {
    const clean = String(subject).replace(/\(Siege\)/i, '').trim();
    return opIdByName.get(clean) || opIdByNorm.get(slugOf(clean)) || null;
  };

  const skins = { uniforms: {}, headgear: {}, weapons: {}, elite: {}, charms: [], drone: [], attachments: [] };
  const seen = new Set();
  const addItems = (bucket, key, items) => {
    if (!key || !items.length) return 0;
    let added = 0;
    for (const it of items) {
      const k = `${bucket}|${key}|${it.name.toLowerCase()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (bucket === 'charms' || bucket === 'drone' || bucket === 'attachments') skins[bucket].push({ ...it, ...(key !== '*' ? { set: key } : {}) });
      else {
        skins[bucket][key] = skins[bucket][key] || [];
        skins[bucket][key].push(it);
      }
      added += 1;
    }
    return added;
  };

  // 1. Hub pages: per-operator / per-weapon sections.
  const hubs = [
    { title: 'Uniforms (Siege)', bucket: 'uniforms', byOp: true },
    { title: 'Headgear (Siege)', bucket: 'headgear', byOp: true },
    { title: 'Weapon Skins (Siege)', bucket: 'weapons', byOp: false },
    { title: 'Charms (Siege)', bucket: 'charms', byOp: false, flat: true },
    { title: 'Drone Skins', bucket: 'drone', byOp: false, flat: true },
    { title: 'Attachment Skins (Siege)', bucket: 'attachments', byOp: false, flat: true },
  ];
  for (const hub of hubs) {
    try {
      const wt = await wikitext(hub.title);
      await sleep(SLEEP_MS);
      let total = 0;
      for (const { subject, body } of splitSections(wt)) {
        const key = hub.flat ? '*' : hub.byOp ? resolveOp(subject) : slugOf(subject) || subject;
        if (!hub.flat && !key) continue;
        total += addItems(hub.bucket, hub.flat ? '*' : key, tableRows(body, manifest, hub.bucket, slugOf(subject) || 'misc'));
      }
      console.log(`sync-skins: ${hub.title} -> ${total} items`);
    } catch (error) {
      console.warn(`sync-skins: hub "${hub.title}" failed (${error.message})`);
    }
  }

  // 2. Per-op / per-weapon subpages via categories (same table pattern).
  for (const cat of ['Category:Uniforms', 'Category:Headgear', 'Category:Weapon Skins']) {
    try {
      const members = await categoryMembers(cat);
      await sleep(SLEEP_MS);
      const bucket = cat === 'Category:Uniforms' ? 'uniforms' : cat === 'Category:Headgear' ? 'headgear' : 'weapons';
      for (const title of members) {
        if (!title.includes('/')) continue;
        const base = title.split('/')[0].replace(/\(Siege\)/i, '').trim();
        const key = bucket === 'weapons' ? slugOf(base) : resolveOp(base);
        if (!key) continue;
        try {
          const wt = await wikitext(title);
          await sleep(SLEEP_MS);
          const n = addItems(bucket, key, tableRows(wt, manifest, bucket, slugOf(base)));
          if (n) console.log(`sync-skins: ${title} -> ${n} items`);
        } catch (error) {
          console.warn(`sync-skins: page "${title}" failed (${error.message})`);
        }
      }
    } catch (error) {
      console.warn(`sync-skins: category "${cat}" failed (${error.message})`);
    }
  }

  // 3. Elite + Paragon sets: 4-col tables (Operator+Set | Uniform |
  // Contents | Gadget Skin) grouped under CTU sections — resolve the
  // operator per ROW, not per section. Multiple sets per operator.
  for (const [title, kind] of [['Elite Sets', 'elite'], ['Paragon Sets', 'paragon']]) {
    try {
      const wt = await wikitext(title);
      await sleep(SLEEP_MS);
      let total = 0;
      const tables = [...String(wt).matchAll(/\{\|class="wikitable[\s\S]*?\|\}/gi)].map((x) => x[0]);
      for (const table of tables) {
        const rows = table.split(/\n\|-/).slice(1);
        for (const row of rows) {
          const cells = [...row.matchAll(/\n\|([^\n|][^\n]*)/g)].map((x) => x[1]);
          if (cells.length < 4) continue;
          if (/'''Operator'''/i.test(cells[0])) continue;
          const opName = strip(cells[0].split(/<br[^>]*>/i)[0]);
          const setName = strip(cells[0].split(/<br[^>]*>/i).slice(1).join(' ')).slice(0, 80);
          const opId = resolveOp(opName);
          if (!opId || !setName) continue;
          const imgFile = fileOf(cells[1]);
          const rel = imgFile ? `r6_images/skins/${slugOf(opId)}-${kind}-${slugOf(setName)}.png` : null;
          if (imgFile) manifest.images[rel] = { file: imgFile, width: 400 };
          const relOf = (f, suffix) => {
            if (!f) return null;
            const r = `r6_images/skins/${slugOf(opId)}-${kind}-${slugOf(setName)}-${suffix}.png`;
            manifest.images[r] = { file: f, width: 400 };
            return r;
          };
          skins.elite[opId] = skins.elite[opId] || [];
          skins.elite[opId].push({
            kind, set: setName, image: rel,
            contents: relOf(fileOf(cells[2]), 'contents'), gadget: relOf(fileOf(cells[3]), 'gadget'),
          });
          total += 1;
        }
      }
      console.log(`sync-skins: ${title} -> ${total} sets`);
    } catch (error) {
      console.warn(`sync-skins: "${title}" failed (${error.message})`);
    }
  }

  const counts = {
    uniforms: Object.values(skins.uniforms).reduce((n, a) => n + a.length, 0),
    headgear: Object.values(skins.headgear).reduce((n, a) => n + a.length, 0),
    weapons: Object.values(skins.weapons).reduce((n, a) => n + a.length, 0),
    elite: Object.values(skins.elite).reduce((n, a) => n + a.length, 0),
    charms: skins.charms.length,
    drone: skins.drone.length,
    attachments: skins.attachments.length,
  };
  const generatedAt = new Date().toISOString();
  fs.writeFileSync(SKINS_PATH, JSON.stringify({
    generatedAt,
    metadata: { sources: { wiki: 'https://rainbowsix.fandom.com/api.php (CC-BY-SA)' }, counts },
    skins,
  }, null, 2) + '\n');
  manifest.generatedAt = generatedAt;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`sync-skins: wrote content/skins.json ${JSON.stringify(counts)}`);
}

main().catch((error) => { console.error(`sync-skins: ${error.message}`); process.exit(1); });
