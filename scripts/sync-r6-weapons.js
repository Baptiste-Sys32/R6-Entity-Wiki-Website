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

// Loadout display names that are NOT the wiki page title (in-game renames,
// descriptor suffixes, spelling variants). Search fallback may only adopt a
// page listed here or related by name — never an unrelated hit (that once
// merged GONNE-6 as a POF-9 alias).
const KNOWN_ALIASES = {
  'Super 90': 'M1014',
  'Reaper MK2': 'Glock',
  'USP40': 'P226',
  'Luison': 'PRB92',
  'AUG A3': 'AUG',
  'M249 SAW': 'M249',
  '9x19VSN': '9×19VSN',
  'USP 40': 'P226',
  'SMG11': 'SMG-11',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function apiGet(params, retries = 3) {
  const url = `${API}?${new URLSearchParams({ format: 'json', ...params })}`;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt === retries) throw error;
      await sleep(1500 * attempt);
    }
  }
  throw new Error('unreachable');
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
  // Param names may carry upstream typos (e.g. "|appearances. ="), so the
  // terminator charset includes "." — otherwise values swallow the next line.
  // Same-line params ("|damage per hit=10|affiliation=") also terminate;
  // the charset is param-name-only so template pipes never split early.
  const m = section.match(new RegExp(`\\|${name}\\s*=([\\s\\S]*?)(?=\\n\\|[a-zA-Z0-9 /.]+\\s*=|\\|[a-zA-Z0-9 /.]+\\s*=|\\n\\}\\})`));
  return m ? m[1].trim() : '';
}
function fileOf(markup) {
  const m = String(markup).match(/\[\[File:([^\]|]+)/i) || String(markup).match(/^([^|\n]+\.(png|jpg|jpeg|webp))/i);
  if (m) return m[1].trim();
  // Gallery-form image fields: "|image = <gallery>\nR6S G36C.png|Default\n..."
  // (spaces allowed — filenames like "R6S SPAS-12.png" must not truncate).
  const g = String(markup).match(/([^\n|\[\]{}<>]+\.(png|jpg|jpeg|webp))/i);
  return g ? g[1].trim() : null;
}
const slugOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'weapon';

// Armor HP map (close-range TTK basis). Validated against the 13 wiki TTK
// rows at compute time — systematic drift is logged for review, never
// silently shipped (see cross-check in main()).
const ARMOR_HP = { armor1: 100, armor2: 110, armor3: 125 };
function computeTtk(baseDmg, rof, pellets) {
  // Local precompute only: static ms ship in JSON, no client-side math.
  // Close-range unsuppressed damage; pellet shotguns excluded (per-pellet
  // falloff is not a single number — never fake it).
  if (!baseDmg || !rof || rof <= 0 || pellets) return null;
  const shots = {};
  const out = { shots, basis: 'close-range base damage, full-auto ROF' };
  for (const [k, hp] of Object.entries(ARMOR_HP)) {
    shots[k] = Math.max(1, Math.ceil(hp / baseDmg));
    out[`${k}Ms`] = Math.round((shots[k] - 1) * 60000 / rof);
  }
  return out;
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
  // Single-far format: "52 <small>(0-12m)</small><br />31 <small>(20m+)</small>"
  // (newer pages like Tacit .45, no WeaponDamage template).
  const rangeRe2 = /(\d+)\s*(?:\(x(\d+)\)\s*)?<small>\((\d+)-(\d+)m\)<\/small>[\s\S]{0,300}?(\d+)\s*<small>\((\d+)m\+\)<\/small>/;
  const rangeMatch2 = rangeMatch ? null : dmgRaw.match(rangeRe2);
  const suppSection = (dmgRaw.split(/Suppressed/i)[1] || '');
  const suppMatch = suppSection.match(rangeRe);
  // Bare number (single-shot specials like GONNE-6: "|damage per hit=10").
  const flatMatch = dmgRaw.match(/^\s*(\d+)\s*$/);
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
    } : rangeMatch2 ? {
      mode: 'ranged',
      pellets: rangeMatch2[2] ? Number(rangeMatch2[2]) : null,
      close: { dmg: Number(rangeMatch2[1]), range: [Number(rangeMatch2[3]), Number(rangeMatch2[4])] },
      far: { dmg: Number(rangeMatch2[5]), range: [Number(rangeMatch2[6]), null] },
      suppressed: null,
    } : flatMatch ? {
      mode: 'flat',
      base: Number(flatMatch[1]),
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
  const cons = (siege.match(/====Cons====([\s\S]*?)(?====(?:Weapon Attachments|Attachments|Situations)===|\{\{WeaponAttachments|\{\{Weapons\/Siege)/) || [])[1] || '';
  const bullets = (t) => t.split('\n').map((l) => strip(l.replace(/^\*\s*/, ''))).filter((l) => l.length > 3).slice(0, 8);
  const usersRaw = field(siege, 'users');
  const users = [...new Set(
    usersRaw.split(/<br[^>]*>|\n|,/)
      .flatMap((part) => part.split(/(?<=\w)\s*\/\s*(?=\w)/))
      .map((u) => strip(u).replace(/\s*\(.*?\)\s*/g, '').trim())
      .filter((u) => u && !/recruit/i.test(u))
  )].slice(0, 8);
  const imageFile = fileOf(field(siege, 'image'));
  return {
    name: (() => { const n = d('name'); return n && !/[{}]/.test(n) && n.length <= 60 ? n : title; })(),
    type: d('type').split('|')[0].trim().slice(0, 40) || 'Unknown',
    fire: d('fire'),
    damage: damage && damage.base !== undefined ? damage.base : (damage ? damage.close.dmg : null),
    damageModel: damage,
    ttk: {
      armor1: strip(field(siege, 'ttk1a')).slice(0, 80) || null,
      armor2: strip(field(siege, 'ttk2a')).slice(0, 80) || null,
      armor3: strip(field(siege, 'ttk3a')).slice(0, 80) || null,
    },
    ttkComputed: computeTtk(
      damage && damage.base !== undefined ? damage.base : (damage ? damage.close.dmg : null),
      rof, damage && damage.pellets,
    ),
    rof, adsMs: adsMatch ? (ADS_MS[adsMatch[1]] || null) : null,
    adsClass: adsMatch ? adsMatch[1] : null,
    mobility: num(field(siege, 'mobility'), /(\d+)/),
    magazine: d('magazine'),
    maxammo: strip(field(siege, 'maxammo')).slice(0, 60),
    reload: strip(field(siege, 'reloadtime')).slice(0, 80),
    users, attachments,
    pros: bullets(pros), cons: bullets(cons),
    imageFile,
  };
}

async function tryParse(title) {
  try {
    // Follow redirects so the resolved (canonical) title is tracked —
    // otherwise SMG11 and SMG-11 adopt the same page under two titles.
    const data = await apiGet({ action: 'parse', page: title, prop: 'wikitext', redirects: 1 });
    if (data.error) return null;
    const wt = data.parse.wikitext['*'];
    const to = (data.parse.redirects || []).map((r) => r.to).find(Boolean) || title;
    const parsed = parseWeapon(to, wt);
    // viaRedirect marks explicit upstream alias statements (G8A1→HK21):
    // the audit trusts these pages.
    const viaRedirect = to !== title;
    return parsed && (parsed.damage !== null || parsed.damageModel) ? { title: to, wt, viaRedirect } : null;
  } catch { return null; }
}

async function resolveTitle(name) {
  const direct = await tryParse(name);
  if (direct) return direct;
  await sleep(SLEEP_MS);
  // Redirects are explicit upstream alias statements (G8A1→HK21): adopt
  // the target with the loadout name merged as alias.
  try {
    const redir = await apiGet({ action: 'query', titles: name, redirects: 1 });
    const pages = Object.values(redir.query?.pages || {});
    const r = (redir.query?.redirects || [])[0];
    if (r && pages.length && !pages[0].missing) {
      const data = await apiGet({ action: 'parse', page: r.to, prop: 'wikitext' });
      await sleep(SLEEP_MS);
      if (!data.error) {
        const parsed = parseWeapon(r.to, data.parse.wikitext['*']);
        if (parsed && (parsed.damage !== null || parsed.damageModel)) {
          return { title: r.to, wt: data.parse.wikitext['*'], viaRedirect: true };
        }
      }
    }
  } catch { /* fall through to curated + search */ }
  if (KNOWN_ALIASES[name]) {
    const data = await apiGet({ action: 'parse', page: KNOWN_ALIASES[name], prop: 'wikitext', redirects: 1 });
    await sleep(SLEEP_MS);
    if (!data.error) {
      const to = (data.parse.redirects || []).map((r) => r.to).find(Boolean) || KNOWN_ALIASES[name];
      const parsed = parseWeapon(to, data.parse.wikitext['*']);
      if (parsed && (parsed.damage !== null || parsed.damageModel)) return { title: to, wt: data.parse.wikitext['*'], viaRedirect: to !== KNOWN_ALIASES[name] };
    }
  }
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const wanted = norm(name);
  const search = await apiGet({ action: 'query', list: 'search', srsearch: name, srnamespace: 0, srlimit: 10 });
  const hits = search.query?.search || [];
  hits.sort((a, b) => (norm(a.title) === wanted ? -1 : 0) - (norm(b.title) === wanted ? -1 : 0));
  for (const hit of hits) {
    // Only adopt related pages (exact or substring); unrelated hits are
    // search noise and must never become aliases.
    const candidate = norm(hit.title);
    if (candidate !== wanted && !candidate.includes(wanted) && !wanted.includes(candidate)) continue;
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
  const pageOwner = new Map();
  const redirectPages = new Set();
  // Merge-guard: a flaky run must never shrink the dataset. Names that fail
  // this run keep their previous entry (warned as stale).
  let previous = [];
  try {
    previous = JSON.parse(fs.readFileSync(WEAPONS_PATH, 'utf8')).weapons || [];
  } catch { /* first run */ }
  const prevByName = new Map(previous.map((w) => [w.name, w]));
  const stale = [];
  // Merge into the shared manifest (other syncs own their entries).
  const manifestPath = path.join(ROOT, 'review', 'r6-image-manifest.json');
  let manifest = { images: {} };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.images = manifest.images || {};
  } catch { /* first run */ }
  const usedSlugs = new Set();
  const carried = new Set();
  const aliasOk = (alias, name) => {
    const a = alias.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const n = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '');
    return (a === n || a.includes(n) || n.includes(a)) || KNOWN_ALIASES[alias] !== undefined;
  };
  const carryStale = (name) => {
    const prev = previous.find((w) => w.name === name || (w.aliases || []).includes(name));
    if (prev && !carried.has(prev.name) && !weapons.some((w) => w.name === prev.name)) {
      carried.add(prev.name);
      stale.push(name);
      // Scrub bogus aliases from stale entries (old fuzzy merges) — keep
      // only aliases related to the entry name or curated.
      const clean = [...new Set((prev.aliases || []).filter((a) => aliasOk(a, prev.name)))];
      if (clean.length !== (prev.aliases || []).length) {
        console.warn(`sync-weapons: scrubbed stale aliases on ${prev.name}: ${(prev.aliases || []).filter((a) => !aliasOk(a, prev.name)).join(', ')}`);
      }
      weapons.push({ ...prev, aliases: clean.length ? clean : [prev.name] });
      return true;
    }
    return false;
  };
  let n = 0;
  for (const name of names) {
    n += 1;
    try {
      const resolved = await resolveTitle(name);
      if (!resolved) {
        if (!carryStale(name)) console.warn(`sync-weapons: no siege page for "${name}"`);
        else console.warn(`sync-weapons: no siege page for "${name}", kept previous entry (stale)`);
        continue;
      }
      const parsed = parseWeapon(resolved.title, resolved.wt);
      if (!parsed || (parsed.damage === null && !parsed.damageModel)) {
        if (!carryStale(name)) console.warn(`sync-weapons: no stats for "${name}" (page ${resolved.title})`);
        else console.warn(`sync-weapons: no stats for "${name}" (page ${resolved.title}), kept previous entry (stale)`);
        continue;
      }
      if (seenPages.has(resolved.title)) {
        // Same page, different loadout name (M249 SAW→M249, Luison→PRB92):
        // merge as alias so operator rows link to the sheet.
        const owner = pageOwner.get(resolved.title);
        if (owner && !owner.aliases.includes(name)) owner.aliases.push(name);
        else console.warn(`sync-weapons: "${name}" shares page ${resolved.title}, skipping duplicate`);
        continue;
      }
      seenPages.add(resolved.title);
      parsed.page = resolved.title;
      parsed.aliases = [name];
      if (resolved.viaRedirect) redirectPages.add(resolved.title);
      pageOwner.set(resolved.title, parsed);
      // Canonical render from the weapon page infobox (clean gun pic —
      // per-operator files are often operator-holding-gun promos).
      let slug = slugOf(parsed.name);
      for (let i = 2; usedSlugs.has(slug); i++) slug = `${slugOf(parsed.name)}-${i}`;
      usedSlugs.add(slug);
      parsed.art = null;
      if (parsed.imageFile) {
        const rel = `r6_images/weapons/w-${slug}.png`;
        manifest.images[rel] = { file: parsed.imageFile, width: 400 };
        parsed.art = rel;
      }
      delete parsed.imageFile;
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
  // Consolidate same-page duplicates (fresh parse + stale carry of one
  // page, e.g. SMG-11): keep the entry whose name is a real loadout name,
  // merge aliases.
  const loadoutNames = new Set(names.map((x) => x.toLowerCase()));
  const byPage = new Map();
  for (const w of weapons) {
    if (!byPage.has(w.page)) byPage.set(w.page, []);
    byPage.get(w.page).push(w);
  }
  const consolidated = [];
  for (const [page, group] of byPage) {
    if (group.length === 1) { consolidated.push(group[0]); continue; }
    group.sort((a, b) => ((loadoutNames.has(String(b.name).toLowerCase()) ? 1 : 0) - (loadoutNames.has(String(a.name).toLowerCase()) ? 1 : 0)));
    const keep = group[0];
    const merged = [...new Set(group.flatMap((g) => [g.name, ...(g.aliases || [])]))];
    if (group.length > 1) console.log(`sync-weapons: consolidated ${group.length} entries on page ${page} -> ${keep.name} (aliases ${merged.join('/')})`);
    keep.aliases = merged;
    consolidated.push(keep);
  }
  weapons.length = 0;
  weapons.push(...consolidated);
  // Triple-check: every weapon's page must relate to its name or aliases
  // (exact or substring, normalized), be a curated KNOWN_ALIASES target,
  // or be reached through an explicit upstream redirect — AND every alias
  // must relate to the entry name or be curated. Unrelated adoption is
  // alias poisoning — fail loudly, never ship.
  const wnorm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const related = (a, b) => a && b && (a === b || a.includes(b) || b.includes(a));
  const bad = [];
  for (const w of weapons) {
    const page = wnorm(w.page);
    const names = [w.name, ...(w.aliases || [])].map(wnorm);
    const pageOk = redirectPages.has(w.page) || names.some((n) => related(n, page))
      || (w.aliases || []).some((a) => KNOWN_ALIASES[a] && wnorm(KNOWN_ALIASES[a]) === page);
    if (!pageOk) bad.push(`${w.name} (page ${w.page}, aliases ${(w.aliases || []).join('/')})`);
    for (const a of w.aliases || []) {
      const rel = related(wnorm(a), wnorm(w.name)) || KNOWN_ALIASES[a] !== undefined;
      if (!rel) bad.push(`${w.name} has unrelated alias "${a}"`);
    }
  }
  if (bad.length) throw new Error(`unrelated weapon pages (alias poisoning):\n- ${bad.join('\n- ')}`);
  console.log(`sync-weapons: page audit ok (${weapons.length} related).`);
  // Cross-check computed close-range TTK against wiki first-segment ms
  // (review signal only — wiki strings always ship untouched).
  let crossChecked = 0, crossDrift = 0;
  for (const w of weapons) {
    if (!w.ttkComputed) continue;
    for (const k of ['armor1', 'armor2', 'armor3']) {
      const wikiMs = w.ttk && w.ttk[k] ? Number((String(w.ttk[k]).match(/(\d+)\s*ms/) || [])[1]) : null;
      const mine = w.ttkComputed[`${k}Ms`];
      if (wikiMs === null || mine === null) continue;
      crossChecked += 1;
      if (Math.abs(wikiMs - mine) > 100) {
        crossDrift += 1;
        console.warn(`sync-weapons: TTK drift ${w.name} ${k}: computed=${mine}ms wiki=${wikiMs}ms ("${w.ttk[k].slice(0, 40)}")`);
      }
    }
  }
  console.log(`sync-weapons: ttk cross-check ${crossChecked} rows, ${crossDrift} drifted (>100ms)`);
  fs.writeFileSync(WEAPONS_PATH, JSON.stringify({
    generatedAt,
    metadata: { sources: { wiki: 'https://rainbowsix.fandom.com/api.php (CC-BY-SA)' }, count: weapons.length },
    weapons,
  }, null, 2) + '\n');
  manifest.generatedAt = generatedAt;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`sync-weapons: wrote content/weapons.json (${weapons.length}/${names.length})`);
  if (stale.length) console.log(`sync-weapons: stale carried (${stale.length}): ${stale.join(', ')}`);
}

main().catch((error) => { console.error(`sync-weapons: ${error.message}`); process.exit(1); });
