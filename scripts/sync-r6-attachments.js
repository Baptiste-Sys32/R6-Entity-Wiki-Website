#!/usr/bin/env node

// Syncs attachment data into content/attachments.json from the Rainbow Six wiki.
// Parses the ==Siege== section of attachment pages (image, type, effect prose,
// compatibility lists).
// Usage: node scripts/sync-r6-attachments.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const ATTACHMENTS_PATH = path.join(CONTENT_DIR, 'attachments.json');
const API = 'https://rainbowsix.fandom.com/api.php';
const UA = 'R6-Siege-Wiki-Sync/0.1 (fan wiki content sync; contact via repo issues)';
const SLEEP_MS = 350;

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
    out = out.replace(/\{\{Quote\|[^}]*\}\}/gi, '');
    out = out.replace(/\{\{[^{}]*\|([^{}|]+)\}\}/g, '$1');
    out = out.replace(/\{\{[^{}]*\}\}/g, '');
  }
  out = out.replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, '');
  out = out.replace(/\[\[([^|\]]*\|)?([^\]]+)\]\]/g, '$2');
  out = out.replace(/<\/?[a-z][^>]*>/gi, '').replace(/'''?/g, '');
  return out.replace(/\s+/g, ' ').trim();
}

function siegeSection(wt) {
  const m = String(wt).match(/\n==Siege==\n([\s\S]*?)(?=\n==[^=])/);
  return m ? m[1] : '';
}

function parseAttachment(title, wt) {
  let siege = siegeSection(wt);
  if (!siege) {
    const tab = String(wt).match(/Siege=\s*([\s\S]*?)(?=\|-\||<\/tabber>)/i);
    if (tab) siege = tab[1];
  }
  if (!siege || !/\{\{Infobox\/attachment/.test(siege)) return null;
  const field = (n) => {
    const m = siege.match(new RegExp(`\\|${n}\\s*=([^\\n|][^\\n]*)`));
    return m ? m[1].trim() : '';
  };
  const imageRaw = (field('image').match(/^(.*?)(?:\||$)/) || [])[1] || '';
  const imageFile = imageRaw.replace(/^\[\[(File:)?/i, '').replace(/\]\]$/, '').trim() || null;
  const prose = siege.split('===Weapon Compatibility===')[0];
  const effect = prose.split(/\n{2,}/).map((p) => strip(p).replace(/\}\}/g, '').replace(/^[a-z_][a-z_ ]*=\s*\S+\s+/i, '').trim())
    .filter((p) => p.length > 60 && !/^\s*[a-z_][a-z_ ]*=\s*\S+\s*$/i.test(p)).slice(0, 3).join('\n\n').slice(0, 1200);
  const compatRaw = (siege.split('===Weapon Compatibility===')[1] || '').split('==')[0];
  const compat = [...compatRaw.matchAll(/\*\[\[([^#|\]]+)/g)].map((m) => m[1].replace(/_/g, ' ').trim()).filter(Boolean).slice(0, 60);
  return {
    name: strip(field('name')) || title,
    type: strip(field('type')),
    imageFile,
    effect,
    compat,
  };
}

async function main() {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  const cat = await apiGet({ action: 'query', list: 'categorymembers', cmtitle: "Category:Attachments of Tom Clancy's Rainbow Six Siege", cmlimit: 100, cmtype: 'page' });
  const titles = cat.query.categorymembers.map((m) => m.title).filter((t) => !t.startsWith('Template:'));
  console.log(`sync-attachments: ${titles.length} pages`);
  const iconByTitle = {};
  for (let i = 0; i < titles.length; i += 25) {
    const batch = titles.slice(i, i + 25);
    const data = await apiGet({ action: 'query', prop: 'images', titles: batch.join('|'), imlimit: 200 });
    for (const page of Object.values(data.query?.pages || {})) {
      const files = (page.images || []).map((img) => img.title.replace(/^File:/, ''));
      const hud = files.find((f) => /HUD Icon R6S/i.test(f));
      if (hud) iconByTitle[page.title] = hud;
    }
    await sleep(SLEEP_MS);
  }
  const attachments = [];
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'review', 'r6-image-manifest.json'), 'utf8'));
  let n = 0;
  for (const title of titles) {
    n += 1;
    try {
      const data = await apiGet({ action: 'parse', page: title, prop: 'wikitext' });
      if (data.error) {
        console.warn(`sync-attachments: no page "${title}"`);
        continue;
      }
      const parsed = parseAttachment(title, data.parse.wikitext['*']);
      if (!parsed) {
        console.warn(`sync-attachments: no siege infobox for "${title}"`);
        continue;
      }
      parsed.id = `r6-attach-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      parsed.image = null;
      if (iconByTitle[title]) parsed.imageFile = iconByTitle[title];
      if (parsed.imageFile && (/^<gallery/i.test(parsed.imageFile) || /IRL\.(jpeg|jpg|png)$/i.test(parsed.imageFile))) parsed.imageFile = null;
      if (parsed.imageFile) {
        const rel = `r6_images/attachments/${parsed.id}.png`;
        manifest.images[rel] = { file: parsed.imageFile, width: 200 };
        parsed.image = rel;
      }
      delete parsed.imageFile;
      attachments.push(parsed);
    } catch (error) {
      console.warn(`sync-attachments: failed "${title}": ${error.message}`);
    }
    await sleep(SLEEP_MS);
  }
  const generatedAt = new Date().toISOString();
  fs.writeFileSync(ATTACHMENTS_PATH, JSON.stringify({
    generatedAt,
    metadata: { sources: { wiki: 'https://rainbowsix.fandom.com/api.php (CC-BY-SA)' }, count: attachments.length },
    attachments,
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(ROOT, 'review', 'r6-image-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`sync-attachments: wrote content/attachments.json (${attachments.length}/${titles.length})`);
}

main().catch((error) => { console.error(`sync-attachments: ${error.message}`); process.exit(1); });
