#!/usr/bin/env node

// Builds web/data.js from content/*.json for the R6 Siege Wiki.
// Usage: node scripts/build-data.js [--check]

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OPERATORS_PATH = path.join(ROOT, 'content', 'operators.json');
const MAPS_PATH = path.join(ROOT, 'content', 'maps.json');
const SEASONS_PATH = path.join(ROOT, 'content', 'seasons.json');
const DATA_PATH = path.join(ROOT, 'web', 'data.js');

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

function main() {
  const operators = readJson(OPERATORS_PATH).operators;
  const maps = readJson(MAPS_PATH).maps;
  const seasons = readJson(SEASONS_PATH).seasons;
  validateOperators(operators);
  validateMaps(maps);
  validateSeasons(seasons, new Set(operators.map((op) => op.name)));
  const payload = { operators, maps, seasons };
  const output = `var R6_DATABASE = ${JSON.stringify(payload)};\n`;
  if (checkOnly) {
    const current = fs.existsSync(DATA_PATH) ? fs.readFileSync(DATA_PATH, 'utf8') : '';
    if (current !== output) {
      console.error('build-data: web/data.js is stale, run node scripts/build-data.js');
      process.exit(1);
    }
    console.log(`build-data: data fresh (operators=${operators.length} maps=${maps.length} seasons=${seasons.length}).`);
    return;
  }
  fs.writeFileSync(DATA_PATH, output);
  console.log(`build-data: wrote web/data.js (operators=${operators.length} maps=${maps.length} seasons=${seasons.length}).`);
}

main();
