#!/usr/bin/env node

// Builds web/data.js from content/*.json for the R6 Siege Wiki.
// Usage: node scripts/build-data.js [--check]

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OPERATORS_PATH = path.join(ROOT, 'content', 'operators.json');
const MAPS_PATH = path.join(ROOT, 'content', 'maps.json');
const SEASONS_PATH = path.join(ROOT, 'content', 'seasons.json');
const LORE_PATH = path.join(ROOT, 'content', 'lore.json');
const WEAPONS_PATH = path.join(ROOT, 'content', 'weapons.json');
const ATTACHMENTS_PATH = path.join(ROOT, 'content', 'attachments.json');
const GADGETS_PATH = path.join(ROOT, 'content', 'gadgets.json');
const PATCHES_PATH = path.join(ROOT, 'content', 'patches.json');
const DATA_PATH = path.join(ROOT, 'web', 'data.js');
const LORE_BUNDLE_PATH = path.join(ROOT, 'web', 'lore.js');
const WEAPONS_BUNDLE_PATH = path.join(ROOT, 'web', 'weapons.js');
const GADGETS_BUNDLE_PATH = path.join(ROOT, 'web', 'gadgets.js');
const PATCHES_BUNDLE_PATH = path.join(ROOT, 'web', 'patches.js');
const SKINS_PATH = path.join(ROOT, 'content', 'skins.json');
const VIDEOS_PATH = path.join(ROOT, 'content', 'videos.json');
const VIDEOS_BUNDLE_PATH = path.join(ROOT, 'web', 'videos.js');

const checkOnly = new Set(process.argv.slice(2)).has('--check');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function validateOperators(operators) {
  const seen = new Set();
  operators.forEach((op, index) => {
    const label = `operator #${index + 1}`;
    if (!op || typeof op !== 'object') throw new Error(`${label} is not an object`);
    for (const key of ['id', 'name', 'side', 'squad', 'season', 'gadget', 'ability']) {
      if (typeof op[key] !== 'string' || !op[key]) throw new Error(`${label} is missing ${key}`);
    }
    if (!['Attacker', 'Defender'].includes(op.side)) throw new Error(`${label} has invalid side ${op.side}`);
    if (seen.has(op.id)) throw new Error(`duplicate operator id ${op.id}`);
    seen.add(op.id);
    for (const key of ['role', 'gadget', 'ability']) {
      const v = op[key];
      if (typeof v === 'string' && v && /[|{}[\]]/.test(v)) throw new Error(`${label} has markup leak in ${key}: ${v.slice(0, 60)}`);
    }
    if (typeof op.role === 'string' && op.role.length > 80) throw new Error(`${label} has overlong role (leak?): ${op.role.slice(0, 60)}`);
    // Every operator ships firearms — except Clash (ballistic shield only).
    // Loud failure beats silent empty Loadout sections.
    if (op.id !== 'r6-clash') {
      const guns = (op.weapons || []).filter((w) => w.slot === 'primary' || w.slot === 'secondary');
      if (!guns.length) throw new Error(`${label} (${op.name}) has no primary/secondary weapons`);
    }
  });
}

function validateMaps(maps) {
  const seen = new Set();
  maps.forEach((map, index) => {
    const label = `map #${index + 1}`;
    if (!map || typeof map !== 'object') throw new Error(`${label} is not an object`);
    for (const key of ['id', 'name', 'setting']) {
      if (typeof map[key] !== 'string' || !map[key]) throw new Error(`${label} is missing ${key}`);
    }
    if (!Array.isArray(map.modes) || map.modes.length === 0) throw new Error(`${label} is missing modes`);
    if (seen.has(map.id)) throw new Error(`duplicate map id ${map.id}`);
    seen.add(map.id);
  });
}

function validateSeasons(seasons, operatorNames) {
  const seen = new Set();
  seasons.forEach((season, index) => {
    const label = `season #${index + 1}`;
    if (!season || typeof season !== 'object') throw new Error(`${label} is not an object`);
    for (const key of ['id', 'name', 'code', 'blurb']) {
      if (typeof season[key] !== 'string' || !season[key]) throw new Error(`${label} is missing ${key}`);
    }
    if (typeof season.year !== 'number') throw new Error(`${label} is missing year`);
    if (!Array.isArray(season.operators)) throw new Error(`${label} is missing operators array`);
    season.operators.forEach((name) => {
      if (!operatorNames.has(name)) console.warn(`build-data: season ${season.code} references unknown operator "${name}" (not in MVP roster).`);
    });
    if (seen.has(season.id)) throw new Error(`duplicate season id ${season.id}`);
    seen.add(season.id);
  });
}

