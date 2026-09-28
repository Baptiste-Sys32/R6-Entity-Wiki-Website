#!/usr/bin/env node

// Syncs patch history + roster cross-check from Liquipedia (free,
// no-key MediaWiki API). Writes content/patches.json; never blocks the
// pipeline — every step is try/catch with warn-only failure.
// Text: CC BY-SA 3.0 (Liquipedia contributors), attributed on-page.
// Usage: node scripts/sync-r6-liquipedia.js
//
// Liquipedia API terms: gzip encoding required, honor rate limits.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const OPERATORS_PATH = path.join(CONTENT_DIR, 'operators.json');
const PATCHES_PATH = path.join(CONTENT_DIR, 'patches.json');
const API = 'https://liquipedia.net/rainbowsix/api.php';
const UA = 'R6-Siege-Wiki-Sync/0.1 (fan wiki content sync; contact via repo issues)';
const SLEEP_MS = 1200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function apiGet(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  const response = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  let text = buffer.toString('utf8');
  try { text = zlib.gunzipSync(buffer).toString('utf8'); } catch { /* already plain */ }
  return JSON.parse(text);
}

const stripHtml = (html) => String(html || '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();

function parsePatchTables(html) {
  const patches = [];
  const tables = [...String(html).matchAll(/<table class="wikitable[^"]*"(.*?)<\/table>/gis)];
  for (const [, body] of tables) {
    const rows = [...body.matchAll(/<tr>(.*?)<\/tr>/gis)].map((m) => m[1]);
    if (!rows.length) continue;
    const head = [...rows[0].matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/gis)].map((m) => stripHtml(m[1]));
    if (!(head.length >= 3 && /^patch$/i.test(head[0]) && /release date/i.test(head[1]))) continue;
    for (const row of rows.slice(1)) {
      const cells = [...row.matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/gis)].map((m) => m[1]);
      if (cells.length < 2) continue;
      const link = (cells[0].match(/<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/is) || []);
      const version = stripHtml(cells[0]).slice(0, 80);
      const date = stripHtml(cells[1]).slice(0, 40);
      const highlights = stripHtml(cells[2] || '').slice(0, 300);
      if (!version || !date) continue;
      patches.push({
        version: version.replace(/\s*\(latest\)\s*/i, ''),
        latest: /\(latest\)/i.test(version),
        date,
        highlights,
        url: link[1] ? `https://liquipedia.net${link[1]}` : null,
      });
    }
  }
  return patches;
}

const normName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[øØ]/g, 'o').toLowerCase().replace(/[^a-z0-9]+/g, '');

function rosterDiff(lpNames, rosterNames) {
  const roster = new Set(rosterNames.map(normName));
  const lp = new Set(lpNames.map(normName));
  return {
    missingHere: [...new Set(lpNames.filter((n) => n && !roster.has(normName(n))))],
    missingThere: [...new Set(rosterNames.filter((n) => n && !lp.has(normName(n))))],
  };
}

async function main() {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  let patches = [];
  try {
    const data = await apiGet({ action: 'parse', page: 'Portal:Patches', prop: 'text' });
    if (data.error) throw new Error(data.error.info);
    patches = parsePatchTables(data.parse.text);
    console.log(`sync-liquipedia: patches=${patches.length}`);
  } catch (error) {
    console.warn(`sync-liquipedia: patch history failed (${error.message})`);
  }
  await sleep(SLEEP_MS);
  try {
    const operators = JSON.parse(fs.readFileSync(OPERATORS_PATH, 'utf8')).operators;
    const data = await apiGet({ action: 'parse', page: 'Portal:Operators', prop: 'wikitext' });
    if (data.error) throw new Error(data.error.info);
    const wt = data.parse.wikitext;
    const lpNames = [...new Set(
      [...wt.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)]
        .map((m) => m[1].trim())
        .filter((t) => /^[A-ZÀ-Þ]/.test(t) && !/^(File|Image|Category|Portal|Template|Help|Special):/i.test(t) && t.length <= 40)
    )];
    const diff = rosterDiff(lpNames, operators.map((o) => o.name));
    console.log(`sync-liquipedia: roster lp=${lpNames.length} ours=${operators.length}`);
    if (diff.missingHere.length) console.warn(`sync-liquipedia: on Liquipedia but not in roster: ${diff.missingHere.slice(0, 12).join(', ')}`);
    if (diff.missingThere.length) console.warn(`sync-liquipedia: in roster but not on Liquipedia portal: ${diff.missingThere.slice(0, 12).join(', ')}`);
  } catch (error) {
    console.warn(`sync-liquipedia: roster cross-check failed (${error.message})`);
  }
  if (!patches.length) {
    console.warn('sync-liquipedia: no patches parsed, keeping previous content/patches.json');
    return;
  }
  const generatedAt = new Date().toISOString();
  fs.writeFileSync(PATCHES_PATH, JSON.stringify({
    generatedAt,
    metadata: { sources: { liquipedia: 'https://liquipedia.net/rainbowsix/ (CC BY-SA 3.0)' }, count: patches.length },
    patches,
  }, null, 2) + '\n');
  console.log(`sync-liquipedia: wrote content/patches.json (${patches.length})`);
}

main().catch((error) => { console.error(`sync-liquipedia: ${error.message}`); process.exit(1); });
