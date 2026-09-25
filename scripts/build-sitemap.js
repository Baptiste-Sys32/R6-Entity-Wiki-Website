#!/usr/bin/env node

// Generates web/sitemap.xml from content JSON so deep links stay indexable.
// Usage: node scripts/build-sitemap.js [--check] [--base <url>]

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'web', 'data.js');
const SITEMAP_PATH = path.join(ROOT, 'web', 'sitemap.xml');

const rawArgs = process.argv.slice(2);
const checkOnly = rawArgs.includes('--check');
const flagValue = (name) => {
  const i = rawArgs.indexOf(`--${name}`);
  return i >= 0 && i + 1 < rawArgs.length ? rawArgs[i + 1] : null;
};
const BASE = flagValue('base') || 'https://r6-siege-wiki.pages.dev';

function esc(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function main() {
  const code = fs.readFileSync(DATA_PATH, 'utf8');
  const sandbox = {};
  require('vm').createContext(sandbox);
  require('vm').runInContext(`${code}\nthis.DB = R6_DATABASE;`, sandbox);
  const db = sandbox.DB;
  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = [];
  const add = (loc, changefreq, priority) => urls.push({ loc, changefreq, priority });
  add(`${BASE}/`, 'weekly', '1.0');
  ['operators', 'gadgets', 'maps', 'seasons'].forEach((view) => add(`${BASE}/?view=${view}`, 'weekly', '0.8'));
  (db.operators || []).forEach((e) => { if (e.id) add(`${BASE}/?view=operator&id=${e.id}`, 'monthly', '0.6'); });
  (db.maps || []).forEach((e) => { if (e.id) add(`${BASE}/?view=map&id=${e.id}`, 'monthly', '0.6'); });
  (db.seasons || []).forEach((e) => { if (e.id) add(`${BASE}/?view=season&id=${e.id}`, 'monthly', '0.6'); });
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
  urls.forEach(({ loc, changefreq, priority }) => {
    lines.push('  <url>', `    <loc>${esc(loc)}</loc>`, `    <lastmod>${lastmod}</lastmod>`, `    <changefreq>${changefreq}</changefreq>`, `    <priority>${priority}</priority>`, '  </url>');
  });
  lines.push('</urlset>', '');
  const output = lines.join('\n');
  if (checkOnly) {
    const current = fs.existsSync(SITEMAP_PATH) ? fs.readFileSync(SITEMAP_PATH, 'utf8') : '';
    const normalize = (text) => text.replace(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g, '<lastmod>DATE</lastmod>');
    if (normalize(current) !== normalize(output)) {
      console.error('build-sitemap: web/sitemap.xml is stale, run node scripts/build-sitemap.js');
      process.exit(1);
    }
    console.log(`build-sitemap: sitemap fresh (${urls.length} urls).`);
    return;
  }
  fs.writeFileSync(SITEMAP_PATH, output);
  console.log(`build-sitemap: wrote web/sitemap.xml (${urls.length} urls).`);
}

main();
