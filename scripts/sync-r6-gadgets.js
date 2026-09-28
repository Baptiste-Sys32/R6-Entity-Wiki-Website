#!/usr/bin/env node

// Syncs secondary + unique gadget detail data into content/gadgets.json.
// Parses the Siege content of canonical gadget pages (==Siege== section,
// <tabber> Siege tab, or ==Siege & Mobile== variant).
// Usage: node scripts/sync-r6-gadgets.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const GADGETS_PATH = path.join(CONTENT_DIR, 'gadgets.json');
const API = 'https://rainbowsix.fandom.com/api.php';
const UA = 'R6-Siege-Wiki-Sync/0.1 (fan wiki content sync; contact via repo issues)';
const SLEEP_MS = 350;

// Canonical wiki page title per gadget id.
const GADGETS = [
  { id: 'claymore', title: 'Claymore' },
  { id: 'breach-charge', title: 'Breach Charge/Siege' },
  { id: 'hard-breach-charge', title: 'Hard Breach Charge' },
  { id: 'smoke-grenade', title: 'Smoke Grenade' },
  { id: 'stun-grenade', title: 'Stun Grenade/Siege' },
  { id: 'frag-grenade', title: 'M67/Siege' },
  { id: 'deployable-shield', title: 'Deployable Shield' },
  { id: 'observation-blocker', title: 'Observation Blocker' },
  { id: 'barbed-wire', title: 'Barbed Wire' },
  { id: 'bulletproof-camera', title: 'Bulletproof Camera' },
  { id: 'impact-grenade', title: 'Impact Grenade' },
  { id: 'proximity-alarm', title: 'Proximity Alarm' },
  { id: 'nitro-cell', title: 'C4' },
  { id: 'gonne-6', title: 'GONNE-6' },
  { id: 'emp-grenade', title: 'EMP Grenade' },
];

