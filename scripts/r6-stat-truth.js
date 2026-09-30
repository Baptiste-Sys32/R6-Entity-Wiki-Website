#!/usr/bin/env node

// Canonical live health/speed truth for operators whose scraped sources are
// known-stale. Ubisoft operator pages lag behind patch notes on some ops and
// Fandom infoboxes lag on others — both were wrong for Zofia at once.
// Verified live in-game, Sept 2026 (Y11S2/S3). This map MUST cover every op
// whose sources disagree with live truth, or the next resync regresses it
// (build-data fails loud on 0, but silently accepts stale 2-2 — this map is
// the only guard for those).
// - Zofia: 2H/2S. Y11S2.0 notes "restoring her 2 Health / 2 Speed
//   configuration" (was made 1-speed in Y7S4 Solar Raid, then reverted).
//   Both Fandom and the Ubi operator page still show stale 3-1.
// - Mute: 3H/1S. "Mute now has 3 Health and 1 Speed (was 2 Health, 2 Speed)."
//   Fandom is correct; the Ubi operator page still shows stale 2-2.
// - Ace: 3H/1S. Operation Tenfold Pursuit (Dec 2, 2025) made Ace a 1-speed.
//   Ubi page correct; Fandom still shows stale 2-2.
// - Echo: 2H/2S. Y7S4 "Echo: from one-speed to two-speed". Ubi correct.
// - Ela: 2H/2S. "Ela: from three-speed to two-speed". Ubi correct.
// - Skopos: 1H/3S. Y11S1 Silent Hunt buff "Speed 3 (from 2), Health 1
//   (from 2)". Ubi page correct; Fandom still shows launch 2-2.
// - Warden: 3H/1S ("Armor: 3 (from 2), Speed: 1 (from 2)"). Fandom parse
//   yields 0-0 (infobox dots unparseable); live value confirmed Sept 2026.
// keyed by ubisoft slug; lookupStatOverride() accepts any display name.
// Usage: const { lookupStatOverride } = require('./r6-stat-truth');

const STAT_OVERRIDES = {
  zofia: { health: 2, speed: 2 },
  mute: { health: 3, speed: 1 },
  ace: { health: 3, speed: 1 },
  echo: { health: 2, speed: 2 },
  ela: { health: 2, speed: 2 },
  skopos: { health: 1, speed: 3 },
  warden: { health: 3, speed: 1 },
};

function slugifyStatName(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ø/gi, 'o').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function lookupStatOverride(name) {
  const hit = STAT_OVERRIDES[slugifyStatName(name)];
  return hit ? { health: hit.health, speed: hit.speed } : null;
}

module.exports = { STAT_OVERRIDES, lookupStatOverride };
