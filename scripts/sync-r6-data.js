#!/usr/bin/env node

// Syncs R6 Siege Wiki content from the Rainbow Six wiki (Fandom MediaWiki API)
// into content/*.json — the same role sync-catalog-updates.js plays for DBD.
// Usage: node scripts/sync-r6-data.js
//
// Sources (all scraped, nothing hand-written):
//   operators: Category:Rainbow Operators -> Infobox/Operator pages
//   maps:      Category:Siege Maps -> Infobox/map pages (ranked rotation only)
//   seasons:   Category:Expansions of R6 Siege -> Infobox dlc pages

const fs = require('fs');
const path = require('path');
const { lookupStatOverride } = require('./r6-stat-truth');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const API = 'https://rainbowsix.fandom.com/api.php';
const UA = 'R6-Siege-Wiki-Sync/0.1 (fan wiki content sync; contact via repo issues)';
const SLEEP_MS = 350;

// Canonical unique-gadget art: exact wiki File: names for operators whose
// page-first match is a color render/action shot instead of the white
// schematic icon, or whose gadget has no match at all (short display names
// like "Gu"/"ERC-7", missing page files). `invert` negates
// black-on-transparent art for dark UI. `width` caps download size.
const GADGET_ICON_OVERRIDES = {
  'r6-ace': { file: 'SELMA_AQUA_BREACHER.png' },
  'r6-kali': { file: 'LV_Explosive_Lance.png', invert: true },
  'r6-ram': { local: 'review/local-assets/r6s-operator-ability-ram.png' },
  'r6-aruni': { file: 'Surya_Gate.png', width: 400 },
  'r6-goyo': { file: 'Volcán_Shield.png' },
  'r6-lesion': { file: 'Gu.png' },
  'r6-vigil': { file: 'ERC-7.png' },
};

// Pinned operator portraits (user-supplied, vendored 256px under
// review/local-assets/): Deimos/Skopós/Tubarão have no upstream icon file;
// Buck/Frost/Tachanka are stuck on legacy icons upstream. Wiki can never
// clobber these; resyncs converge to the same manifest entries.
const ICON_OVERRIDES = {
  'r6-deimos': { local: 'review/local-assets/deimos-icon.webp' },
  'r6-skop-s': { local: 'review/local-assets/skopos-icon.webp' },
  'r6-tubar-o': { local: 'review/local-assets/tubarao-icon.webp' },
  'r6-buck': { local: 'review/local-assets/buck-badge.webp' },
  'r6-frost': { local: 'review/local-assets/frost-badge.webp' },
  'r6-tachanka': { local: 'review/local-assets/tachanka-badge.webp' },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function apiGet(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', ...params })}`;
  const response = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function categoryMembers(category, limit = 500) {
  const members = [];
  let cmcontinue = undefined;
  for (;;) {
    const data = await apiGet({
      action: 'query', list: 'categorymembers', cmtitle: category,
      cmlimit: 100, cmtype: 'page', ...(cmcontinue ? { cmcontinue } : {}),
    });
    members.push(...(data.query?.categorymembers || []).map((m) => m.title));
    cmcontinue = data.continue?.cmcontinue;
    if (!cmcontinue || members.length >= limit) break;
    await sleep(SLEEP_MS);
  }
  return members;
}

async function wikitext(title) {
  const data = await apiGet({ action: 'parse', page: title, prop: 'wikitext' });
  if (data.error) throw new Error(`${title}: ${data.error.info}`);
  return data.parse.wikitext['*'];
}

async function categoriesFor(titles) {
  const out = {};
  for (let i = 0; i < titles.length; i += 25) {
    const batch = titles.slice(i, i + 25);
    let clcontinue = undefined;
    const batchOut = {};
    const redirectTo = {};
    for (;;) {
      const data = await apiGet({ action: 'query', prop: 'categories', titles: batch.join('|'), cllimit: 500, redirects: 1, ...(clcontinue ? { clcontinue } : {}) });
      for (const r of data.query?.redirects || []) redirectTo[r.from] = r.to;
      for (const page of Object.values(data.query?.pages || {})) {
        batchOut[page.title] = [...(batchOut[page.title] || []), ...((page.categories || []).map((c) => c.title))];
      }
      clcontinue = data.continue?.clcontinue;
      if (!clcontinue) break;
      await sleep(SLEEP_MS);
    }
    Object.assign(out, batchOut);
    for (const [from, to] of Object.entries(redirectTo)) {
      if (out[to] && !out[from]) out[from] = out[to];
    }
    await sleep(SLEEP_MS);
  }
  return out;
}

// --- markup stripping -------------------------------------------------------

function stripMarkup(text) {
  let out = String(text || '');
  out = out.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '').replace(/<ref[^/]*\/>/gi, '');
  out = out.replace(/\[(?:https?:)?\/\/[^\]\s]+\s*([^\]]*)\]/gi, '$1');
  for (let i = 0; i < 6; i++) {
    if (!/\{\{[^{}]*\|[^\n{}]*\}\}/.test(out)) break;
    out = out.replace(/\{\{[^{}]*\|([^\n{}|]+)\}\}/g, '$1');
  }
  for (let i = 0; i < 6; i++) {
    if (!/\{\{[^{}]*\}\}/.test(out)) break;
    out = out.replace(/\{\{[^{}]*\}\}/g, '');
  }
  out = out.replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, '');
  out = out.replace(/\[\[([^|\]]*\|)?([^\]]+)\]\]/g, '$2');
  out = out.replace(/<\/?[a-z][^>]*>/gi, '');
  out = out.replace(/'''?/g, '');
  out = out.replace(/&(#[0-9]+|[a-z]+);/gi, ' ');
  out = out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

function infoboxField(wt, name) {
  const match = wt.match(new RegExp(`\\|${name}\\s*=([\\s\\S]*?)(?=\\n\\|[a-zA-Z0-9]+\\s*=|\\n\\}\\})`));
  return match ? match[1].trim() : '';
}

const KNOWN_SQUADS = ['SAS', 'FBI SWAT', 'GIGN', 'Spetsnaz', 'GSG 9', 'JTF2', 'SEALs', 'BOPE', 'SAT', 'GEO', 'SDU', 'GROM', '707th', 'CBRN', 'GIS', 'GSUT', 'MPS', 'GIGR', 'SASR', 'Nighthaven', 'Ghosteyes', 'Redhammer', 'Viperstrike', 'Wolfguard'];
function allLinkTexts(markup) {
  return [...String(markup).matchAll(/\[\[([^\]]+)\]\]/g)]
    .map((m) => m[1].split('|'))
    .filter((parts) => !/^\s*(File|Image|Category):/i.test(parts[0]))
    .map((parts) => parts[parts.length - 1].trim())
    .filter(Boolean);
}
function firstWikiLinkText(markup) {
  const links = allLinkTexts(markup);
  return links[0] || stripMarkup(markup).split('<')[0].trim();
}
function squadFromOrg(markup) {
  const links = allLinkTexts(markup);
  const hit = links.find((text) => KNOWN_SQUADS.some((squad) => text.toLowerCase() === squad.toLowerCase()));
  if (hit) return hit;
  const nonRainbow = links.find((text) => text.toLowerCase() !== 'rainbow');
  return nonRainbow || 'Rainbow';
}

function dotCount(markup) {
  return (String(markup).match(/&#9679;/g) || []).length;
}

// Roles are single-line CSV ("Front-line, Hard-Breach") but upstream
// appends same-line params ("|imagecaption=") or closes the infobox
// mid-line ("}}"), bleeding prose into the value. Take the clean head.
function cleanRole(raw) {
  return stripMarkup(String(raw || '')).split(/\n|\}\}|\|/)[0].trim().slice(0, 120);
}

// Ability prose comes from fragile fallbacks (post-table capture,
// intro-sentence regex) that can start inside link/template residue
// ("|Tubarão}}Isaac ...", "]] Aleksandr ..."). Strip leading junk.
// Strict mode (post-table capture) additionally requires operator prose;
// the intro path is already scoped by its own sentence regex.
function cleanAbility(raw, strict) {
  let text = stripMarkup(String(raw || '')).replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i += 1) {
    const next = text.replace(/^(\|?[^\s|]*\}\}|\]\]|"{0,2}\s*[\]|}]+)+/, '').trim();
    if (next === text) break;
    text = next;
  }
  if (!/^[A-Z"'(]/.test(text)) return '';
  if (strict && !/Operator/i.test(text.slice(0, 400))) return '';
  return text.slice(0, 600);
}

function introParagraph(wt) {
  const clean = wt.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '').replace(/\[(?:https?:)?\/\/[^\]]*\]/gi, '');
  const sentence = clean.match(/([^.\n]{20,400}?is an? (?:Attacking|Defending)[^.\n]*\.)/);
  if (sentence) return stripMarkup(sentence[1]).slice(0, 600);
  const lines = clean.split('\n');
  for (const line of lines) {
    if (line.startsWith("'''") && line.length > 20) return stripMarkup(line);
  }
  return '';
}

