#!/usr/bin/env node

// Syncs operator lore into content/lore.json from two sources:
//   Fandom (MediaWiki API): Biography, Psychological Profile/Report, Quotes, Trivia
//   Ubisoft (SSR HTML): short bio + quote, specialties, health/speed/difficulty,
//     real name, date/place of birth.
// Usage: node scripts/sync-r6-lore.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const OPERATORS_PATH = path.join(CONTENT_DIR, 'operators.json');
const LORE_PATH = path.join(CONTENT_DIR, 'lore.json');
const FANDOM_API = 'https://rainbowsix.fandom.com/api.php';
const UBI_INDEX = 'https://www.ubisoft.com/en-us/game/rainbow-six/siege/game-info/operators';
const UBI_OP = 'https://www.ubisoft.com/en-us/game/rainbow-six/siege/game-info/operators/';
const UA = 'R6-Siege-Wiki-Sync/0.1 (fan wiki content sync; contact via repo issues)';
const SLEEP_MS = 350;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fandom(params) {
  const url = `${FANDOM_API}?${new URLSearchParams({ format: 'json', ...params })}`;
  const response = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`Fandom HTTP ${response.status}`);
  return response.json();
}

async function ubiGet(url) {
  const response = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
  if (!response.ok) throw new Error(`Ubisoft HTTP ${response.status} for ${url}`);
  return response.text();
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ');
}

