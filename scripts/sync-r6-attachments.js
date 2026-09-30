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

// Pinned user-supplied schematics (vendored under review/local-assets/):
// the wiki hosts no white icons for grips/barrels, and the user's NATO
// variants are canonical. Wiki can never clobber these; resyncs converge.
const ATTACH_ART_OVERRIDES = {
  'r6-attach-scope-1-5x': { local: 'review/local-assets/attach-scope-1-5x.webp' },
  'r6-attach-scope-2-5x': { local: 'review/local-assets/attach-scope-2-5x.webp' },
  'r6-attach-telescopic-a': { local: 'review/local-assets/attach-telescopic-a.webp' },
  'r6-attach-scope-3-0x': { local: 'review/local-assets/attach-scope-3-0x.webp' },
  'r6-attach-holographic-sight': { local: 'review/local-assets/attach-holographic.webp' },
  'r6-attach-red-dot-sight': { local: 'review/local-assets/attach-red-dot.webp' },
  'r6-attach-reflex-sight': { local: 'review/local-assets/attach-reflex.webp' },
  'r6-attach-muzzle-brake': { local: 'review/local-assets/attach-muzzle-brake.webp' },
  'r6-attach-flash-hider': { local: 'review/local-assets/attach-flash-hider.webp' },
  'r6-attach-compensator': { local: 'review/local-assets/attach-compensator.webp' },
  'r6-attach-suppressor': { local: 'review/local-assets/attach-suppressor.webp' },
  'r6-attach-vertical-grip': { local: 'review/local-assets/attach-vertical-grip.webp' },
  'r6-attach-horizontal-grip': { local: 'review/local-assets/attach-horizontal-grip.png' },
  'r6-attach-angled-grip': { local: 'review/local-assets/attach-angled-grip.webp' },
  'r6-attach-extended-barrel': { local: 'review/local-assets/attach-extended-barrel.png' },
  'r6-attach-laser': { local: 'review/local-assets/attach-laser.png' },
};

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

