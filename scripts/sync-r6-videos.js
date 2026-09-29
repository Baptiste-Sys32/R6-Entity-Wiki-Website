#!/usr/bin/env node

// Syncs gameplay video links per operator into content/videos.json.
// Source chain: Ubisoft SSR first (biography YouTube ID + ability mp4 link),
// Fandom {{#ev:youtube}} tags as backup. YouTube IDs embed in How to Play;
// mp4s are outbound links only (never hotlinked).
// Usage: node scripts/sync-r6-videos.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const OPERATORS_PATH = path.join(CONTENT_DIR, 'operators.json');
const VIDEOS_PATH = path.join(CONTENT_DIR, 'videos.json');
const FANDOM_API = 'https://rainbowsix.fandom.com/api.php';
const FANDOM_UA = 'R6-Siege-Wiki-Sync/0.1 (fan wiki content sync; contact via repo issues)';
const UBI_INDEX = 'https://www.ubisoft.com/en-us/game/rainbow-six/siege/game-info/operators';
const UBI_OP = 'https://www.ubisoft.com/en-us/game/rainbow-six/siege/game-info/operators/';
const UBI_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0';
const SLEEP_MS = 800;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fandom(params) {
  const url = `${FANDOM_API}?${new URLSearchParams({ format: 'json', ...params })}`;
  const response = await fetch(url, { headers: { 'User-Agent': FANDOM_UA } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function ubiGet(url) {
  const response = await fetch(url, { headers: { 'User-Agent': UBI_UA, Accept: 'text/html' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function slugify(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ø/gi, 'o').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const YT_ID = /^[A-Za-z0-9_-]{6,15}$/;

async function ubiVideos(slug) {
  const html = await ubiGet(UBI_OP + slug);
  const out = [];
  // Biography video: "buttonUrl":"<ytid>" + "buttonType":"youtube-modal".
  for (const m of String(html).matchAll(/"buttonUrl"\s*:\s*"([^"]+)"[^}]{0,300}?"buttonType"\s*:\s*"youtube-modal"/gi)) {
    const id = m[1].trim();
    if (YT_ID.test(id)) out.push({ youtubeId: id, label: 'Operator guide', source: 'ubisoft' });
  }
  if (!out.length) {
    for (const m of String(html).matchAll(/"buttonType"\s*:\s*"youtube-modal"[^}]{0,300}?"buttonUrl"\s*:\s*"([^"]+)"/gi)) {
      const id = m[1].trim();
      if (YT_ID.test(id)) out.push({ youtubeId: id, label: 'Operator guide', source: 'ubisoft' });
    }
  }
  // Ability preview mp4: outbound link only.
  const mp4 = String(html).match(/https:\/\/staticctf\.ubisoft\.com\/[^"'\s]+\.mp4/i);
  if (mp4) out.push({ mp4: mp4[0].slice(0, 300), label: 'Ability preview', source: 'ubisoft' });
  return out;
}

async function fandomVideos(title) {
  const out = [];
  try {
    const data = await fandom({ action: 'parse', page: title, prop: 'wikitext' });
    if (data.error) return out;
    const wt = data.parse.wikitext['*'] || '';
    for (const m of wt.matchAll(/\{\{#ev:youtube\|([^}|]+)/gi)) {
      const id = m[1].trim();
      if (YT_ID.test(id) && !out.some((v) => v.youtubeId === id)) {
        out.push({ youtubeId: id, label: 'Community guide', source: 'fandom' });
      }
    }
  } catch { /* backup source, warn-only at call site */ }
  return out.slice(0, 3);
}

async function main() {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  const operators = JSON.parse(fs.readFileSync(OPERATORS_PATH, 'utf8')).operators;
  let ubiSlugs = new Set();
  try {
    const html = await ubiGet(UBI_INDEX);
    ubiSlugs = new Set([...html.matchAll(/\/game\/rainbow-six\/siege\/game-info\/operators\/([a-z0-9-]+)/g)].map((m) => m[1]));
    console.log(`sync-videos: ubisoft slugs=${ubiSlugs.size}`);
  } catch (error) {
    console.warn(`sync-videos: ubisoft index failed (${error.message}), fandom fallback only`);
  }
  await sleep(SLEEP_MS);
  const opTitleByName = new Map();
  try {
    const data = await fandom({ action: 'query', list: 'categorymembers', cmtitle: 'Category:Rainbow Operators', cmlimit: 200, cmtype: 'page' });
    for (const m of data.query?.categorymembers || []) {
      const name = m.title.replace(/ \(Siege\)$/, '');
      if (!opTitleByName.has(name)) opTitleByName.set(name, m.title);
    }
  } catch (error) {
    console.warn(`sync-videos: fandom titles failed (${error.message})`);
  }
  const entries = {};
  let withVideo = 0;
  for (const op of operators) {
    const slug = slugify(op.name);
    let vids = [];
    if (ubiSlugs.has(slug)) {
      try {
        vids = await ubiVideos(slug);
      } catch (error) {
        console.warn(`sync-videos: ubisoft failed for ${op.name} (${error.message.split('\n')[0]})`);
      }
      await sleep(SLEEP_MS);
    }
    if (!vids.some((v) => v.youtubeId)) {
      const title = opTitleByName.get(op.name);
      if (title) {
        try {
          const fb = await fandomVideos(title);
          vids = [...vids, ...fb.filter((f) => !vids.some((v) => v.youtubeId === f.youtubeId))];
        } catch (error) {
          console.warn(`sync-videos: fandom failed for ${op.name} (${error.message.split('\n')[0]})`);
        }
        await sleep(SLEEP_MS);
      }
    }
    if (vids.length) {
      entries[op.id] = vids.slice(0, 3);
      withVideo += 1;
    }
  }
  const generatedAt = new Date().toISOString();
  fs.writeFileSync(VIDEOS_PATH, JSON.stringify({
    generatedAt,
    metadata: { sources: { ubisoft: 'operator pages (video IDs only)', fandom: 'EmbedVideo tags (CC-BY-SA)' }, operators: withVideo },
    entries,
  }, null, 2) + '\n');
  console.log(`sync-videos: wrote content/videos.json (${withVideo}/${operators.length} operators with video)`);
}

main().catch((error) => { console.error(`sync-videos: ${error.message}`); process.exit(1); });