function validateImagePaths(operators, maps, seasons, gadgets) {
  const missing = [];
  const check = (rel, owner) => {
    if (!rel) return;
    if (!/^r6_images\//.test(rel)) missing.push(`${owner}: image path escapes r6_images/ (${rel})`);
    else if (!fs.existsSync(path.join(ROOT, 'web', rel))) missing.push(`${owner}: missing file web/${rel}`);
    else if (fs.statSync(path.join(ROOT, 'web', rel)).size === 0) missing.push(`${owner}: empty file web/${rel}`);
  };
  operators.forEach((op) => {
    check(op.icon, `operator ${op.id} icon`);
    check(op.hero, `operator ${op.id} hero`);
    check(op.gadgetIcon, `operator ${op.id} gadgetIcon`);
    (op.weapons || []).forEach((w) => check(w.image, `operator ${op.id} weapon ${w.name}`));
  });
  maps.forEach((m) => {
    check(m.thumb, `map ${m.id} thumb`);
    (m.layouts || []).forEach((l, i) => {
      if (!l || typeof l.image !== 'string' || !l.label) missing.push(`map ${m.id} layout #${i + 1} invalid`);
      else {
        if (!['basement', 'floor-1', 'floor-2', 'floor-3', 'roof', 'spawn', 'overview'].includes(l.floor)) missing.push(`map ${m.id} layout ${l.label} has bad floor`);
        if (!Number.isInteger(l.order)) missing.push(`map ${m.id} layout ${l.label} has bad order`);
        check(l.image, `map ${m.id} layout ${l.label}`);
      }
    });
  });
  (seasons || []).forEach((s) => check(s.cover, `season ${s.id} cover`));
  (gadgets || []).forEach((g) => {
    check(g.image, `gadget ${g.id} art`);
    check(g.hud, `gadget ${g.id} hud`);
  });
  if (missing.length) {
    console.error(`build-data: ${missing.length} image issues:\n- ${missing.slice(0, 20).join('\n- ')}${missing.length > 20 ? `\n... and ${missing.length - 20} more` : ''}`);
    process.exit(1);
  }
  const refs = new Set();
  const track = (rel) => { if (rel) refs.add(rel); };
  operators.forEach((op) => {
    track(op.icon); track(op.hero); track(op.gadgetIcon);
    (op.weapons || []).forEach((w) => track(w.image));
  });
  maps.forEach((m) => {
    track(m.thumb);
    (m.layouts || []).forEach((l) => track(l.image));
  });
  (seasons || []).forEach((s) => track(s.cover));
  console.log(`build-data: images ok (${refs.size} files referenced).`);
}

function validateLore(entries, operatorIds) {
  const CAPS = { ubiBio: 1200, ubiPsych: 2500, biography: 4000, psychProfile: 800, psychReport: 3000, howto: 900 };
  const LEAK = /(\[\[|\{\{|<ref|<div|&quot;|&(#[0-9]+|[a-z]+);|==[^=\n]+==)/;
  const issues = [];
  for (const id of operatorIds) {
    const entry = entries[id];
    if (!entry || typeof entry !== 'object') {
      issues.push(`lore missing entry for ${id}`);
      continue;
    }
    for (const [key, cap] of Object.entries(CAPS)) {
      const value = entry[key];
      if (value !== undefined && value !== null && typeof value !== 'string') issues.push(`lore ${id}.${key} not a string`);
      else if (typeof value === 'string' && value) {
        if (value.length > cap) issues.push(`lore ${id}.${key} over cap (${value.length} > ${cap})`);
        if (LEAK.test(value)) issues.push(`lore ${id}.${key} has markup leak`);
      }
    }
    for (const key of ['quotes', 'trivia', 'specialties']) {
      if (entry[key] !== undefined && !Array.isArray(entry[key])) issues.push(`lore ${id}.${key} not an array`);
    }
    if (entry.tips !== undefined) {
      if (!Array.isArray(entry.tips)) issues.push(`lore ${id}.tips not an array`);
      else entry.tips.forEach((tip, i) => {
        if (!tip || typeof tip.title !== 'string' || typeof tip.text !== 'string') issues.push(`lore ${id}.tips[${i}] invalid`);
        else if (tip.text.length > 600) issues.push(`lore ${id}.tips[${i}] over cap`);
      });
    }
    for (const key of ['health', 'speed', 'difficulty']) {
      const value = entry[key];
      if (value !== undefined && value !== null && !(Number.isInteger(value) && value >= 1 && value <= 3)) issues.push(`lore ${id}.${key} invalid rating`);
    }
  }
  if (issues.length) {
    console.error(`build-data: ${issues.length} lore issues:\n- ${issues.slice(0, 20).join('\n- ')}${issues.length > 20 ? `\n... and ${issues.length - 20} more` : ''}`);
    process.exit(1);
  }
  const filled = Object.values(entries).filter((e) => e && (e.biography || e.ubiBio)).length;
  console.log(`build-data: lore ok (filled=${filled}/${operatorIds.length}).`);
}

function validateGadgets(gadgets, operators, normalize) {
  // Tolerant lookup: upstream varies case and appends " x N" ammo suffixes
  // ("Frag grenade", "Frag Grenade x 2"). Exact first, then loose.
  const loose = (name) => {
    if (normalize[name]) return normalize[name];
    const key = String(name).replace(/\s*x\s*\d+\s*$/i, '').trim().toLowerCase();
    const hit = Object.keys(normalize).find((k) => k.toLowerCase() === key
      || k.replace(/\s*x\s*\d+\s*$/i, '').trim().toLowerCase() === key);
    return hit ? normalize[hit] : null;
  };
  const seen = new Set();
  gadgets.forEach((g, index) => {
    const label = `gadget #${index + 1} (${g.id || '?'})`;
    if (!g || typeof g !== 'object') throw new Error(`${label} is not an object`);
    for (const key of ['id', 'name', 'page']) {
      if (typeof g[key] !== 'string' || !g[key]) throw new Error(`${label} is missing ${key}`);
    }
    if (!Array.isArray(g.users)) throw new Error(`${label} users not an array`);
    if (seen.has(g.id)) throw new Error(`duplicate gadget ${g.id}`);
    seen.add(g.id);
  });
  const byId = new Set(gadgets.map((g) => g.id));
  const unmapped = new Set();
  operators.forEach((op) => {
    (op.weapons || []).forEach((w) => {
      if (w.slot !== 'gadget') return;
      const id = loose(w.name);
      if (!id || !byId.has(id)) unmapped.add(`${op.name}: ${w.name}`);
    });
  });
  if (unmapped.size) {
    console.error(`build-data: ${unmapped.size} loadout gadgets without canonical id:\n- ${[...unmapped].slice(0, 20).join('\n- ')}`);
    process.exit(1);
  }
  console.log(`build-data: gadgets ok (${gadgets.length}).`);
}

function validateWeapons(weapons, loadoutNames) {
  const seen = new Set();
  weapons.forEach((w, index) => {
    const label = `weapon #${index + 1} (${w.name || '?'})`;
    if (!w || typeof w !== 'object') throw new Error(`${label} is not an object`);
    for (const key of ['name', 'type']) {
      if (typeof w[key] !== 'string' || !w[key]) throw new Error(`${label} is missing ${key}`);
    }
    if (/[|{}[\]]/.test(w.type)) throw new Error(`${label} has markup leak in type: ${w.type.slice(0, 60)}`);
    if (w.damage !== null && w.damage !== undefined && !(Number.isFinite(w.damage) && w.damage > 0)) throw new Error(`${label} has invalid damage`);
    if (w.rof !== null && w.rof !== undefined && !(Number.isFinite(w.rof) && w.rof > 0)) throw new Error(`${label} has invalid rof`);
    if (w.ttkComputed !== null && w.ttkComputed !== undefined) {
      if (typeof w.ttkComputed !== 'object') throw new Error(`${label} has invalid ttkComputed`);
      for (const k of ['armor1Ms', 'armor2Ms', 'armor3Ms']) {
        const v = w.ttkComputed[k];
        if (v !== null && !(Number.isFinite(v) && v >= 0)) throw new Error(`${label} has invalid ttkComputed.${k}`);
      }
    }
    if (seen.has(w.name)) throw new Error(`duplicate weapon ${w.name}`);
    seen.add(w.name);
  });
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const known = new Set();
  weapons.forEach((w) => {
    known.add(norm(w.name));
    (w.aliases || []).forEach((a) => known.add(norm(a)));
  });
  // Shields ride primary slots but are not firearms (no stat pages exist).
  const NON_FIREARM = new Set(['super90', 'ballisticshield', 'hulladaptableshield', 'g52tacticalshield', 'extendableshield', 'cceshield'].map(norm));
  const missing = [...loadoutNames].filter((n) => !known.has(norm(n)) && !NON_FIREARM.has(norm(n)));
  if (missing.length) console.warn(`build-data: ${missing.length} loadout firearms without stats: ${missing.join(', ')}`);
  console.log(`build-data: weapons ok (${weapons.length}).`);
}

function validateAttachments(attachments) {
  attachments.forEach((a, index) => {
    const label = `attachment #${index + 1} (${a.name || '?'})`;
    if (!a || typeof a !== 'object') throw new Error(`${label} is not an object`);
    for (const key of ['id', 'name']) {
      if (typeof a[key] !== 'string' || !a[key]) throw new Error(`${label} is missing ${key}`);
    }
  });
  console.log(`build-data: attachments ok (${attachments.length}).`);
}

// Skins are data-only for now (no views consume them): validate structure
// + path conventions. File existence is enforced when the catalog UI lands.
function validateSkins(doc, operatorIds) {
  if (!doc || typeof doc !== 'object' || !doc.skins) throw new Error('skins doc invalid');
  const { skins } = doc;
  const ids = new Set(operatorIds);
  const checkImage = (rel, owner) => {
    if (rel === null || rel === undefined) return;
    if (typeof rel !== 'string' || !rel.startsWith('r6_images/skins/')) throw new Error(`${owner}: bad skin image path (${rel})`);
  };
  let n = 0;
  for (const [bucket, byOp] of [['uniforms', true], ['headgear', true], ['weapons', false]]) {
    const group = skins[bucket] || {};
    for (const [key, items] of Object.entries(group)) {
      if (byOp && !ids.has(key)) throw new Error(`skins.${bucket} unknown operator ${key}`);
      if (!Array.isArray(items)) throw new Error(`skins.${bucket}.${key} not an array`);
      for (const it of items) {
        if (!it || typeof it.name !== 'string' || !it.name) throw new Error(`skins.${bucket}.${key} bad item`);
        checkImage(it.image, `skins.${bucket}.${key}:${it.name}`);
        n += 1;
      }
    }
  }
  for (const [opId, sets] of Object.entries(skins.elite || {})) {
    if (!ids.has(opId)) throw new Error(`skins.elite unknown operator ${opId}`);
    if (!Array.isArray(sets)) throw new Error(`skins.elite.${opId} not an array`);
    for (const s of sets) {
      if (!s || !['elite', 'paragon'].includes(s.kind) || typeof s.set !== 'string' || !s.set) throw new Error(`skins.elite.${opId} bad set`);
      checkImage(s.image, `skins.elite.${opId}:${s.set}`);
      checkImage(s.contents, `skins.elite.${opId}:${s.set}#contents`);
      checkImage(s.gadget, `skins.elite.${opId}:${s.set}#gadget`);
      n += 1;
    }
  }
  for (const bucket of ['charms', 'drone', 'attachments']) {
    if (!Array.isArray(skins[bucket])) throw new Error(`skins.${bucket} not an array`);
    for (const it of skins[bucket]) {
      if (!it || typeof it.name !== 'string' || !it.name) throw new Error(`skins.${bucket} bad item`);
      checkImage(it.image, `skins.${bucket}:${it.name}`);
      n += 1;
    }
  }
  console.log(`build-data: skins ok (${n} items, data-only).`);
}

// Videos: YouTube IDs embed in How to Play; mp4s are outbound links only.
function validateVideos(entries, operatorIds) {
  if (!entries || typeof entries !== 'object') throw new Error('videos entries invalid');
  const ids = new Set(operatorIds);
  let n = 0, yt = 0;
  for (const [opId, vids] of Object.entries(entries)) {
    if (!ids.has(opId)) throw new Error(`videos unknown operator ${opId}`);
    if (!Array.isArray(vids)) throw new Error(`videos.${opId} not an array`);
    for (const v of vids) {
      if (!v || typeof v !== 'object') throw new Error(`videos.${opId} bad entry`);
      if (v.youtubeId !== undefined && v.youtubeId !== null && !/^[A-Za-z0-9_-]{6,15}$/.test(v.youtubeId)) {
        throw new Error(`videos.${opId} bad youtubeId ${v.youtubeId}`);
      }
      if (v.mp4 !== undefined && v.mp4 !== null && !/^https:\/\/staticctf\.ubisoft\.com\/\S+\.mp4$/i.test(v.mp4)) {
        throw new Error(`videos.${opId} bad mp4 host (hotlink guard)`);
      }
      if (typeof v.label !== 'string' || !['ubisoft', 'fandom'].includes(v.source)) throw new Error(`videos.${opId} bad label/source`);
      n += 1;
      if (v.youtubeId) yt += 1;
    }
  }
  console.log(`build-data: videos ok (${n} entries, ${yt} youtube, ${Object.keys(entries).length} operators).`);
}

function validatePatches(patches) {
  if (!Array.isArray(patches)) throw new Error('patches is not an array');
  patches.forEach((p, index) => {
    const label = `patch #${index + 1} (${p.version || '?'})`;
    if (!p || typeof p !== 'object') throw new Error(`${label} is not an object`);
    for (const key of ['version', 'date']) {
      if (typeof p[key] !== 'string' || !p[key]) throw new Error(`${label} is missing ${key}`);
    }
    if (p.url !== null && p.url !== undefined && typeof p.url !== 'string') throw new Error(`${label} has invalid url`);
  });
  console.log(`build-data: patches ok (${patches.length}).`);
}

function main() {
  const operators = readJson(OPERATORS_PATH).operators;
  const maps = readJson(MAPS_PATH).maps;
  const seasons = readJson(SEASONS_PATH).seasons;
  const lore = readJson(LORE_PATH);
  const weaponsDoc = readJson(WEAPONS_PATH);
  const weapons = weaponsDoc.weapons;
  const attachmentsDoc = readJson(ATTACHMENTS_PATH);
  const attachments = attachmentsDoc.attachments;
  const gadgetsDoc = readJson(GADGETS_PATH);
  const gadgets = gadgetsDoc.gadgets;
  const gadgetNormalize = gadgetsDoc.normalize || {};
  const patchesDoc = fs.existsSync(PATCHES_PATH) ? readJson(PATCHES_PATH) : { patches: [] };
  const patches = patchesDoc.patches || [];
  const skinsDoc = fs.existsSync(SKINS_PATH) ? readJson(SKINS_PATH) : null;
  const videosDoc = fs.existsSync(VIDEOS_PATH) ? readJson(VIDEOS_PATH) : { entries: {} };
  const videos = videosDoc.entries || {};
  const operatorIds = operators.map((op) => op.id);
  validateOperators(operators);
  validateMaps(maps);
  validateSeasons(seasons, new Set(operators.map((op) => op.name)));
  validateLore(lore.entries || {}, operatorIds);
  validateWeapons(weapons, new Set(operators.flatMap((op) => (op.weapons || []).filter((w) => w.slot !== 'gadget').map((w) => w.name))));
  validateAttachments(attachments);
  validateGadgets(gadgets, operators, gadgetNormalize);
  validatePatches(patches);
  if (skinsDoc) validateSkins(skinsDoc, operatorIds);
  validateVideos(videos, operatorIds);
  validateImagePaths(operators, maps, seasons, gadgets);
  const payload = { operators, maps, seasons };
  // Attach canonical gadget ids to loadout secondary entries (single source:
  // content/gadgets.json normalize map, same tolerant lookup as validation).
  // Raw display names stay in operators.json.
  const looseGadget = (name) => {
    if (gadgetNormalize[name]) return gadgetNormalize[name];
    const key = String(name).replace(/\s*x\s*\d+\s*$/i, '').trim().toLowerCase();
    const hit = Object.keys(gadgetNormalize).find((k) => k.toLowerCase() === key
      || k.replace(/\s*x\s*\d+\s*$/i, '').trim().toLowerCase() === key);
    return hit ? gadgetNormalize[hit] : null;
  };
  const emittedOperators = operators.map((op) => ({
    ...op,
    weapons: (op.weapons || []).map((w) => (w.slot === 'gadget' && looseGadget(w.name)
      ? { ...w, gadgetId: looseGadget(w.name) } : w)),
  }));
  const payloadOut = { operators: emittedOperators, maps, seasons };
  const output = `var R6_DATABASE = ${JSON.stringify(payloadOut)};\n`;
  const loreOutput = `var R6_LORE = ${JSON.stringify(lore.entries || {})};\n`;
  const norm2 = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const byNorm = {};
  weapons.forEach((w) => {
    byNorm[norm2(w.name)] = w.name;
    (w.aliases || []).forEach((a) => { byNorm[norm2(a)] = w.name; });
  });
  if (byNorm[norm2('M1014')]) byNorm[norm2('Super 90')] = byNorm[norm2('M1014')];
  // Canonical render per weapon: first non-null operator loadout render
  // (no new scrape — reuses operators.json weapon images).
  const renderByWeapon = {};
  operators.forEach((op) => {
    (op.weapons || []).forEach((w) => {
      if (!w.image || w.slot === 'gadget') return;
      const canon = byNorm[norm2(w.name)];
      if (canon && !renderByWeapon[canon]) renderByWeapon[canon] = w.image;
    });
  });
  const weaponsWithImages = weapons.map((w) => ({ ...w, image: w.art || renderByWeapon[w.name] || null }));
  const missingRenders = [];
  weaponsWithImages.forEach((w) => {
    if (!w.image) return;
    if (!/^r6_images\//.test(w.image) || !fs.existsSync(path.join(ROOT, 'web', w.image))) missingRenders.push(`${w.name}: ${w.image}`);
  });
  if (missingRenders.length) throw new Error(`weapon renders missing:\n- ${missingRenders.join('\n- ')}`);
  console.log(`build-data: weapon renders ok (${Object.keys(renderByWeapon).length}/${weapons.length}).`);
  const weaponsOutput = `var R6_WEAPONS = ${JSON.stringify({ weapons: weaponsWithImages, attachments, aliases: byNorm })};\n`;
  const gadgetsOutput = `var R6_GADGETS = ${JSON.stringify({ gadgets })};\n`;
  const patchesOutput = `var R6_PATCHES = ${JSON.stringify({ patches })};\n`;
  const videosOutput = `var R6_VIDEOS = ${JSON.stringify({ entries: videos })};\n`;
  if (checkOnly) {
    const current = fs.existsSync(DATA_PATH) ? fs.readFileSync(DATA_PATH, 'utf8') : '';
    if (current !== output) {
      console.error('build-data: web/data.js is stale, run node scripts/build-data.js');
      process.exit(1);
    }
    const currentLore = fs.existsSync(LORE_BUNDLE_PATH) ? fs.readFileSync(LORE_BUNDLE_PATH, 'utf8') : '';
    if (currentLore !== loreOutput) {
      console.error('build-data: web/lore.js is stale, run node scripts/build-data.js');
      process.exit(1);
    }
    const currentWeapons = fs.existsSync(WEAPONS_BUNDLE_PATH) ? fs.readFileSync(WEAPONS_BUNDLE_PATH, 'utf8') : '';
    if (currentWeapons !== weaponsOutput) {
      console.error('build-data: web/weapons.js is stale, run node scripts/build-data.js');
      process.exit(1);
    }
    const currentGadgets = fs.existsSync(GADGETS_BUNDLE_PATH) ? fs.readFileSync(GADGETS_BUNDLE_PATH, 'utf8') : '';
    if (currentGadgets !== gadgetsOutput) {
      console.error('build-data: web/gadgets.js is stale, run node scripts/build-data.js');
      process.exit(1);
    }
    const currentPatches = fs.existsSync(PATCHES_BUNDLE_PATH) ? fs.readFileSync(PATCHES_BUNDLE_PATH, 'utf8') : '';
    if (currentPatches !== patchesOutput) {
      console.error('build-data: web/patches.js is stale, run node scripts/build-data.js');
      process.exit(1);
    }
    const currentVideos = fs.existsSync(VIDEOS_BUNDLE_PATH) ? fs.readFileSync(VIDEOS_BUNDLE_PATH, 'utf8') : '';
    if (currentVideos !== videosOutput) {
      console.error('build-data: web/videos.js is stale, run node scripts/build-data.js');
      process.exit(1);
    }
    console.log(`build-data: data fresh (operators=${operators.length} maps=${maps.length} seasons=${seasons.length}).`);
    return;
  }
  fs.writeFileSync(DATA_PATH, output);
  fs.writeFileSync(LORE_BUNDLE_PATH, loreOutput);
  fs.writeFileSync(WEAPONS_BUNDLE_PATH, weaponsOutput);
  fs.writeFileSync(GADGETS_BUNDLE_PATH, gadgetsOutput);
  fs.writeFileSync(PATCHES_BUNDLE_PATH, patchesOutput);
  fs.writeFileSync(VIDEOS_BUNDLE_PATH, videosOutput);
  console.log(`build-data: wrote web/data.js (operators=${operators.length} maps=${maps.length} seasons=${seasons.length}).`);
  console.log(`build-data: wrote web/lore.js.`);
}

main();