function balancedTemplate(wt, start) {
  let depth = 0, end = -1;
  for (let i = start; i < wt.length - 1; i++) {
    if (wt[i] === '{' && wt[i + 1] === '{') { depth += 1; i += 1; }
    else if (wt[i] === '}' && wt[i + 1] === '}') {
      depth -= 1; i += 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  return end > 0 ? wt.slice(start, end) : '';
}

function infoboxBlocks(wt) {
  const out = [];
  let from = 0;
  for (;;) {
    const start = wt.indexOf('{{Infobox/attachment', from);
    if (start < 0) break;
    const block = balancedTemplate(wt, start);
    if (!block) break;
    out.push({ block, index: start });
    from = start + block.length;
  }
  return out;
}

function blockField(block, n) {
  const m = block.match(new RegExp(`\\|${n}\\s*=([^\\n|][^\\n]*)`));
  return m ? m[1].trim() : '';
}

function hudFileOf(markup) {
  const text = String(markup || '');
  // [[File:X.ext|...]] form.
  const linked = text.match(/\[\[(?:File:)?([^\]|]+\.(png|jpg|jpeg|webp))/i);
  if (linked) return linked[1].trim();
  // Bare filename ("R6S Compensator.jpeg") or first file line inside a
  // <gallery> block. Skips markup-only lines.
  const bare = text.match(/^([^|\s][^|\n]*\.(png|jpg|jpeg|webp))/im);
  return bare ? bare[1].trim() : null;
}

function parseAttachment(title, wt) {
  let siege = siegeSection(wt);
  if (!siege) {
    const tab = String(wt).match(/Siege=\s*([\s\S]*?)(?=\|-\||<\/tabber>)/i);
    if (tab) siege = tab[1];
  }
  // Scope/Siege style hub: no ==Siege== section, bare infobox blocks.
  if ((!siege || !/\{\{Infobox\/attachment/.test(siege)) && /\{\{Infobox\/attachment/.test(wt)) siege = wt;
  if (!siege || !/\{\{Infobox\/attachment/.test(siege)) return null;
  const field = (n) => {
    const m = siege.match(new RegExp(`\\|${n}\\s*=([^\\n|][^\\n]*)`));
    return m ? m[1].trim() : '';
  };
  const imageRaw = (field('image').match(/^(.*?)(?:\||$)/) || [])[1] || '';
  const imageFile = imageRaw.replace(/^\[\[(File:)?/i, '').replace(/\]\]$/, '').trim() || null;
  // Prose without infobox markup: strip every infobox block first (their
  // raw params otherwise leak in as fake paragraphs), then drop stray
  // section headings and param fragments.
  let noBoxes = siege;
  for (const { block } of infoboxBlocks(siege)) noBoxes = noBoxes.split(block).join('\n');
  const prose = noBoxes.split(/===+.*?Weapon Compatibility===+/)[0];
  const effect = prose.split(/\n{2,}/).map((p) => strip(p).replace(/\}\}/g, '').replace(/^[a-z_][a-z_ ]*=\s*\S+\s+/i, '').trim())
    .map((p) => p.replace(/^=+[^=\n]+?=+\s*/, ''))
    .filter((p) => p.length > 60 && !/^\s*[a-z_][a-z_ ]*=\s*\S+\s*$/i.test(p) && !/=/.test(p)).slice(0, 3).join('\n\n').slice(0, 1200);
  // Compatibility heading may carry a prefix ("Primary Weapon ...").
  const compatRaw = (siege.split(/===+.*?Weapon Compatibility===+/)[1] || '').split(/==[^=]/)[0];
  const compat = [...compatRaw.matchAll(/\*\[\[([^#|\]]+)/g)].map((m) => m[1].replace(/_/g, ' ').trim()).filter(Boolean).slice(0, 60);
  // Multi-infobox pages (Scope/Siege: Telescopic A + Scope 3.0x; ACOG
  // tab: Scope 1.5x + Scope 2.5x) yield one entry per block, each with its
  // own name/type/HUD-icon art. Display name prefers a scope-ish section
  // heading (the "ACOG Sight" block lives under "===Scope 2.5x===").
  const blocks = infoboxBlocks(siege);
  const headingFor = (index) => {
    const heads = [...siege.slice(0, index).matchAll(/\n={2,}\s*([^\n=]+?)\s*={2,}[ \t]*\n/g)];
    if (!heads.length) return '';
    return (heads[heads.length - 1][1] || '').trim();
  };
  const entries = blocks.length > 1 ? blocks.map(({ block, index }) => {
    const boxName = strip(blockField(block, 'name')) || title;
    const heading = headingFor(index);
    const name = /scope|telescopic/i.test(heading) ? heading : boxName;
    return {
      name,
      type: strip(blockField(block, 'type')).replace(/\}+$/g, '').trim(),
      hud: hudFileOf(blockField(block, 'hudicon')),
      image: hudFileOf(blockField(block, 'image')),
    };
  }) : [{
    name: strip(field('name')) || title,
    type: strip(field('type')).replace(/\}+$/g, '').trim(),
    hud: null,
    image: imageFile,
  }];
  return entries.map((e) => ({ ...e, effect, compat }));
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
  const seenArt = new Set();
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'review', 'r6-image-manifest.json'), 'utf8'));  let n = 0;
  for (const title of titles) {
    n += 1;
    try {
      const data = await apiGet({ action: 'parse', page: title, prop: 'wikitext' });
      if (data.error) {
        console.warn(`sync-attachments: no page "${title}"`);
        continue;
      }
      const parsed = parseAttachment(title, data.parse.wikitext['*']);
      if (!parsed || !parsed.length) {
        console.warn(`sync-attachments: no siege infobox for "${title}"`);
        continue;
      }
      for (const entry of parsed) {
        entry.id = `r6-attach-${entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        entry.page = title;
        const file = entry.image;
        entry.image = null;
        const pinned = ATTACH_ART_OVERRIDES[entry.id];
        if (pinned?.local) {
          manifest[`r6_images/attachments/${entry.id}.png`] = { local: pinned.local };
          entry.image = `r6_images/attachments/${entry.id}.png`;
          delete entry.hud;
          delete entry.picked;
          attachments.push(entry);
          continue;
        }
        // Infobox HUD icon first (white schematic), then page-wide HUD
        // icon, then infobox image. Gallery/IRL junk is never art.
        const picked = entry.hud || iconByTitle[title] || file;
        if (picked && (/^<gallery/i.test(picked) || /IRL\.(jpeg|jpg|png)$/i.test(picked))) {
          entry.picked = null;
        } else {
          entry.picked = picked;
        }
        // Same-page duplicate infoboxes (ACOG tab variants) share art —
        // keep the first, drop the rest. Distinct art stays distinct.
        if (entry.picked && seenArt.has(`${title}|${entry.picked}`)) {
          console.log(`sync-attachments: deduped "${entry.name}" on "${title}" (same art)`);
          continue;
        }
        seenArt.add(`${title}|${entry.picked}`);
        if (entry.picked) {
          const rel = `r6_images/attachments/${entry.id}.png`;
          manifest.images[rel] = { file: entry.picked, width: 200 };
          entry.image = rel;
        }
        delete entry.hud;
        delete entry.picked;
        attachments.push(entry);
      }
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
