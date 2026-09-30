#!/usr/bin/env node

// Downloads R6 wiki images into web/r6_images/ from review/r6-image-manifest.json
// (written by sync-r6-data.js). Skips files already present AND unchanged;
// re-downloads when the source revision changes (Fandom `cb` param) or the
// manifest points the path at a different file; --force re-downloads all.
// State lives in review/r6-image-state.json (path -> source revision).
// Usage: node scripts/sync-r6-images.js [--force]

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WEB_ROOT = path.join(ROOT, 'web');
const MANIFEST_PATH = path.join(ROOT, 'review', 'r6-image-manifest.json');
const STATE_PATH = path.join(ROOT, 'review', 'r6-image-state.json');
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

function revisionOf(url, file) {
  try {
    const cb = new URL(url).searchParams.get('cb');
    if (cb) return `cb:${cb}`;
  } catch { /* fall through */ }
  return `file:${file || url}`;
}

// Negates black-on-transparent art to white for dark UI (manifest entries
// with `invert: true`). Runs only right after a (re)download, so fresh
// skips never double-invert. Warns and keeps the original when PIL is
// unavailable.
function negatePng(dest) {
  try {
    execFileSync('python3', ['-c', [
      'import sys',
      'from PIL import Image, ImageOps',
      'p = sys.argv[1]',
      'im = Image.open(p)',
      'a = im.getchannel("A") if "A" in im.getbands() else None',
      'rgb = im.convert("RGB")',
      'neg = ImageOps.invert(rgb)',
      'neg.putalpha(a) if a else None',
      'neg.save(p)',
    ].join('; '), dest], { stdio: 'pipe' });
    return true;
  } catch (error) {
    console.warn(`sync-r6-images: invert skipped for ${dest} (${error.message.split('\n')[0]})`);
    return false;
  }
}

// Recolors dark line-art to true-white (RGB 255, alpha untouched) for dark
// UI (manifest entries with `whiten: true`). Skips files already bright —
// safe to flag broadly, only dark art converts. Warns and keeps the
// original when PIL is unavailable.
function whitenPng(dest) {
  try {
    execFileSync('python3', ['-c', [
      'import sys',
      'from PIL import Image',
      'p = sys.argv[1]',
      'im = Image.open(p).convert("RGBA")',
      'px = list(im.getdata())',
      'op = [q for q in px if q[3] > 128]',
      'avg = sum((r + g + b) / 3 for r, g, b, a in op) / len(op) if op else 255',
      'out = Image.new("RGBA", im.size, (0, 0, 0, 0))',
      'ox = out.load(); w, h = im.size; sp = im.load()',
      '[(ox.__setitem__((x, y), (255, 255, 255, sp[x, y][3])) if avg < 128 else None) for y in range(h) for x in range(w)]',
      'out.save(p) if avg < 128 else None',
      'print("converted" if avg < 128 else "skipped-bright")',
    ].join('; '), dest], { stdio: 'pipe' });
    return true;
  } catch (error) {
    console.warn(`sync-r6-images: whiten skipped for ${dest} (${error.message.split('\n')[0]})`);
    return false;
  }
}

// Trims transparent padding to content bbox (+10px margin) so small centered
// glyphs fill their frames (manifest entries with `autocrop: true`).
function autocropPng(dest, margin = 10) {
  try {
    execFileSync('python3', ['-c', [
      'import sys',
      'from PIL import Image',
      'p = sys.argv[1]; m = int(sys.argv[2])',
      'im = Image.open(p).convert("RGBA")',
      'bb = im.split()[3].getbbox()',
      'w, h = im.size',
      'x0, y0, x1, y1 = max(0, bb[0]-m), max(0, bb[1]-m), min(w, bb[2]+m), min(h, bb[3]+m)',
      'im.crop((x0, y0, x1, y1)).save(p) if bb and (x0, y0, x1, y1) != (0, 0, w, h) else None',
      'print("cropped" if bb and (x0, y0, x1, y1) != (0, 0, w, h) else "skipped-tight")',
    ].join('; '), dest, String(margin)], { stdio: 'pipe' });
    return true;
  } catch (error) {
    console.warn(`sync-r6-images: autocrop skipped for ${dest} (${error.message.split('\n')[0]})`);
    return false;
  }
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')).images;
  const stateFile = fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) : {};
  const state = stateFile.files || {};
  const entries = Object.entries(manifest);
  console.log(`sync-r6-images: ${entries.length} files`);
  let done = 0, skipped = 0, refreshed = 0, bytes = 0;
  const failures = [];
  for (const [local, spec] of entries) {
    const dest = path.join(WEB_ROOT, local);
    try {
      // `local` entries pin a repo-vendored file (e.g. user-supplied art):
      // copied as-is, revisioned by content hash, never re-downloaded.
      let remoteUrl = null, payload = null, revision;
      if (spec.local) {
        payload = fs.readFileSync(path.join(ROOT, spec.local));
        revision = 'local:' + crypto.createHash('sha1').update(payload).digest('hex').slice(0, 12);
      } else {
        remoteUrl = spec.url || await resolveUrl(spec.file, spec.width);
        revision = revisionOf(remoteUrl, spec.file);
      }
      // Art transforms are part of the revision: toggling a flag forces one
      // re-download + transform, then converges back to skips.
      if (!spec.local && (spec.whiten || spec.autocrop)) {
        revision += `|${spec.autocrop ? 'crop' : ''}${spec.whiten ? '+white' : ''}`;
      }
      const fileKey = spec.local || spec.file || spec.url;
      const fresh = fs.existsSync(dest) && fs.statSync(dest).size > 0
        && state[local] && state[local].revision === revision && state[local].file === fileKey;
      if (!force && fresh) {
        skipped += 1;
        continue;
      }
      const hadFile = fs.existsSync(dest) && fs.statSync(dest).size > 0;
      if (payload) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, payload);
        bytes += payload.length;
      } else {
        bytes += await download(remoteUrl, dest, spec.referer);
      }
      if (spec.invert) negatePng(dest);
      // Transforms apply to downloads only — repo-vendored `local` pins are
      // canonical as-supplied and copied verbatim.
      if (!payload) {
        if (spec.autocrop) autocropPng(dest);
        if (spec.whiten) whitenPng(dest);
      }
      state[local] = { revision, file: fileKey };
      done += 1;
      if (hadFile) refreshed += 1;
      if (done % 25 === 0) console.log(`sync-r6-images: ${done} downloaded...`);
    } catch (error) {
      failures.push(`${local} (${spec.local || spec.file || spec.url}): ${error.message}`);
    }
    await sleep(SLEEP_MS);
  }
  fs.writeFileSync(STATE_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), files: state }, null, 2) + '\n');
  console.log(`sync-r6-images: downloaded=${done} (refreshed=${refreshed}) skipped=${skipped} bytes=${(bytes / 1048576).toFixed(1)}MB failures=${failures.length}`);
  failures.forEach((f) => console.warn(`sync-r6-images: FAILED ${f}`));
  if (failures.length && !process.env.R6_IMAGES_TOLERATE_FAILURES) process.exitCode = 1;
}

main().catch((error) => { console.error(`sync-r6-images: ${error.message}`); process.exit(1); });