async function pageImages(titles) {
  const out = {};
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    let imcontinue = undefined;
    for (;;) {
      const data = await apiGet({ action: 'query', prop: 'images', titles: batch.join('|'), imlimit: 500, redirects: 1, ...(imcontinue ? { imcontinue } : {}) });
      const redirectTo = {};
      for (const r of data.query?.redirects || []) redirectTo[r.from] = r.to;
      for (const page of Object.values(data.query?.pages || {})) {
        out[page.title] = [...(out[page.title] || []), ...((page.images || []).map((img) => img.title.replace(/^File:/, '')))];
      }
      for (const [from, to] of Object.entries(redirectTo)) {
        if (out[to] && !out[from]) out[from] = out[to];
      }
      imcontinue = data.continue?.imcontinue;
      if (!imcontinue) break;
      await sleep(SLEEP_MS);
    }
    await sleep(SLEEP_MS);
  }
  return out;
}

function pickFile(files, patterns) {
  for (const pattern of patterns) {
    const hit = files.find((f) => pattern.test(f));
    if (hit) return hit;
  }
  return null;
}

function parseLoadout(wt) {
  const row = (name) => {
    // Upstream uses "|primary = " (spaced) on newer pages.
    const match = wt.match(new RegExp(`\\|${name}\\s*=((?:(?!(?:\\s*/)?\\s*\\|(?:primary|secondary|gadget|ability)\\s*=)[\\s\\S])*)`, 'i'));
    const scope = match ? match[1] : '';
    const names = [];
    for (const m of scope.matchAll(/\*\[\[([^\]]+)\]\]/g)) {
      const parts = m[1].split('|');
      const display = (parts[1] || parts[0]).split('#')[0].replace(/_/g, ' ').trim();
      if (display && !names.includes(display)) names.push(display);
    }
    return names;
  };
  const tableFallback = (isGadget, name) => {
    const table = wt.match(/\{\|[^\n]*\n!colspan="2"\|Loadout([\s\S]*?)\|\}/);
    if (!table) return [];
    // Row headers are capitalized ("|Primary", "|Gadget x 2"); rows end at
    // the next "|-" divider or the table capture end.
    const header = isGadget ? '[^|\\n]*Gadget[^|\\n]*' : name;
    const match = table[1].match(new RegExp(`\\|\\s*${header}\\s*\\n([\\s\\S]*?)(?=\\n\\s*\\|-\\s*\\n|$)`, 'i'));
    if (!match) return [];
    // Prefer display text: [[MAC-11#Sieg|SMG-11]] is the SMG-11.
    const names = [];
    for (const m of match[1].matchAll(/\*\[\[([^\]]+)\]\]/g)) {
      const parts = m[1].split('|');
      const display = (parts[1] || parts[0]).split('#')[0].replace(/_/g, ' ').trim();
      if (display && !names.includes(display)) names.push(display);
    }
    return names;
  };
  const pick = (name) => {
    const direct = row(name);
    if (direct.length) return direct;
    return tableFallback(name === 'gadget', name === 'gadget' ? '' : name);
  };
  return { primaries: pick('primary'), secondaries: pick('secondary'), gadgets: pick('gadget') };
}