// Loadout display string -> canonical gadget id.
const NORMALIZE = {
  'Claymore': 'claymore',
  'Breach Charge': 'breach-charge', 'Breach Charge/Siege': 'breach-charge',
  'Soft Breach Charge': 'breach-charge',
  'Hard Breach Charge': 'hard-breach-charge', 'Hard Breach': 'hard-breach-charge',
  'Smoke Grenade': 'smoke-grenade', 'Smoke Grenade/Siege': 'smoke-grenade',
  'Stun Grenade': 'stun-grenade', 'Stun Grenade/Siege': 'stun-grenade',
  'Frag Grenade': 'frag-grenade', 'M67/Siege': 'frag-grenade',
  'Deployable Shield': 'deployable-shield',
  'Observation Blocker': 'observation-blocker',
  'Barbed Wire': 'barbed-wire',
  'Bulletproof Camera': 'bulletproof-camera',
  'Impact Grenade': 'impact-grenade', 'Impact': 'impact-grenade',
  'Proximity Alarm': 'proximity-alarm',
  'Nitro Cell': 'nitro-cell', 'C4': 'nitro-cell',
  'GONNE-6': 'gonne-6',
  'EMP Grenade': 'emp-grenade', 'Impact EMP Grenade': 'emp-grenade',
};

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
  out = out.replace(/\[(?:https?:)?\/\/[^\]]*\]/gi, '');
  for (let i = 0; i < 4; i++) {
    if (!/\{\{[^{}]*\}\}/.test(out)) break;
    out = out.replace(/\{\{Quote\|[^}]*\}\}/gi, '');
    out = out.replace(/\{\{[^{}]*\|([^{}|]+)\}\}/g, '$1');
    out = out.replace(/\{\{[^{}]*\}\}/g, '');
  }
  out = out.replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, '');
  out = out.replace(/\[\[([^|\]]*\|)?([^\]]+)\]\]/g, '$2');
  out = out.replace(/<\/?[a-z][^>]*>/gi, '').replace(/'''?/g, '');
  return out.replace(/\s+/g, ' ').trim();
}

function field(block, name) {
  const m = block.match(new RegExp(`\\|${name}\\s*=([\\s\\S]*?)(?=\\n\\|[a-zA-Z0-9 /]+\\s*=|\\}\\})`));
  return m ? m[1].trim() : '';
}

function siegeContent(wt) {
  const m = String(wt).match(/\n==Siege==\n([\s\S]*?)(?=\n==[^=])/);
  if (m) return m[1];
  const tab = String(wt).match(/Siege=\s*([\s\S]*?)(?=\|-\||<\/tabber>)/i);
  if (tab) return tab[1];
  const sm = String(wt).match(/\n==Siege & Mobile==\n([\s\S]*?)(?=\n==[^=])/);
  if (sm) return sm[1];
  return '';
}

function stripTemplate(wt, name) {
  const start = name ? String(wt).indexOf('{{' + name) : String(wt).indexOf('{{');
  if (start < 0) return String(wt);
  let depth = 0, end = -1;
  for (let i = start; i < wt.length - 1; i++) {
    if (wt[i] === '{' && wt[i + 1] === '{') { depth += 1; i += 1; }
    else if (wt[i] === '}' && wt[i + 1] === '}') {
      depth -= 1; i += 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  return end > 0 ? wt.slice(0, start) + wt.slice(end) : wt;
}

function stripAllTemplates(wt) {
  let out = String(wt);
  for (let i = 0; i < 40 && out.includes('{{'); i++) {
    const next = stripTemplate(out, '');
    if (next === out || !next.includes('{{')) { out = next; break; }
    out = next;
  }
  return out;
}

// Extracts clean article prose: drops every template copy (navboxes,
// infobox duplicates on single-game pages, quotes, hatnotes), section
// headings, stray bracket remnants, and leading `key = value` param runs
// that leak from tabber/tab params. Ends on a sentence boundary.
function cleanProse(siege) {
  const noTemplates = stripAllTemplates(siege).split(/===?(?:Patch Changes|Gallery|Trivia)/)[0];
  const deheaded = noTemplates.replace(/\n={2,}\s*[^=\n]+?\s*={2,}[ \t]*/g, '\n');
  const paras = deheaded.split(/\n{2,}/).map((chunk) => {
    let t = strip(chunk);
    t = t.replace(/[\[\]]+/g, '');
    for (let i = 0; i < 8; i++) {
      const next = t.replace(/^\s*(?:[A-Za-z_][\w ]*=\s*(?:\([^)]*\)|\S+)\s*|\([^)]*\)\s*)+/, '');
      if (next === t) break;
      t = next;
    }
    return t.replace(/\s+/g, ' ').trim();
  }).filter((p) => p.length > 60
    && !/^[a-z_][\w ]*=/i.test(p)
    && !/\|\s*[a-z]+\s*=/i.test(p)
    && !/^[A-Z][a-z]+(?:[A-Z][a-z]+|\s+[A-Z][a-z]+){3,}\s+[A-Z]/.test(p));
  let body = paras.slice(0, 4).join('\n\n');
  if (body.length > 1400) {
    const cut = body.lastIndexOf('. ', 1400);
    body = (cut > 800 ? body.slice(0, cut + 1) : body.slice(0, 1400));
  }
  return body;
}
function firstInfobox(wt) {
  const start = String(wt).indexOf('{{Infobox/weapon');
  if (start < 0) return '';
  let depth = 0, end = -1;
  for (let i = start; i < wt.length - 1; i++) {
    if (wt[i] === '{' && wt[i + 1] === '{') { depth += 1; i += 1; }
    else if (wt[i] === '}' && wt[i + 1] === '}') {
      depth -= 1; i += 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  return end > 0 ? wt.slice(start, end) : '';
}
function fileOf(markup) {
  const m = String(markup).match(/\[\[File:([^\]|]+)/i) || String(markup).match(/^([^|\n]+\.(png|jpg|jpeg|webp))/i);
  return m ? m[1].trim() : null;
}

function parseGadget(id, title, wt) {
  let siege = siegeContent(wt);
  if (!siege || !/\{\{Infobox\/weapon/.test(siege)) {
    // Single-game pages (GONNE-6, EMP Grenade): use first infobox + full text.
    const box = firstInfobox(wt);
    if (!box) return null;
    siege = box + '\n' + wt;
  }
  const usersRaw = field(siege, 'users');
  const users = [...new Set(
    usersRaw.split(/<br[^>]*>|\n|,/)
      .flatMap((part) => part.split(/(?<=\w)\s*\/\s*(?=\w)/))
      .map((u) => strip(u).replace(/\s*\(.*?\)\s*/g, '').trim())
      .filter((u) => u && !/recruit/i.test(u))
  )].slice(0, 24);
  const text = cleanProse(siege);
  const imageFile = fileOf(field(siege, 'image'));
  const hudFile = fileOf(field(siege, 'hudicon'));
  return {
    id,
    name: strip(field(siege, 'name')) || title.replace(/\/Siege$/, ''),
    page: title,
    imageFile, hudFile,
    maxammo: strip(field(siege, 'maxammo')).slice(0, 40) || null,
    users,
    text,
  };
}

async function main() {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  const gadgets = [];
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'review', 'r6-image-manifest.json'), 'utf8'));
  for (const { id, title } of GADGETS) {
    try {
      const data = await apiGet({ action: 'parse', page: title, prop: 'wikitext' });
      if (data.error) {
        console.warn(`sync-gadgets: no page "${title}"`);
        continue;
      }
      const parsed = parseGadget(id, title, data.parse.wikitext['*']);
      if (!parsed) {
        console.warn(`sync-gadgets: no siege infobox for "${title}"`);
        continue;
      }
      parsed.image = null;
      parsed.hud = null;
      if (parsed.imageFile) {
        const rel = `r6_images/gadgets/${id}.png`;
        manifest.images[rel] = { file: parsed.imageFile, width: 320 };
        parsed.image = rel;
      }
      if (parsed.hudFile) {
        const rel = `r6_images/gadgets/${id}-hud.png`;
        manifest.images[rel] = { file: parsed.hudFile, width: 200 };
        parsed.hud = rel;
      }
      delete parsed.imageFile;
      delete parsed.hudFile;
      gadgets.push(parsed);
    } catch (error) {
      console.warn(`sync-gadgets: failed "${title}": ${error.message}`);
    }
    await sleep(SLEEP_MS);
  }
  const generatedAt = new Date().toISOString();
  fs.writeFileSync(GADGETS_PATH, JSON.stringify({
    generatedAt,
    metadata: { sources: { wiki: 'https://rainbowsix.fandom.com/api.php (CC-BY-SA)' }, count: gadgets.length },
    normalize: NORMALIZE,
    gadgets,
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(ROOT, 'review', 'r6-image-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`sync-gadgets: wrote content/gadgets.json (${gadgets.length}/${GADGETS.length})`);
}

main().catch((error) => { console.error(`sync-gadgets: ${error.message}`); process.exit(1); });
