#!/usr/bin/env node

// Downloads R6 wiki images into web/r6_images/ from review/r6-image-manifest.json
// (written by sync-r6-data.js). Skips files already present; --force re-downloads.
// Usage: node scripts/sync-r6-images.js [--force]

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WEB_ROOT = path.join(ROOT, 'web');
const MANIFEST_PATH = path.join(ROOT, 'review', 'r6-image-manifest.json');
const API = 'https://rainbowsix.fandom.com/api.php';
const UA = 'R6-Siege-Wiki-Sync/0.1 (fan wiki content sync; contact via repo issues)';
const SLEEP_MS = 250;

const force = process.argv.includes('--force');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function apiGet(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', ...params })}`;
  const response = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function resolveUrl(file, width) {
  const params = { action: 'query', titles: `File:${file}`, prop: 'imageinfo', iiprop: 'url|size|mime' };
  if (width) params.iiurlwidth = width;
  const data = await apiGet(params);
  const page = Object.values(data.query?.pages || {})[0];
  const info = page?.imageinfo?.[0];
  if (!info) throw new Error(`no imageinfo for File:${file}`);
  return width && info.thumburl ? info.thumburl : info.url;
}

async function download(url, dest, referer) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': UA, Referer: referer || 'https://rainbowsix.fandom.com/' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) throw new Error('empty body');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buffer);
      return buffer.length;
    } catch (error) {
      if (attempt === 3) throw error;
      await sleep(1000 * attempt);
    }
  }
  return 0;
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')).images;
  const entries = Object.entries(manifest);
  console.log(`sync-r6-images: ${entries.length} files`);
  let done = 0, skipped = 0, bytes = 0;
  const failures = [];
  for (const [local, spec] of entries) {
    const dest = path.join(WEB_ROOT, local);
    if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      skipped += 1;
      continue;
    }
    try {
      const url = spec.url || await resolveUrl(spec.file, spec.width);
      bytes += await download(url, dest, spec.referer);
      done += 1;
      if (done % 25 === 0) console.log(`sync-r6-images: ${done} downloaded...`);
    } catch (error) {
      failures.push(`${local} (${spec.file || spec.url}): ${error.message}`);
    }
    await sleep(SLEEP_MS);
  }
  console.log(`sync-r6-images: downloaded=${done} skipped=${skipped} bytes=${(bytes / 1048576).toFixed(1)}MB failures=${failures.length}`);
  failures.forEach((f) => console.warn(`sync-r6-images: FAILED ${f}`));
  if (failures.length && !process.env.R6_IMAGES_TOLERATE_FAILURES) process.exitCode = 1;
}

main().catch((error) => { console.error(`sync-r6-images: ${error.message}`); process.exit(1); });
