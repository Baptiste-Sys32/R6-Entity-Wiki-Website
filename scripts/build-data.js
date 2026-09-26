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
const DATA_PATH = path.join(ROOT, 'web', 'data.js');
const LORE_BUNDLE_PATH = path.join(ROOT, 'web', 'lore.js');

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

function validateImagePaths(operators, maps) {
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
  maps.forEach((m) => check(m.thumb, `map ${m.id} thumb`));
  if (missing.length) {
    console.error(`build-data: ${missing.length} image issues:\n- ${missing.slice(0, 20).join('\n- ')}${missing.length > 20 ? `\n... and ${missing.length - 20} more` : ''}`);
    process.exit(1);
  }
  const count = operators.reduce((n, op) => n + [op.icon, op.hero, op.gadgetIcon].filter(Boolean).length + (op.weapons || []).filter((w) => w.image).length, 0)
    + maps.filter((m) => m.thumb).length;
  console.log(`build-data: images ok (${count} files referenced).`);
}

function validateLore(entries, operatorIds) {
  const CAPS = { ubiBio: 1200, ubiPsych: 2500, biography: 4000, psychProfile: 800, psychReport: 3000 };
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

function main() {
  const operators = readJson(OPERATORS_PATH).operators;
  const maps = readJson(MAPS_PATH).maps;
  const seasons = readJson(SEASONS_PATH).seasons;
  const lore = readJson(LORE_PATH);
  const operatorIds = operators.map((op) => op.id);
  validateOperators(operators);
  validateMaps(maps);
  validateSeasons(seasons, new Set(operators.map((op) => op.name)));
  validateLore(lore.entries || {}, operatorIds);
  validateImagePaths(operators, maps);
  const payload = { operators, maps, seasons };
  const output = `var R6_DATABASE = ${JSON.stringify(payload)};\n`;
  const loreOutput = `var R6_LORE = ${JSON.stringify(lore.entries || {})};\n`;
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
    console.log(`build-data: data fresh (operators=${operators.length} maps=${maps.length} seasons=${seasons.length}).`);
    return;
  }
  fs.writeFileSync(DATA_PATH, output);
  fs.writeFileSync(LORE_BUNDLE_PATH, loreOutput);
  console.log(`build-data: wrote web/data.js (operators=${operators.length} maps=${maps.length} seasons=${seasons.length}).`);
  console.log(`build-data: wrote web/lore.js.`);
}

main();