function matchWeaponFile(files, baseName, weaponName) {
  const prefix = `${baseName} - `.toLowerCase();
  const cands = files.filter((f) => f.replace(/_/g, ' ').toLowerCase().startsWith(prefix)
    && /\.(png|webp|jpg|jpeg)$/i.test(f) && !/\(/.test(f));
  if (!cands.length) return null;
  const token = weaponName.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return cands.find((f) => f.toLowerCase().replace(/[^a-z0-9]+/g, '').includes(token)) || null;
}

// --- operators --------------------------------------------------------------

function normalizeOperatorTitles(titles) {
  const JUNK = /\(Extraction\)|\(Novel\)|\(TV series\)|\(Disambig\)|\(Codex\)|Flubber|Breacher \(Operator\)|Assaulter|Bishop|Pointman|Protector|Recruit|Striker|Sentry|Trapper|Bosak|Patcher|Reserves/i;
  const CROSSOVER = new Set(['Solid Snake']);
  const byName = new Map();
  for (const title of titles) {
    if (JUNK.test(title)) continue;
    const name = title.replace(/ \(Siege\)$/, '');
    const siege = title.endsWith(' (Siege)');
    if (!byName.has(name) || !siege) byName.set(name, title);
  }
  return [...byName.entries()].map(([name, title]) => ({ name, title, crossover: CROSSOVER.has(name) }));
}

function parseOperator(title, wt, seasonCat) {
  const position = stripMarkup(infoboxField(wt, 'position'));
  const side = /defender/i.test(position) ? 'Defender' : /attacker/i.test(position) ? 'Attacker' : '';
  if (!side) return null;
  const org = infoboxField(wt, 'organization');
  const squad = squadFromOrg(org);
  const abilityRaw = infoboxField(wt, 'ability') || infoboxField(wt, 'ability1');
  const abilityNoFile = abilityRaw.replace(/\[\[File:[^\]]*\]\]/gi, '');
  let gadget = stripMarkup(abilityNoFile.split(/<br[^>]*>/i).find((seg) => stripMarkup(seg)) || '').slice(0, 80);
  if (!gadget) {
    const tableAbility = wt.match(/\|\s*Ability\s*\n?\s*\[\[File:[^\]]*\]\](?:<br[^>]*>)?\s*\{\{Color\|[^|}]+\|([^}]+)\}\}/);
    if (tableAbility) gadget = stripMarkup(tableAbility[1]).slice(0, 80);
  }
  if (!gadget) {
    const goldGadget = wt.match(/\{\{Color\|#ccac00\|([^}]+)\}\}/);
    if (goldGadget) gadget = stripMarkup(goldGadget[1]).split('<')[0].trim().slice(0, 80);
  }
  if (!gadget) {
    const proseGadget = wt.match(/(?:Unique Gadget|gadget) is (?:the|an|a) ([A-Z0-9][^.,;]{2,60})/);
    if (proseGadget) gadget = stripMarkup(proseGadget[1]).trim().slice(0, 80);
  }
  const abilityFileMatch = (abilityRaw.match(/\[\[File:([^\]|]+)/) || [])
    .concat([null]);
  const gadgetFile = abilityFileMatch[1]
    || (wt.match(/\|\s*Ability\s*\n?\s*\[\[File:([^\]|]+)/) || [])[1]
    || null;
  const quoteMatch = wt.match(/\{\{Quote\|([^|}]+)/);
  const loadout = parseLoadout(wt);
  return {
    id: `r6-${title.replace(/ \(Siege\)$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: title.replace(/ \(Siege\)$/, ''),
    side,
    squad: squad || 'Rainbow',
    season: seasonCat ? seasonCat.replace(/^Category:Tom Clancy's Rainbow Six Siege:\s*/, '')
      : (/introduced in (?:the )?'{0,2}\[\[([^|\]]+)(?:\|[^\]]+)?\]\]/.test(wt)
        ? RegExp.$1.replace(/^Tom Clancy's Rainbow Six Siege:\s*/, '') : 'Launch'),
    role: cleanRole(infoboxField(wt, 'role')),
    gadget,
    ability: (() => {
      const afterTable = wt.match(/\|\}[ \n\/]*([A-Z][^\n\{]{60,500})/);
      if (afterTable) {
        const cleaned = cleanAbility(afterTable[1], true);
        if (cleaned) return cleaned;
      }
      return cleanAbility(introParagraph(wt), false);
    })(),
    realname: stripMarkup(infoboxField(wt, 'realname')).slice(0, 80),
    quote: quoteMatch ? stripMarkup(quoteMatch[1]).slice(0, 200) : '',
    armor: dotCount(infoboxField(wt, 'armor')),
    speed: dotCount(infoboxField(wt, 'speed')),
    gadgetFile,
    loadout,
  };
}

// --- maps -------------------------------------------------------------------

function parseMap(title, wt) {
  if (!/\{\{Infobox\/map/.test(wt)) return null;
  const playlists = stripMarkup(infoboxField(wt, 'playlists'));
  const modes = stripMarkup(infoboxField(wt, 'modes'));
  // Keep standard-rotation maps: ranked/unranked/quick-match presence, classic
  // modes, or no playlist signal at all (older pages). Drop event/TDM-only maps.
  if (/Dual Front|Sugar Fright|Sweet Hunt/i.test(playlists + ' ' + modes)) return null;
  if (/Team Deathmatch/i.test(modes) && !/Bomb|Secure Area|Hostage/i.test(modes)) return null;
  const standard = /Ranked|Unranked|Quick Match|Newcomer|Custom/i.test(playlists)
    || /Bomb|Secure Area|Hostage|^All$/i.test(modes)
    || (!playlists && !modes);
  const galleryFiles = infoboxField(wt, 'image').split('\n')
    .map((line) => line.split('|')[0].trim().replace(/^\[\[(File:)?/i, '').replace(/\]\]$/, ''))
    .filter((line) => line && !/[<>]/.test(line) && !/^gallery$/i.test(line) && !/^(File|Image):/i.test(line));
  const galleryImage = galleryFiles.find((f) => !/Mobile|R6M /i.test(f)) || galleryFiles[0] || null;
  const place = stripMarkup(infoboxField(wt, 'place')).slice(0, 160);
  const terrain = stripMarkup(infoboxField(wt, 'terrain')).slice(0, 80);
  if (!place && !terrain) return null;
  const intro = introParagraph(wt) || stripMarkup((wt.match(/\{\{Quote\|([^|}]+)/) || [])[1] || '');
  return {
    id: `r6-${title.replace(/ \(Siege\)$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: title.replace(/ \(Siege\)$/, ''),
    setting: place,
    terrain: terrain,
    galleryImage,
    modes: ['Bomb', 'Secure Area', 'Hostage'],
    blurb: intro.slice(0, 400),
    bombSites: parseBombSites(wt),
  };
}

// Bomb site pairs from the map page Features section. Two formats:
//  bullets: a Bomb header bullet (`*[[Bomb]]`, `:*[[Bomb (Siege)|Bomb]]`)
//  followed by deeper-bullet site lines until the next category;
//  table: a wikitable with `!rowspan|[[Bomb (Siege)|Bomb]]` followed by
//  `|A & B` cells until the next rowspan category or `|}`.
function parseBombSites(wt) {
  const text = String(wt || '').replace(/\r/g, '');
  const tableRow = text.match(/!rowspan="\d+"\|+.*?\[\[Bomb[^\]]*\]\][^\n]*\n([\s\S]*?)(?=!rowspan|\|})/i);
  if (tableRow) {
    const tablePairs = [];
    for (const cell of tableRow[1].split('\n')) {
      const m = cell.trim().match(/^\|([^|]+?)\s*$/);
      if (!m || /rowspan|colspan/i.test(m[1]) || /^-+$/.test(m[1].trim())) continue;
      const clean = stripMarkup(m[1]).replace(/\s+/g, ' ').trim();
      if (!clean) continue;
      const parts = clean.split(/\s+and\s+|\s*&\s*|\s*\/\s*/).map((s) => s.trim()).filter(Boolean);
      if (parts.length) tablePairs.push(parts.slice(0, 3));
    }
    if (tablePairs.length) return tablePairs;
  }
  const lines = text.split('\n');
  const pairs = [];
  let inBomb = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!inBomb) {
      if (/^:{0,2}\*+\s*(\[\[[^\]]*Bomb[^\]]*\]\]|Bomb)/i.test(line) && !/Secure|Hostage/i.test(line)) inBomb = true;
      continue;
    }
    if (/^==/.test(line)) break;
    if (/hatch/i.test(line)) break;
    if (/^:{0,1}\*[^*:]/.test(line)) break;
    const m = line.match(/^[:*]{2,}\s*(.+?)\s*$/);
    if (!m) continue;
    const clean = stripMarkup(m[1]).replace(/\[\[[^\]]*\]\]/g, '').replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    const parts = clean.split(/\s+and\s+|\s*&\s*|\s*\/\s*/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) pairs.push(parts.slice(0, 3));
    if (pairs.length >= 6) break;
  }
  return pairs;
}