function stripMarkup(text) {
  let out = decodeEntities(String(text || ''));
  out = out.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '').replace(/<ref[^/]*\/>/gi, '');
  out = out.replace(/\[(?:https?:)?\/\/[^\]]*\]/gi, '');
  for (let i = 0; i < 6; i++) {
    if (!/\{\{[^{}]*\}\}/.test(out)) break;
    out = out.replace(/\{\{Quote\|[^}]*\}\}/gi, '');
    out = out.replace(/\{\{[^{}]*\|([^{}|]+)\}\}/g, '$1');
    out = out.replace(/\{\{[^{}]*\}\}/g, '');
  }
  out = out.replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, '');
  out = out.replace(/\[\[([^|\]]*\|)?([^\]]+)\]\]/g, '$2');
  out = out.replace(/<\/?[a-z][^>]*>/gi, '');
  out = out.replace(/'''?/g, '');
  out = out.replace(/&(#[0-9]+|[a-z]+);/gi, ' ');
  out = out.replace(/\[…\]|\[…\]/g, '');
  out = out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

function cleanSection(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^={2,}.*={2,}$/.test(line) && !/^[A-Za-z.' ]{1,32}?=$/.test(line))
    .map((line) => line.replace(/^'{2,3}/, '')
      .replace(/^\|-\|[^=\n]+?=\s*/, '')
      .replace(/^[A-Z][A-Za-z.' ]{1,32}?=\s+(?=[A-Z"“])/, ''))
    .join('\n');
}

function cap(text, n) {
  const t = stripMarkup(cleanSection(text)).replace(/\s+/g, ' ');
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}

function paras(wikitext, n) {
  return cleanSection(String(wikitext || '')).replace(/^==[^=\n]+==\s*/, '')
    .split(/\n{2,}/)
    .map((p) => stripMarkup(p).replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 40)
    .slice(0, n || 99);
}

// --- Fandom ---------------------------------------------------------------

async function fandomSections(title) {
  const data = await fandom({ action: 'parse', page: title, prop: 'sections' });
  if (data.error) throw new Error(`${title}: ${data.error.info}`);
  const map = {};
  for (const s of data.parse.sections) {
    const key = s.line.toLowerCase().replace(/<\/?[^>]+>/g, '').trim();
    if (!(key in map)) map[key] = s.index;
  }
  return map;
}

async function fandomSectionText(title, index) {
  const data = await fandom({ action: 'parse', page: title, prop: 'wikitext', section: String(index) });
  if (data.error) return '';
  return data.parse.wikitext['*'] || '';
}

async function scrapeFandomOp(op, fandomTitle) {
  const out = { biography: '', psychProfile: '', psychReport: '', quotes: [], trivia: [] };
  let sections = {};
  try {
    sections = await fandomSections(fandomTitle);
  } catch (error) {
    console.warn(`sync-lore: sections failed for ${fandomTitle}: ${error.message}`);
    return out;
  }
  await sleep(SLEEP_MS);
  const get = async (names) => {
    for (const name of names) {
      const key = Object.keys(sections).find((k) => k === name);
      if (key !== undefined) {
        const text = await fandomSectionText(fandomTitle, sections[key]);
        await sleep(SLEEP_MS);
        return text;
      }
    }
    return '';
  };
  const bio = await get(['biography']);
  out.biography = paras(bio, 6).join('\n\n').slice(0, 4000);
  const profile = await get(['psychological profile']);
  out.psychProfile = cap(profile, 800);
  const report = await get(['psychological report']);
  out.psychReport = paras(report, 8).join('\n\n').slice(0, 3000);
  const quotes = await get(['quotes']);
  out.quotes = quotes.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('*') && !l.startsWith('**'))
    .map((l) => stripMarkup(l.replace(/^\*\s*/, '').replace(/^\|-\|[^=\n]+?=\s*/, '')).replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 4 && l.length < 300)
    .slice(0, 10);
  const trivia = await get(['trivia']);
  out.trivia = trivia.split('\n')
    .map((l) => stripMarkup(l.replace(/^\*\s*/, '').replace(/^\|-\|[^=\n]+?=\s*/, '')).replace(/\s+/g, ' ').trim())
    .filter((l) => l.startsWith('*') || l.length > 40)
    .map((l) => l.replace(/^\*\s*/, ''))
    .filter((l) => l.length > 20)
    .slice(0, 12);
  return out;
}

// --- Ubisoft --------------------------------------------------------------

function slugify(name) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ø/gi, 'o').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function textOf(html, n) {
  return decodeEntities(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, n || 100000);
}

function countActive(html, label) {
  const idx = String(html).search(new RegExp('data-innertext="' + label + '"', 'i'));
  if (idx < 0) return null;
  const tail = String(html).slice(idx);
  const nextTitle = tail.slice(50).search(/stat__title/);
  const scope = nextTitle > 0 ? tail.slice(0, 50 + nextTitle) : tail.slice(0, 1200);
  if (!/react-rater-star[^>]*is-disabled/.test(scope)) return null;
  const active = (scope.match(/react-rater-star[^>]*is-active/g) || []).length;
  return active > 0 ? Math.min(active, 3) : null;
}

function ubiField(html, label) {
  const re = new RegExp('data-innertext="' + label + '"[^]*?operator__biography__info__value">([^<]{1,200})<', 'i');
  const m = String(html).match(re);
  return m ? decodeEntities(m[1]).trim() : '';
}

async function ubiIndexSlugs() {
  const html = await ubiGet(UBI_INDEX);
  const slugs = new Set();
  const re = /\/game\/rainbow-six\/siege\/game-info\/operators\/([a-z0-9-]+)/g;
  let m;
  while ((m = re.exec(html))) slugs.add(m[1]);
  return slugs;
}

async function scrapeUbiOp(slug) {
  const html = await ubiGet(UBI_OP + slug);
  const bioMatch = html.match(/<h3[^>]*>\s*Biography\s*<\/h3>([\s\S]{0,6000}?)<h3/i);
  const bioHtml = bioMatch ? bioMatch[1] : '';
  const quoteMatch = bioHtml.match(/<h3[^>]*>([^<]{4,200})<\/h3>/i) || bioHtml.match(/"([^"]{10,200})"/);
  const psychMatch = html.match(/<h3[^>]*>\s*Psychological report\s*<\/h3>([\s\S]{0,8000}?)<(?:h3|div[^>]*class="[^"]*promo)/i);
  const rolesScope = String(html).split('operator__header__stats')[0] || '';
  const specsBlock = (rolesScope.match(/operator__header__roles[\s\S]*/) || [''])[0];
  const specs = [...specsBlock.matchAll(/data-innertext="([^"]+)"/gi)]
    .map((x) => x[1].trim()).filter((v, i, a) => v && v !== 'Specialties' && a.indexOf(v) === i).slice(0, 4);
  const rawBio = textOf(bioHtml, 1200);
  const rawQuote = quoteMatch ? quoteMatch[1].replace(/^"|"$/g, '').trim().slice(0, 200) : '';
  let bio = rawBio.replace(/^[“"'][^“"']{2,120}[”"']\s*/, '');
  if (rawQuote && bio.startsWith(rawQuote)) bio = bio.slice(rawQuote.length).replace(/^[\s"“”.,-]+/, '');
  return {
    bio,
    quote: rawQuote,
    psychReport: textOf(psychMatch ? psychMatch[1] : '', 2500),
    specialties: specs,
    health: countActive(html, 'HEALTH'),
    speed: countActive(html, 'Speed'),
    difficulty: countActive(html, 'Difficulty'),
    realName: ubiField(html, 'Real Name'),
    dob: ubiField(html, 'Date of Birth'),
    birthplace: ubiField(html, 'Place of Birth'),
  };
}

// --- main -----------------------------------------------------------------

async function main() {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  const operators = JSON.parse(fs.readFileSync(OPERATORS_PATH, 'utf8')).operators;
  console.log(`sync-lore: ${operators.length} operators`);

  console.log('sync-lore: resolving fandom titles...');
  const catData = await fandom({ action: 'query', list: 'categorymembers', cmtitle: 'Category:Rainbow Operators', cmlimit: 500, cmtype: 'page' });
  const JUNK = /\(Extraction\)|\(Novel\)|\(TV series\)|\(Disambig\)|\(Codex\)|Flubber|Breacher \(Operator\)|Assaulter|Bishop|Noor|Pointman|Protector|Recruit|Striker|Sentry|Solid Snake|Trapper|Bosak|Patcher|Reserves/i;
  const titleByName = new Map();
  for (const m of catData.query.categorymembers) {
    if (JUNK.test(m.title)) continue;
    const name = m.title.replace(/ \(Siege\)$/, '');
    const siege = m.title.endsWith(' (Siege)');
    if (!titleByName.has(name) || siege) titleByName.set(name, m.title);
  }

  console.log('sync-lore: fetching Ubisoft index...');
  const ubiSlugs = await ubiIndexSlugs();
  console.log(`sync-lore: ubisoft slugs=${ubiSlugs.size}`);
  await sleep(SLEEP_MS);

  const entries = {};
  let n = 0;
  for (const op of operators) {
    n += 1;
    const fandomTitle = titleByName.get(op.name) || op.name;
    let fandom = { biography: '', psychProfile: '', psychReport: '', quotes: [], trivia: [] };
    try {
      fandom = await scrapeFandomOp(op, fandomTitle);
    } catch (error) {
      console.warn(`sync-lore: fandom failed for ${op.name}: ${error.message}`);
    }
    let ubi = { bio: '', quote: '', psychReport: '', specialties: [], health: null, speed: null, difficulty: null, realName: '', dob: '', birthplace: '' };
    const slug = slugify(op.name);
    if (ubiSlugs.has(slug)) {
      try {
        ubi = await scrapeUbiOp(slug);
      } catch (error) {
        console.warn(`sync-lore: ubisoft failed for ${op.name} (${slug}): ${error.message}`);
      }
      await sleep(SLEEP_MS);
    } else {
      console.warn(`sync-lore: no ubisoft slug for ${op.name} (tried ${slug})`);
    }
    entries[op.id] = {
      ubiBio: ubi.bio, ubiQuote: ubi.quote, ubiPsych: ubi.psychReport,
      specialties: ubi.specialties, health: ubi.health, speed: ubi.speed,
      difficulty: ubi.difficulty, realName: ubi.realName, dob: ubi.dob,
      birthplace: ubi.birthplace,
      biography: fandom.biography, psychProfile: fandom.psychProfile,
      psychReport: fandom.psychReport, quotes: fandom.quotes, trivia: fandom.trivia,
    };
    if (n % 12 === 0) console.log(`sync-lore: ${n}/${operators.length}...`);
  }

  const generatedAt = new Date().toISOString();
  fs.writeFileSync(LORE_PATH, JSON.stringify({
    generatedAt,
    metadata: {
      sources: {
        fandom: 'https://rainbowsix.fandom.com/api.php (CC-BY-SA)',
        ubisoft: 'https://www.ubisoft.com/en-us/game/rainbow-six/siege/game-info/operators',
      },
      count: operators.length,
    },
    entries,
  }, null, 2) + '\n');
  const filled = Object.values(entries).filter((e) => e.biography || e.ubiBio).length;
  console.log(`sync-lore: wrote content/lore.json (filled=${filled}/${operators.length})`);
}

main().catch((error) => { console.error(`sync-lore: ${error.message}`); process.exit(1); });
