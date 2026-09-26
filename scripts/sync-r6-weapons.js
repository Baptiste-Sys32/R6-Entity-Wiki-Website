#!/usr/bin/env node

// Syncs weapon stats into content/weapons.json from the Rainbow Six wiki.
// Parses the ==Siege== section of weapon pages (damage, RPM, mag, reload,
// ADS class, mobility, attachment flags, pros/cons).
// Usage: node scripts/sync-r6-weapons.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const OPERATORS_PATH = path.join(CONTENT_DIR, 'operators.json');
const WEAPONS_PATH = path.join(CONTENT_DIR, 'weapons.json');
const API = 'https://rainbowsix.fandom.com/api.php';
const UA = 'R6-Siege-Wiki-Sync/0.1 (fan wiki content sync; contact via repo issues)';
const SLEEP_MS = 350;

const ADS_MS = { AR: 400, DMR: 400, SMG: 300, H: 200, MP: 275, LMG: 450, S: 250, SR: 400, SG: 350 };

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
    out = out.replace(/\{\{[^{}]*\}\}/g, '');
  }
  out = out.replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, '');
  out = out.replace(/\[\[([^|\]]*\|)?([^\]]+)\]\]/g, '$2');
  out = out.replace(/<br[^>]*>/gi, ' / ');
  out = out.replace(/<\/?[a-z][^>]*>/gi, '').replace(/'''?/g, '');
  return out.replace(/\s+/g, ' ').trim().replace(/ \/ \//g, ' / ');
}

function siegeSection(wt) {
  const m = String(wt).match(/\n==Siege==\n([\s\S]*?)(?=\n==[^=])/);
  return m ? m[1] : '';
}

function field(section, name) {
  const m = section.match(new RegExp(`\\|${name}\\s*=([\\s\\S]*?)(?=\\n\\|[a-zA-Z0-9 /]+\\s*=|\\n\\}\\})`));
  return m ? m[1].trim() : '';
}

function num(text, re) {
  const m = String(text).match(re);
  return m ? Number(m[1]) : null;
}

function parseWeapon(title, wt) {
  let siege = siegeSection(wt);
  if (!siege) {
    const tab = String(wt).match(/\|-\|\s*Siege\s*=([\s\S]*?)(?=\|-\||<\/tabber>)/i);
    if (tab && /\{\{Infobox\/weapon/.test(tab[1])) siege = tab[1];
  }
  if (!siege) {
    const cut = String(wt).split(/\n==(?:Extraction|Mobile|Trivia|Gallery)==\n/)[0];
    if (/\{\{Infobox\/weapon/.test(cut)) siege = cut;
  }
  if (!siege || !/\{\{Infobox\/weapon/.test(siege)) return null;
  const d = (n) => strip(field(siege, n));
  const dmgRaw = field(siege, 'damage per hit');
  const dmgMatch = dmgRaw.match(/\{\{WeaponDamage\|([A-Z_]+)\|(\d+)/);
  const rangeRe = /(\d+)\s*(?:\(x(\d+)\)\s*)?<small>\((\d+)-(\d+)m\)<\/small>[\s\S]*?(\d+)\s*(?:\(x\d+\)\s*)?<small>\((\d+)\+m\)<\/small>/;
  const rangeMatch = dmgRaw.match(rangeRe);
  const suppSection = (dmgRaw.split(/Suppressed/i)[1] || '');
  const suppMatch = suppSection.match(rangeRe);
  const damage = dmgMatch ? { mode: 'class', class: dmgMatch[1], base: Number(dmgMatch[2]), extended: /extended/i.test(dmgRaw) }
    : rangeMatch ? {
      mode: 'ranged',
      pellets: rangeMatch[2] ? Number(rangeMatch[2]) : null,
      close: { dmg: Number(rangeMatch[1]), range: [Number(rangeMatch[3]), Number(rangeMatch[4])] },
      far: { dmg: Number(rangeMatch[5]), range: [Number(rangeMatch[6]), null] },
      suppressed: suppMatch ? {
        close: { dmg: Number(suppMatch[1]), range: [Number(suppMatch[3]), Number(suppMatch[4])] },
        far: { dmg: Number(suppMatch[5]), range: [Number(suppMatch[6]), null] },
      } : null,
    } : null;
  const rof = num(field(siege, 'rate of fire'), /(\d+)\s*RPM/i);
  const adsMatch = field(siege, 'adstime').match(/\{\{ADS\|([A-Z]+)/);
  const attachRaw = siege.match(/\{\{WeaponAttachments([\s\S]*?)\}\}/);
  const attachments = {};
  if (attachRaw) {
    for (const am of attachRaw[1].matchAll(/\|\s*([a-z0-9_]+)\s*=\s*(\w+)/gi)) {
      attachments[am[1].toLowerCase()] = /^y/i.test(am[2]);
    }
  }
  const pros = (siege.match(/====Pros====([\s\S]*?)====Cons====/) || [])[1] || '';
  const cons = (siege.match(/====Cons====([\s\S]*?)(?===Weapon Attachments===|\{\{WeaponAttachments|\{\{Weapons\/Siege)/) || [])[1] || '';
  const bullets = (t) => t.split('\n').map((l) => strip(l.replace(/^\*\s*/, ''))).filter((l) => l.length > 3).slice(0, 8);
  const users = d('users').split(/,|<br/i).map((u) => strip(u)).filter(Boolean).slice(0, 6);
  return {
    name: d('name') || title,
    type: d('type'),
    fire: d('fire'),
    damage: damage && damage.base !== undefined ? damage.base : (damage ? damage.close.dmg : null),
    damageModel: damage,
    ttk: {
      armor1: strip(field(siege, 'ttk1a')).slice(0, 80) || null,
      armor2: strip(field(siege, 'ttk2a')).slice(0, 80) || null,
      armor3: strip(field(siege, 'ttk3a')).slice(0, 80) || null,
    },
    rof, adsMs: adsMatch ? (ADS_MS[adsMatch[1]] || null) : null,
    adsClass: adsMatch ? adsMatch[1] : null,
    mobility: num(field(siege, 'mobility'), /(\d+)/),
    magazine: d('magazine'),
    maxammo: strip(field(siege, 'maxammo')).slice(0, 60),
    reload: strip(field(siege, 'reloadtime')).slice(0, 80),
    users, attachments,
    pros: bullets(pros), cons: bullets(cons),
  };
}

async function tryParse(title) {
  try {
    const data = await apiGet({ action: 'parse', page: title, prop: 'wikitext' });
    if (data.error) return null;
    const wt = data.parse.wikitext['*'];
    const parsed = parseWeapon(title, wt);
    return parsed && (parsed.damage !== null || parsed.damageModel) ? { title, wt } : null;
  } catch { return null; }
}

async function resolveTitle(name) {
  const direct = await tryParse(name);
  if (direct) return direct;
  await sleep(SLEEP_MS);
  const search = await apiGet({ action: 'query', list: 'search', srsearch: name, srnamespace: 0, srlimit: 10 });
  const hits = search.query?.search || [];
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  hits.sort((a, b) => (norm(a.title) === norm(name) ? -1 : 0) - (norm(b.title) === norm(name) ? -1 : 0));
  for (const hit of hits) {
    const parsed = await tryParse(hit.title);
    await sleep(SLEEP_MS);
    if (parsed) return parsed;
  }
  return null;
}

async function main() {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  const operators = JSON.parse(fs.readFileSync(OPERATORS_PATH, 'utf8')).operators;
  const names = [...new Set(operators.flatMap((op) => (op.weapons || []).filter((w) => w.slot !== 'gadget').map((w) => w.name)))];
  console.log(`sync-weapons: ${names.length} firearms`);
  const weapons = [];
  const seenPages = new Set();
  const manifest = {};
  let n = 0;
  for (const name of names) {
    n += 1;
    try {
      const resolved = await resolveTitle(name);
      if (!resolved) {
        console.warn(`sync-weapons: no siege page for "${name}"`);
        continue;
      }
      const parsed = parseWeapon(resolved.title, resolved.wt);
      if (!parsed || (parsed.damage === null && !parsed.damageModel)) {
        console.warn(`sync-weapons: no stats for "${name}" (page ${resolved.title})`);
        continue;
      }
      if (seenPages.has(resolved.title)) {
        console.warn(`sync-weapons: "${name}" shares page ${resolved.title}, skipping duplicate`);
        continue;
      }
      seenPages.add(resolved.title);
      parsed.page = resolved.title;
      parsed.aliases = [name];
      const existing = weapons.find((w) => w.name === parsed.name && w.name !== name);
      if (existing) existing.aliases = [...(existing.aliases || [existing.name]), name];
      weapons.push(parsed);
    } catch (error) {
      console.warn(`sync-weapons: failed "${name}": ${error.message}`);
    }
    if (n % 10 === 0) console.log(`sync-weapons: ${n}/${names.length}...`);
    await sleep(SLEEP_MS);
  }
  const generatedAt = new Date().toISOString();
  fs.writeFileSync(WEAPONS_PATH, JSON.stringify({
    generatedAt,
    metadata: { sources: { wiki: 'https://rainbowsix.fandom.com/api.php (CC-BY-SA)' }, count: weapons.length },
    weapons,
  }, null, 2) + '\n');
  console.log(`sync-weapons: wrote content/weapons.json (${weapons.length}/${names.length})`);
}

main().catch((error) => { console.error(`sync-weapons: ${error.message}`); process.exit(1); });