// --- seasons ----------------------------------------------------------------

function parseSeason(title, wt) {
  if (!/\{\{Infobox dlc/.test(wt)) return null;
  const seasonLabel = stripMarkup(infoboxField(wt, 'season'));
  const yearMatch = seasonLabel.match(/Year (\d+).*Season (\d+)/i);
  if (!yearMatch) return null;
  const quoteMatch = wt.match(/\{\{Quote\|([^|}]+)/);
  const intro = introParagraph(wt);
  const rawName = stripMarkup(infoboxField(wt, 'name')) || title.replace(/^Tom Clancy's Rainbow Six Siege:\s*/, '');
  const code = `Y${yearMatch[1]}S${yearMatch[2]}`;
  // The wiki's Y11S4 infobox misspells its own name ("...Season Three");
  // trust the Year/Season fields over the name string.
  const fixedName = (code === 'Y11S4' && /Three/i.test(rawName)) ? rawName.replace(/Three/i, 'Four') : rawName;
  const mapField = infoboxField(wt, 'map');
  const mapLinks = [...mapField.matchAll(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g)]
    .filter((m) => !/^(File|Image|Category):/i.test(m[1].trim()))
    .map((m) => (m[2] || m[1]).trim())
    .filter((t) => t && !/^(File|Image|Category):/i.test(t))
    .slice(0, 8);
  const operatorField = infoboxField(wt, 'operator');
  const seasonOperators = [...operatorField.matchAll(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g)]
    .filter((m) => !/^(File|Image|Category):/i.test(m[1].trim()))
    .map((m) => (m[2] || m[1]).trim())
    .filter((t) => t && !/^(File|Image|Category):/i.test(t))
    .slice(0, 6);
  return {
    id: `r6-${fixedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`,
    name: fixedName,
    code,
    year: Number(yearMatch[1]),
    released: stripMarkup(infoboxField(wt, 'released')).split('|')[0].trim().slice(0, 60),
    operators: [],
    map: mapLinks[0] || '',
    maps: mapLinks,
    patch: stripMarkup(infoboxField(wt, 'patch')).split('|')[0].trim().slice(0, 80),
    coverFile: (() => {
      const img = infoboxField(wt, 'image').split('\n')[0].split('|')[0].trim().replace(/^\[\[(File:)?/i, '').replace(/\]\]$/, '');
      return img && !/[<>]/.test(img) ? img : null;
    })(),
    seasonOperators,
    squad: stripMarkup(infoboxField(wt, 'ctu')).slice(0, 120),
    blurb: (quoteMatch ? stripMarkup(quoteMatch[1]) + ' ' : '').slice(0, 0) || intro.slice(0, 400),
  };
}

// --- main -------------------------------------------------------------------

async function main() {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });

  console.log('sync-r6: listing seasons...');
  const seasonTitles = (await categoryMembers('Category:Expansions of R6 Siege'))
    .filter((t) => /Tom Clancy's Rainbow Six Siege:/.test(t));
  const seasons = [];
  for (const title of seasonTitles) {
    try {
      const season = parseSeason(title, await wikitext(title));
      if (season) seasons.push(season);
    } catch (error) {
      console.warn(`sync-r6: failed season ${title}: ${error.message}`);
    }
    await sleep(SLEEP_MS);
  }
  seasons.sort((a, b) => a.year - b.year || a.code.localeCompare(b.code));
  const validSeasons = new Set(seasons.flatMap((s) => [s.name, s.name.replace(/^Operation /, '')]));
  console.log(`sync-r6: seasons=${seasons.length}`);

  console.log('sync-r6: listing operators...');
  const sideMembers = [
    ...(await categoryMembers('Category:Attacker')),
    ...(await categoryMembers('Category:Defender')),
  ];
  const opTitles = normalizeOperatorTitles(sideMembers.length ? sideMembers : await categoryMembers('Category:Rainbow Operators'));
  console.log(`sync-r6: ${opTitles.length} operator candidates`);
  const opCats = await categoriesFor(opTitles.map((o) => o.title));

  const operators = [];
  for (const { name, title, crossover } of opTitles) {
    try {
      const wt = await wikitext(title);
      const seasonCats = (opCats[title] || [])
        .filter((c) => c.startsWith("Category:Tom Clancy's Rainbow Six Siege:"))
        .filter((c) => validSeasons.has(c.replace(/^Category:Tom Clancy's Rainbow Six Siege:\s*/, '').replace(/^Operation /, '')));
      const op = parseOperator(title, wt, seasonCats.length === 1 ? seasonCats[0] : null);
      if (op) {
        if (crossover) op.crossover = true;
        // Known-stale Fandom infoboxes (see scripts/r6-stat-truth.js):
        // live patch-note truth wins over the parsed dots.
        const statFix = lookupStatOverride(op.name);
        if (statFix) {
          console.log(`sync-r6: stat-truth override ${op.name} -> ${statFix.health}-${statFix.speed}`);
          op.armor = statFix.health;
          op.speed = statFix.speed;
        }
        operators.push(op);
      }
      else console.warn(`sync-r6: skipped ${title} (no attacker/defender infobox)`);
    } catch (error) {
      console.warn(`sync-r6: failed ${title}: ${error.message}`);
    }
    await sleep(SLEEP_MS);
  }
  console.log(`sync-r6: operators=${operators.length}`);

  console.log('sync-r6: resolving operator images...');
  const opImages = await pageImages(opTitles.map((o) => o.title));
  const opTitleById = new Map(operators.map((op) => [op.id, opTitles.find((o) => o.name === op.name)?.title || op.name]));
  const manifest = {};
  try {
    // Merge over the existing manifest: other syncs (gadgets, lore) own
    // their entries and must survive a data resync — never overwrite blank.
    const existing = JSON.parse(fs.readFileSync(path.join(ROOT, 'review', 'r6-image-manifest.json'), 'utf8')).images || {};
    Object.assign(manifest, existing);
  } catch { /* first run: no manifest yet */ }
  const local = (rel, file, width) => {
    if (!file) return null;
    manifest[rel] = { file, width };
    return rel;
  };
  // Icon/hero/gadget picks: name-anchored, denylisted, null-on-miss.
  // A wrong face is worse than a fallback SVG, so the icon has NO
  // unanchored fallback — it must contain the operator's name token.
  const ICON_DENY = /credits|renown|beta|small|ability|panel|shell|gadget|weapon|portrait|full.?body|profile|turn-around|operator.?card|elite|charm|skin|loadout|badge|flag|logo|hud|video|trailer|gameplay|concept|chibi|spray|bundle|set\b|uniform|headgear/i;
    const normName = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[øØ]/g, 'o').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const pickIcon = (files, baseName) => {
    const token = normName(baseName);
    const stemOf = (f) => normName(f.replace(/\.(png|webp|jpg|jpeg)$/i, '').replace(/^y\d+s\d+\s*-?\s*/i, ''));
    const anchored = files.filter((f) => stemOf(f).startsWith(token) && !ICON_DENY.test(f));
    const exact = (suffix) => anchored.find((f) => stemOf(f) === token + suffix);
    const hit = exact('newesticon') || exact('iconn') || exact('iconstandard') || exact('icon');
    if (hit) return hit;
    // Last resort: anchored real face that only failed the soft denylist
    // (e.g. legacy "Small" icons). Must still look like an icon/portrait —
    // never concept art, bundles, or currency.
    const HARD_DENY = /credits|renown|beta|ability|panel|gadget|weapon|portrait|body|profile|card|elite|concept|bundle|artwork|spray|charm|skin|uniform|headgear|loadout|trailer|video|gameplay|poster|keyart|wallpaper|meme/i;
    const fallback = files.find((f) => stemOf(f).startsWith(token) && /icon|badge|avatar|head/i.test(f) && !HARD_DENY.test(f));
    if (fallback) console.warn(`sync-r6: degraded icon for ${baseName} (${fallback})`);
    return fallback || null;
  };
  const pickHero = (files, baseName) => {
    const fullBody = files.filter((f) => /Full[ _-]?Body/i.test(f) && !/elite/i.test(f));
    if (fullBody.length) return fullBody[0];
    const inGame = files.filter((f) => /In-game Fullbody/i.test(f) && !/elite/i.test(f));
    if (inGame.length) return inGame[0];
    const portraitExact = new RegExp(`^${baseName.replace(/[^a-z0-9]+/gi, '[ _-]')} +Portrait\\.png$`, 'i');
    const portrait = files.find((f) => portraitExact.test(f));
    if (portrait) return portrait;
    const profile = files.find((f) => /Profile\.png/i.test(f) && !ICON_DENY.test(f));
    if (profile) return profile;
    const elite = files.find((f) => /ElitePortrait/i.test(f));
    if (elite) {
      console.warn(`sync-r6: elite-only hero for ${baseName} (${elite})`);
      return elite;
    }
    return null;
  };
  operators.forEach((op) => {
    const title = opTitleById.get(op.id);
    const files = opImages[title] || [];
    const baseName = title.replace(/ \(Siege\)$/, '');
    const iconOverride = ICON_OVERRIDES[op.id];
    const iconFile = iconOverride?.local ? null : pickIcon(files, baseName);
    if (!iconFile && !iconOverride?.local) console.warn(`sync-r6: no anchored icon for ${baseName}`);
    const heroFile = pickHero(files, baseName);
    if (!heroFile) console.warn(`sync-r6: no hero for ${baseName}`);
    if (iconOverride?.local) {
      manifest[`r6_images/operators/icons/${op.id}.png`] = { local: iconOverride.local };
      op.icon = `r6_images/operators/icons/${op.id}.png`;
    } else {
      op.icon = local(`r6_images/operators/icons/${op.id}.png`, iconFile, 256);
    }
    op.hero = local(`r6_images/operators/heroes/${op.id}.png`, heroFile, 400);
    let gadgetFile = op.gadgetFile;
    if (!gadgetFile && op.gadget) {
      const token = op.gadget.toLowerCase().replace(/\sx\s*\d+$/, '').replace(/[^a-z0-9]+/g, '');
      if (token.length >= 5) {
        gadgetFile = files.find((f) => {
          const n = f.toLowerCase().replace(/[^a-z0-9]+/g, '');
          return n.includes(token) && /\.(png|webp|jpg|jpeg)$/i.test(f)
            && !/credits|renown|beta|newesticon|portrait|operator.?card|elite|IconN|Full[ _-]?Body|Profile\.png|turn-around/i.test(f);
        }) || null;
      }
    }
    if (gadgetFile && iconFile && gadgetFile === iconFile) {
      console.warn(`sync-r6: gadget==icon for ${baseName}, dropping gadget icon`);
      gadgetFile = null;
    }
    let gadgetWidth = null, gadgetInvert = false;
    const gadgetOverride = GADGET_ICON_OVERRIDES[op.id];
    if (gadgetOverride) {
      if (gadgetOverride.local) {
        // Pinned repo-vendored art (user-supplied): wiki can never clobber it.
        manifest[`r6_images/gadgets/${op.id}.png`] = { local: gadgetOverride.local };
        op.gadgetIcon = `r6_images/gadgets/${op.id}.png`;
      } else {
        gadgetFile = gadgetOverride.file;
        gadgetWidth = gadgetOverride.width || null;
        gadgetInvert = !!gadgetOverride.invert;
      }
    }
    if (!op.gadgetIcon) {
      op.gadgetIcon = local(`r6_images/gadgets/${op.id}.png`, gadgetFile, gadgetWidth);
      if (op.gadgetIcon && gadgetInvert) manifest[`r6_images/gadgets/${op.id}.png`].invert = true;
    }
    op.weapons = [];
    let weaponIndex = 0;
    for (const gadgetName of op.loadout.gadgets || []) {
      op.weapons.push({ slot: 'gadget', name: gadgetName, image: null });
    }
    for (const [slot, names] of [['primary', op.loadout.primaries], ['secondary', op.loadout.secondaries]]) {
      for (const weaponName of names) {
        weaponIndex += 1;
        const file = matchWeaponFile(files, baseName, weaponName);
        op.weapons.push({
          slot, name: weaponName,
          image: local(`r6_images/weapons/${op.id}-${weaponIndex}.png`, file, 320),
        });
      }
    }
    delete op.gadgetFile;
    delete op.loadout;
  });
  const iconCount = operators.filter((op) => op.icon).length;
  const heroCount = operators.filter((op) => op.hero).length;
  const gadgetIconCount = operators.filter((op) => op.gadgetIcon).length;
  const weaponCount = operators.reduce((n, op) => n + op.weapons.filter((w) => w.image).length, 0);
  const weaponTotal = operators.reduce((n, op) => n + op.weapons.length, 0);
  console.log(`sync-r6: images icons=${iconCount} heroes=${heroCount} gadgetIcons=${gadgetIconCount} weapons=${weaponCount}/${weaponTotal}`);

  console.log('sync-r6: resolving weapon renders...');
  const weaponNames = [...new Set(operators.flatMap((op) => op.weapons.map((w) => w.name)))];
  const weaponImages = await pageImages(weaponNames);
  const weaponTitleByName = new Map();
  weaponNames.forEach((name) => {
    weaponTitleByName.set(name, Object.keys(weaponImages).find((t) => t.toLowerCase() === name.toLowerCase()) || name);
  });
  let weaponResolved = 0;
  operators.forEach((op) => {
    const baseName = op.name;
    op.weapons.forEach((weapon) => {
      // Gadget slots render via canonical gadget art (gadgetId) — they must
      // never claim indexed weapon paths (that clobbers primary art).
      if (weapon.image || weapon.slot === 'gadget') return;
      const files = weaponImages[weaponTitleByName.get(weapon.name)] || [];
      const opToken = baseName.toLowerCase().replace(/[^a-z0-9]+/g, '');
      const specific = files.find((f) => /R6S /i.test(f) && f.toLowerCase().replace(/[^a-z0-9]+/g, '').includes(opToken) && /\.(png|webp|jpg|jpeg)$/i.test(f) && !/\(/.test(f));
      const generic = files.find((f) => /^R6S /i.test(f.replace(/_/g, ' ')) && /\.(png|webp|jpg|jpeg)$/i.test(f) && !/\(/.test(f));
      const file = specific || generic || null;
      if (file) {
        weapon.image = local(`r6_images/weapons/${op.id}-${op.weapons.indexOf(weapon) + 1}.png`, file, 320);
        weaponResolved += 1;
      }
    });
  });
  console.log(`sync-r6: weapon renders=${weaponResolved}/${weaponTotal}`);

  console.log('sync-r6: listing maps...');
  const mapTitles = (await categoryMembers('Category:Siege Maps'))
    .filter((t) => !t.startsWith('Template:') && !/Article 5|CQB Basics/i.test(t));
  const maps = [];
  for (const title of mapTitles) {
    try {
      const map = parseMap(title, await wikitext(title));
      if (map) maps.push(map);
      else console.log(`sync-r6: skipped map ${title} (not ranked rotation)`);
    } catch (error) {
      console.warn(`sync-r6: failed map ${title}: ${error.message}`);
    }
    await sleep(SLEEP_MS);
  }
  console.log(`sync-r6: maps=${maps.length}`);

  console.log('sync-r6: resolving map thumbnails + official blueprint layouts...');
  const mapImages = await pageImages(mapTitles);
  const mapTitleById = new Map(maps.map((m) => [m.id, mapTitles.find((t) => t === m.name || t === `${m.name} (Siege)`) || m.name]));
  // Official Ubisoft blueprint zips (current Siege X renders, fetched live).
  // Per-map level stacks verified Sept 2026 against Fandom galleries + visual
  // inspection of every zip. `levels` = [floor, label?] in zip-file order
  // (blueprint-N ascending, low to high); `use` selects 1-based indices when
  // the zip carries overview/void extras. Labels default to canonical names.
  const UBI_BP = 'https://ubistatic-a.ubisoft.com/0106/gamesites/rainbow6/blueprints/';
  const B = 'basement', F1 = 'floor-1', F2 = 'floor-2', F3 = 'floor-3', RF = 'roof';
  const MAP_BLUEPRINTS = {
    'r6-bank': { zip: 'r6-maps-bank-blueprints.zip', levels: [[B], [F1], [F2], [RF]] },
    'r6-border': { zip: 'r6-maps-border-blueprints.zip', levels: [[F1], [F2], [RF]] },
    'r6-calypso-casino': { zip: 'r6-maps-calypso-casino-blueprints.zip', named: true },
    'r6-chalet': { zip: 'r6-maps-chalet-blueprints.zip', levels: [[B], [F1], [F2], [RF]] },
    'r6-clubhouse': { zip: 'r6-maps-clubhouse-blueprints.zip', levels: [[B], [F1], [F2], [RF]] },
    'r6-coastline': { zip: 'r6-maps-coastline-blueprints.zip', levels: [[F1], [F2], [RF]] },
    'r6-consulate': { zip: 'r6-maps-consulate-blueprints_may23.zip', levels: [[B], [F1], [F2], [RF]] },
    'r6-emerald-plains': { zip: 'r6-maps-emeraldplains-blueprints.zip', levels: [[F1], [F2], [RF]] },
    'r6-favela': { zip: 'r6-maps-favela-blueprints.zip', use: [1, 2, 3, 4], levels: [[F1], [F2], [F3], [RF]] },
    'r6-fortress': { zip: 'r6-maps-fortress-blueprints.zip', levels: [[F1], [F2], [RF]] },
    'r6-hereford-base-rework-': { zip: 'r6-maps-hereford-blueprints.zip', levels: [[B], [F1], [F2], [F3], [RF]] },
    'r6-house': { zip: 'r6-maps-house-blueprints.zip', levels: [[B], [F1], [F2], [RF]] },
    'r6-kafe-dostoyevsky': { zip: 'r6-maps-kafe-blueprints.zip', levels: [[F1], [F2], [F3], [RF]] },
    'r6-kanal': {
      zip: 'r6-maps-kanal-blueprints.zip',
      levels: [[F1, 'Ground'], [F1, 'Ground 2'], [F2, '1st Floor'], [F2, '2nd Floor'], [RF, 'Roof']],
    },
    'r6-lair': { zip: 'r6-maps-lair-blueprints.zip', levels: [[B], [F1], [F2], [RF]] },
    'r6-nighthaven-labs': { zip: 'r6-maps-nighthavenlabs-blueprints.zip', levels: [[B], [F1], [F2], [RF]] },
    'r6-oregon': {
      zip: 'r6-maps-oregon-blueprints.zip',
      levels: [[B, 'Basement'], [F1, 'Ground'], [F1, '1st Floor'], [F2, '2nd Floor'], [RF, 'Roof']],
    },
    'r6-outback': { zip: 'r6-maps-outback-blueprints.zip', levels: [[F1], [F2], [RF]] },
    'r6-presidential-plane': { zip: 'r6-maps-plane-blueprints.zip', use: [2, 3, 4], levels: [[F1], [F2], [RF]] },
    'r6-skyscraper': { zip: 'r6-maps-skyscraper-blueprints.zip', levels: [[F1], [F2], [RF]] },
    'r6-theme-park': { zip: 'r6-maps-themepark-blueprints.zip', levels: [[F1], [F2], [RF]] },
    'r6-tower': { zip: 'r6-maps-tower-blueprints.zip', levels: [[B], [F1], [F2], [RF]] },
    'r6-villa': { zip: 'r6-maps-villa-blueprints.zip', use: [1, 3, 4], levels: [[B], [F1], [F2]] },
    'r6-yacht': {
      zip: 'r6-maps-yacht-blueprints.zip',
      levels: [[B, 'Basement'], [F1, 'Ground'], [F1, '1st Floor'], [F2, '2nd Floor'], [RF, 'Roof']],
    },
  };
  // Legacy Fandom supplements: explicit per-file rules (no Ubi source for
  // bartlett/stadium/hereford-orig, or a level zips lack). One layout max
  // per rule — the old grab-everything behavior piled 37 files on Bartlett.
  const RETAIN_FANDOM = {
    'r6-bank': [
      { match: /Alley Access \(spawn\)/i, floor: 'spawn', label: 'Alley Access' },
      { match: /Jewelry Front \(spawn\)/i, floor: 'spawn', label: 'Jewelry Front' },
      { match: /Parking Front \(spawn\)/i, floor: 'spawn', label: 'Parking Front' },
    ],
    'r6-presidential-plane': [
      { match: /basement secure floor/i, floor: 'basement', label: 'Basement' },
    ],
    'r6-bartlett-u-': [
      { match: /floor 1/i, floor: 'floor-1' },
      { match: /floor 2/i, floor: 'floor-2' },
      { match: /roof/i, floor: 'roof' },
    ],
    'r6-stadium': [
      { match: /Rework 1st Floor/i, floor: 'floor-1' },
      { match: /Rework 2nd Floor/i, floor: 'floor-2' },
    ],
    'r6-hereford-base-original-': [
      { match: /HerefordBasement/i, floor: 'basement' },
      { match: /Headquarters 1st Floor/i, floor: 'floor-1' },
      { match: /Headquarters 2nd Floor/i, floor: 'floor-2' },
      { match: /Headquarters 3rd Floor/i, floor: 'floor-3' },
      { match: /HerefordRoof/i, floor: 'roof' },
    ],
  };
  const FLOOR_ORDER = { basement: 0, 'floor-1': 1, 'floor-2': 2, 'floor-3': 3, roof: 4, spawn: 5, overview: 6 };
  const FLOOR_LABEL = { basement: 'Basement', 'floor-1': 'Floor 1', 'floor-2': 'Floor 2', 'floor-3': 'Floor 3', roof: 'Roof', spawn: 'Spawns' };
  const { execFileSync } = require('child_process');
  const os = require('os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r6-bp-'));
  const fetchBin = async (url) => {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return Buffer.from(await r.arrayBuffer());
  };
  // Downscale huge sources (Calypso PNGs) to web-size JPEG via PIL.
  const toWebJpg = (src, dest) => {
    execFileSync('python3', ['-c', [
      'import sys',
      'from PIL import Image',
      'im = Image.open(sys.argv[1]).convert("RGB")',
      'im.thumbnail((1600, 1600))',
      'im.save(sys.argv[2], "JPEG", quality=82)',
    ].join(';'), src, dest], { stdio: 'pipe' });
  };
  maps.forEach((map) => {
    const files = mapImages[mapTitleById.get(map.id)] || [];
    const thumbFile = map.galleryImage || pickFile(files, [/Siege_.*_Thumbnail/i, /Thumbnail/i]);
    map.thumb = local(`r6_images/maps/${map.id}.png`, thumbFile, 400);
    map.layouts = [];
  });
  // 1) Official blueprints first (uniform, current).
  let bpCount = 0;
  const bpJobs = Object.entries(MAP_BLUEPRINTS).filter(([id]) => maps.some((m) => m.id === id));
  console.log(`sync-r6: downloading ${bpJobs.length} blueprint zips...`);
  const bpDownloads = [];
  const runBp = async ([id, cfg]) => {
    const map = maps.find((m) => m.id === id);
    try {
      const bin = await fetchBin(UBI_BP + cfg.zip);
      const zipPath = path.join(tmpDir, `${id}.zip`);
      fs.writeFileSync(zipPath, bin);
      const list = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
        .split('\n').map((s) => s.trim()).filter(Boolean)
        .filter((n) => !n.endsWith('/') && !n.split('/').pop().startsWith('._') && /\.(png|jpe?g|webp)$/i.test(n));
      let inners;
      if (cfg.named) {
        const pick = (re) => list.find((n) => re.test(n));
        const order = [/basement/i, /[^a-z]1f[^a-z]/i, /[^a-z]2f[^a-z]/i, /roof/i];
        const floors = ['basement', 'floor-1', 'floor-2', 'roof'];
        const labels = ['Basement', '1st Floor', '2nd Floor', 'Roof'];
        inners = order.map((re, i) => ({ inner: pick(re), floor: floors[i], label: labels[i] }));
        if (inners.some((e) => !e.inner)) throw new Error(`named match failed in ${cfg.zip}`);
      } else {
        const numbered = list
          .map((n) => ({ n, num: parseInt((n.match(/blueprint-(\d+)/i) || [])[1], 10) }))
          .filter((e) => Number.isInteger(e.num)).sort((a, b) => a.num - b.num);
        const use = cfg.use || numbered.map((e) => e.num);
        inners = use.map((num, i) => {
          const hit = numbered.find((e) => e.num === num);
          if (!hit) throw new Error(`blueprint-${num} missing in ${cfg.zip}`);
          const [floor, label] = cfg.levels[i];
          return { inner: hit.n, floor, label: label || FLOOR_LABEL[floor] };
        });
      }
      inners.forEach(({ inner, floor, label }, i) => {
        const rel = `r6_images/maps/${map.id}-layout-${i + 1}.jpg`;
        const abs = path.join(ROOT, 'web', rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        const tmpImg = path.join(tmpDir, `${map.id}-${i}.bin`);
        fs.writeFileSync(tmpImg, execFileSync('unzip', ['-p', zipPath, inner], { encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 }));
        toWebJpg(tmpImg, abs);
        map.layouts.push({ label, source: `ubi:${cfg.zip}#${inner.split('/').pop()}`, floor, order: FLOOR_ORDER[floor], image: rel });
      });
      bpCount += inners.length;
      bpDownloads.push(`${id}=${inners.length}`);
    } catch (error) {
      console.warn(`sync-r6: blueprints failed for ${map.name} (${error.message.split('\n')[0]})`);
    }
  };

  for (const job of bpJobs) {
    await runBp(job);
    await sleep(SLEEP_MS);
  }
  console.log(`sync-r6: blueprints ok (${bpDownloads.length} maps): ${bpDownloads.join(' ')}`);

  // 2) Legacy Fandom supplements (no Ubi source, or a level zips lack).
  for (const [id, rules] of Object.entries(RETAIN_FANDOM)) {
    const map = maps.find((m) => m.id === id);
    if (!map) continue;
    const files = mapImages[mapTitleById.get(map.id)] || [];
    for (const rule of rules) {
      const f = files.find((name) => rule.match.test(name)
        && /\.(png|webp|jpg|jpeg)$/i.test(name)
        && !map.layouts.some((l) => l.source === name));
      if (!f) { console.warn(`sync-r6: retain miss ${map.name} (${rule.match})`); continue; }
      const idx = map.layouts.length + 1;
      const rel = `r6_images/maps/${map.id}-layout-${idx}.png`;
      const saved = local(rel, f, 800);
      if (!saved) continue;
      map.layouts.push({ label: rule.label || FLOOR_LABEL[rule.floor], source: f, floor: rule.floor, order: FLOOR_ORDER[rule.floor], image: saved });
    }
  }
  maps.forEach((map) => {
    map.layouts.sort((a, b) => (a.order - b.order) || a.label.localeCompare(b.label));
    const seen = new Set();
    (map.layouts || []).forEach((l) => {
      const key = `${l.floor}|${l.label}`;
      if (seen.has(key)) console.warn(`sync-r6: duplicate layout ${map.name} [${l.floor}] ${l.label} (${l.source})`);
      seen.add(key);
    });
    delete map.galleryImage;
  });
  const emptyMaps = maps.filter((m) => !(m.layouts || []).length).map((m) => m.name);
  if (emptyMaps.length) console.warn(`sync-r6: maps with zero layouts: ${emptyMaps.join(', ')}`);
  console.log(`sync-r6: thumbs=${maps.filter((m) => m.thumb).length}/${maps.length} layouts=${maps.reduce((n, m) => n + (m.layouts || []).length, 0)}`);

  // Sweep orphaned per-map layout files (indices shift when floor order changes).
  const referenced = new Set();
  maps.forEach((m) => {
    if (m.thumb) referenced.add(m.thumb);
    (m.layouts || []).forEach((l) => { if (l.image) referenced.add(l.image); });
  });
  const mapsDir = path.join(ROOT, 'web', 'r6_images', 'maps');
  if (fs.existsSync(mapsDir)) {
    let swept = 0;
    for (const file of fs.readdirSync(mapsDir)) {
      const rel = `r6_images/maps/${file}`;
      if (/-layout-\d+\.(png|jpg)$/.test(file) && !referenced.has(rel)) {
        fs.unlinkSync(path.join(mapsDir, file));
        swept += 1;
      }
    }
    if (swept) console.log(`sync-r6: swept ${swept} orphaned layout files`);
  }
  // Prune stale map keys from the image manifest (same orphan logic —
  // otherwise the image sync keeps re-downloading dead Fandom files).
  let pruned = 0;
  for (const key of Object.keys(manifest)) {
    if (key.startsWith('r6_images/maps/') && !referenced.has(key)) {
      delete manifest[key];
      pruned += 1;
    }
  }
  if (pruned) console.log(`sync-r6: pruned ${pruned} stale map manifest keys`);

  console.log('sync-r6: resolving season covers...');
  seasons.forEach((season) => {
    season.cover = local(`r6_images/seasons/${season.id}.png`, season.coverFile, 800);
    delete season.coverFile;
  });
  console.log(`sync-r6: covers=${seasons.filter((s) => s.cover).length}/${seasons.length}`);

  const seasonByName = new Map(seasons.map((s) => [s.name.replace(/^Operation /, ''), s]));
  const rosterNames = new Set(operators.map((op) => op.name));
  operators.forEach((op) => {
    const key = op.season.replace(/^Operation /, '');
    const season = seasonByName.get(key) || seasons.find((s) => s.name.endsWith(key));
    if (season && !season.operators.includes(op.name)) season.operators.push(op.name);
  });
  // Alarm: season infobox names an operator the roster sync dropped.
  seasons.forEach((season) => {
    (season.seasonOperators || []).forEach((name) => {
      const base = name.replace(/ \(.*\)$/, '');
      if (!rosterNames.has(name) && !rosterNames.has(base) && !/remaster|recruit|sentry|striker|assaulter|pointman|protector|breacher|trapper/i.test(name)) {
        console.warn(`sync-r6: season ${season.code} names unrostered operator "${name}"`);
      }
    });
  });
  console.log(`sync-r6: seasons=${seasons.length}`);

  const generatedAt = new Date().toISOString();
  // Never overwrite good data with a degraded parse: the roster must
  // converge near the candidate count (parse failures are loud, not silent).
  if (operators.length < opTitles.length * 0.9) {
    throw new Error(`roster degraded: ${operators.length}/${opTitles.length} parsed, refusing to write`);
  }
  const sources = { wiki: 'https://rainbowsix.fandom.com/api.php', license: 'CC-BY-SA (Fandom contributors)' };
  fs.mkdirSync(path.join(ROOT, 'review'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'review', 'r6-image-manifest.json'), JSON.stringify({ generatedAt, images: manifest }, null, 2) + '\n');
  fs.writeFileSync(path.join(CONTENT_DIR, 'operators.json'), JSON.stringify({ generatedAt, metadata: { sources, count: operators.length }, operators }, null, 2) + '\n');
  fs.writeFileSync(path.join(CONTENT_DIR, 'maps.json'), JSON.stringify({ generatedAt, metadata: { sources, count: maps.length }, maps }, null, 2) + '\n');
  const bombSites = {};
  maps.forEach((m) => { bombSites[m.id] = m.bombSites || []; });
  const emptySites = Object.entries(bombSites).filter(([, v]) => !v.length).map(([k]) => k);
  if (emptySites.length) console.warn(`sync-r6: maps without parsed bomb sites: ${emptySites.join(', ')}`);
  fs.writeFileSync(path.join(CONTENT_DIR, 'bomb-sites.json'), JSON.stringify({ generatedAt, metadata: { sources: { wiki: 'https://rainbowsix.fandom.com/api.php (Features > Bomb, CC-BY-SA)' }, count: maps.length }, sites: bombSites }, null, 2) + '\n');
  fs.writeFileSync(path.join(CONTENT_DIR, 'seasons.json'), JSON.stringify({ generatedAt, metadata: { sources, count: seasons.length }, seasons }, null, 2) + '\n');
  console.log('sync-r6: wrote content/operators.json, maps.json, seasons.json');
}

main().catch((error) => { console.error(`sync-r6: ${error.message}`); process.exit(1); });
