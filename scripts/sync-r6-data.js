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

const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const API = 'https://rainbowsix.fandom.com/api.php';
const UA = 'R6-Siege-Wiki-Sync/0.1 (fan wiki content sync; contact via repo issues)';
const SLEEP_MS = 350;

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
    const match = wt.match(new RegExp(`\\|${name}=((?:(?!(?:\\s*/)?\\s*\\|(?:primary|secondary|gadget|ability)\\s*=)[\\s\\S])*)`, 'i'));
    const scope = match ? match[1] : '';
    const names = [];
    for (const m of scope.matchAll(/\*\[\[([^\]]+)\]\]/g)) {
      const parts = m[1].split('|');
      const display = (parts[1] || parts[0]).split('#')[0].replace(/_/g, ' ').trim();
      if (display && !names.includes(display)) names.push(display);
    }
    return names;
  };
  const tableFallback = (name) => {
    const table = wt.match(/\{\|[^\n]*\n!colspan="2"\|Loadout([\s\S]*?)\|\}/);
    if (!table) return [];
    const match = table[1].match(new RegExp(`\\|\\s*${name}\\s*\\n([\\s\\S]*?)(?=\\n\\s*\\|-\\n\\s*\\||$)`));
    if (!match) return [];
    return [...match[1].matchAll(/\*\[\[([^#|\]]+)/g)].map((m) => m[1].replace(/_/g, ' ').trim()).filter(Boolean);
  };
  const pick = (name) => {
    const direct = row(name);
    return direct.length ? direct : tableFallback(name === 'gadget' ? 'Generic Gadget|Gadget' : name);
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
  const JUNK = /\(Extraction\)|\(Novel\)|\(TV series\)|\(Disambig\)|\(Codex\)|Flubber|Breacher \(Operator\)|Assaulter|Bishop|Noor|Pointman|Protector|Recruit|Striker|Sentry|Solid Snake|Trapper|Bosak|Patcher|Reserves/i;
  const byName = new Map();
  for (const title of titles) {
    if (JUNK.test(title)) continue;
    const name = title.replace(/ \(Siege\)$/, '');
    const siege = title.endsWith(' (Siege)');
    if (!byName.has(name) || !siege) byName.set(name, title);
  }
  return [...byName.entries()].map(([name, title]) => ({ name, title }));
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
      : (/introduced in \[\[([^|\]]+)(?:\|[^\]]+)?\]\]/.test(wt)
        ? RegExp.$1.replace(/^Tom Clancy's Rainbow Six Siege:\s*/, '') : 'Launch'),
    role: stripMarkup(infoboxField(wt, 'role')).slice(0, 120),
    gadget,
    ability: (() => {
      const afterTable = wt.match(/\|\}[ \n\/]*([A-Z][^\n\{]{60,500})/);
      if (afterTable) {
        const cleaned = stripMarkup(afterTable[1]);
        if (/Operator/i.test(cleaned)) return cleaned.slice(0, 600);
      }
      return introParagraph(wt).slice(0, 600);
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
  };
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
  return {
    id: `r6-${rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`,
    name: stripMarkup(infoboxField(wt, 'name')),
    code: `Y${yearMatch[1]}S${yearMatch[2]}`,
    year: Number(yearMatch[1]),
    released: stripMarkup(infoboxField(wt, 'released')).slice(0, 60),
    operators: [],
    map: firstWikiLinkText(infoboxField(wt, 'map').split('<br')[0]).slice(0, 60),
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
  const opTitles = normalizeOperatorTitles(await categoryMembers('Category:Rainbow Operators'));
  console.log(`sync-r6: ${opTitles.length} operator candidates`);
  const opCats = await categoriesFor(opTitles.map((o) => o.title));

  const operators = [];
  for (const { name, title } of opTitles) {
    try {
      const wt = await wikitext(title);
      const seasonCats = (opCats[title] || [])
        .filter((c) => c.startsWith("Category:Tom Clancy's Rainbow Six Siege:"))
        .filter((c) => validSeasons.has(c.replace(/^Category:Tom Clancy's Rainbow Six Siege:\s*/, '').replace(/^Operation /, '')));
      const op = parseOperator(title, wt, seasonCats.length === 1 ? seasonCats[0] : null);
      if (op) operators.push(op);
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
  const local = (rel, file, width) => {
    if (!file) return null;
    manifest[rel] = { file, width };
    return rel;
  };
  operators.forEach((op) => {
    const title = opTitleById.get(op.id);
    const files = opImages[title] || [];
    const baseName = title.replace(/ \(Siege\)$/, '');
    const iconFile = pickFile(files, [/NewestIcon/i, /Icon_-_Standard/i, /Icon.*\.png/i]);
    const portraitExact = new RegExp(`^${baseName.replace(/[^a-z0-9]+/gi, '[ _-]')} +Portrait\\.png$`, 'i');
    const heroFile = pickFile(files, [/Full[ _-]?Body/i, /In-game Fullbody/i, portraitExact, / Portrait\.png/i, /Profile\.png/i, /ElitePortrait/i, /turn-around/i, /Operator Card/i]);
    op.icon = local(`r6_images/operators/icons/${op.id}.png`, iconFile, 256);
    op.hero = local(`r6_images/operators/heroes/${op.id}.png`, heroFile, 400);
    let gadgetFile = op.gadgetFile;
    if (!gadgetFile && op.gadget) {
      const token = op.gadget.toLowerCase().replace(/\sx\s*\d+$/, '').replace(/[^a-z0-9]+/g, '');
      if (token.length >= 4) {
        gadgetFile = files.find((f) => f.toLowerCase().replace(/[^a-z0-9]+/g, '').includes(token) && /\.(png|webp|jpg|jpeg)$/i.test(f) && !/IconN|Full[ _-]Body|Operator Card|ElitePortrait|turn-around|Profile\.png/i.test(f)) || null;
      }
    }
    op.gadgetIcon = local(`r6_images/gadgets/${op.id}.png`, gadgetFile, null);
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
      if (weapon.image) return;
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

  console.log('sync-r6: resolving map thumbnails...');
  const mapImages = await pageImages(mapTitles);
  const mapTitleById = new Map(maps.map((m) => [m.id, mapTitles.find((t) => t === m.name || t === `${m.name} (Siege)`) || m.name]));
  maps.forEach((map) => {
    const files = mapImages[mapTitleById.get(map.id)] || [];
    const thumbFile = map.galleryImage || pickFile(files, [/Siege_.*_Thumbnail/i, /Thumbnail/i]);
    map.thumb = local(`r6_images/maps/${map.id}.png`, thumbFile, 400);
    delete map.galleryImage;
  });
  console.log(`sync-r6: thumbs=${maps.filter((m) => m.thumb).length}/${maps.length}`);

  const seasonByName = new Map(seasons.map((s) => [s.name.replace(/^Operation /, ''), s]));
  operators.forEach((op) => {
    const key = op.season.replace(/^Operation /, '');
    const season = seasonByName.get(key) || seasons.find((s) => s.name.endsWith(key));
    if (season && !season.operators.includes(op.name)) season.operators.push(op.name);
  });
  console.log(`sync-r6: seasons=${seasons.length}`);

  const generatedAt = new Date().toISOString();
  const sources = { wiki: 'https://rainbowsix.fandom.com/api.php', license: 'CC-BY-SA (Fandom contributors)' };
  fs.mkdirSync(path.join(ROOT, 'review'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'review', 'r6-image-manifest.json'), JSON.stringify({ generatedAt, images: manifest }, null, 2) + '\n');
  fs.writeFileSync(path.join(CONTENT_DIR, 'operators.json'), JSON.stringify({ generatedAt, metadata: { sources, count: operators.length }, operators }, null, 2) + '\n');
  fs.writeFileSync(path.join(CONTENT_DIR, 'maps.json'), JSON.stringify({ generatedAt, metadata: { sources, count: maps.length }, maps }, null, 2) + '\n');
  fs.writeFileSync(path.join(CONTENT_DIR, 'seasons.json'), JSON.stringify({ generatedAt, metadata: { sources, count: seasons.length }, seasons }, null, 2) + '\n');
  console.log('sync-r6: wrote content/operators.json, maps.json, seasons.json');
}

main().catch((error) => { console.error(`sync-r6: ${error.message}`); process.exit(1); });
