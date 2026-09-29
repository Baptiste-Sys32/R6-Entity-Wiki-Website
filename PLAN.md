# R6 Siege Wiki — Master Plan v1

Decisions locked: mappings inferred · videos = YouTube embeds + posters only ·
first data vertical = lore · plan lives here (`PLAN.md`).

## 0. Verdict: port, not rewrite

`web/engine/` is byte-identical across repos; `engine.css` ships every class.
The visual gap is one file (R6 `web/index.html` 601 lines vs DBD 13,483).
Fix = pour R6 data into DBD markup verbatim. No new twists.

## 1. Style pass — carbon-copy port (FIRST, before new data)

Rule: DBD markup + class names verbatim; only strings/fields/counts change.

### 1A. Document head + shell chrome (S)
- Copy DBD `<head>`: tailwind Codex remap, og/twitter tags (new R6 og-cover art),
  JSON-LD, favicon PNG. Launch overlay (`#launch-overlay` + R6 loading tips).
- Delete R6 `DesktopHeader`/`MobileHeader`/`Sidebar`; port `WikiHeader`
  (logo + centered search slot + settings), `WebsiteHeader` (hamburger + brand
  + patch/version pill + gear), `Navigation` sidebar (Main page + sections +
  counts), `SiteFooter` + legal footer. Align config shapes
  (`{label,ids}`, `BROWSE_SHORTLIST`, `getNavDisplayLabel`).
- Root shell: `mobile-app-cta-visible`, swipe handlers, `overflow-hidden` main
  + in-view scrollers, `ScrollToTopFAB`, `SectionDrawer` as-is.

### 1B. Homepage to DBD spec (M)
Order: search hero → `mp-welcome` → `Browse by category` (`cx-linkcols`,
12 R6 links + `cx-cnt`) → `Tools` table (`MAIN_PAGE_TOOLS`) → `Patch notes`
(latest 2 seasons) → `cx-cats` nav. Plus `useDeferredValue`, prefix syntax
(`op:`, `map:`, `season:`, `gadget:`, `random:`), pull-to-refresh.

### 1C. Article skeleton, all three article types (M)
`ViewCrumbs` → `h1.cx-title` → hatnote → `cx-leadgrid` (lead + `cx-toc` +
`cx-infobox`) → engine `CxSection` (id/collapsible/persisted) → `cx-cats`.
Operator depth: Overview, Gadget, Loadout, Lore, Chronicle, Skins, Notes.
Delete local `CxSection`; `AssetFrame` everywhere.

### 1D. List views to ListView spec (M)
`WikiHeaderSearchPortal` filter + count + pills (side/role/squad/season) +
`SortTh` sortable `cx-wikitable` + star column + long-press compare.
Gadgets become cards with effect text.

### 1E. Systems (S each)
Notes store, compare tray + preview modal, swipe nav, Escape, settings
backup/restore JSON, `hapticEnabled` gating, storage normalizers, SEO polish.

Verify: R6-vs-DBD screenshot pairs (same viewport, same rhythm) + all gates.

## 2. Data verticals — scrapers only, never hand-written (lore first)

Pattern per vertical: `scripts/sync-r6-<x>.js` → `content/<x>.json` +
manifest → `sync-r6-images.js` → `build-data.js` validation → views.

### 2A. Lore + bios (FIRST)
- Fandom: Biography, Psychological Profile/Report, quotes, trivia
  (`prop=wikitext&section=` on `(Siege)` pages).
- Ubisoft operator pages: canonical bio + psych report + attributes (SSR HTML).
- Articles gain Lore + Evaluation sections; quotes → hatnotes.

### 2B. Weapons + attachments (SECOND)
- Fandom weapon pages: damage, RPM, mag, reload, ADS, mobility, attachment
  compat flags (Siege tab only).
- Fandom attachment pages (15 verified): effects + percentages + compat tables.
- Dropoff: computed from `Template:WeaponDamage` formula (generate charts).
- Recoil numerics: NO scrapable source (verified) — prose + modifiers first,
  numeric charts need in-game testing later.
- New: weapon detail sheets, attachment compendium, stat tables on Loadouts.

### 2C. Secondary gadgets
- Fandom gadget pages (Claymore verified: image, ammo, damage-by-armor).
- Gadget detail sheets; operator pages link secondaries with icons.

### 2D. Skins + cosmetics (SCRAPER DONE 2026-09-29, no views yet)
- `scripts/sync-r6-skins.js` → `content/skins.json` (4721 items: 407
  uniforms, 516 headgear, 2893 weapon skins, 75 elite/paragon sets,
  747 charms, 83 attachment skins; drone hub is an upstream stub).
  Validated by build-data (structure, per-op linkage, path conventions).
- Remaining: catalog UI (separate approval).

### 2E. Maps
- Ubisoft: thumbs + blueprint ZIPs. Fandom: layouts, floors, spawns,
  objectives, cameras → `MapLayoutModal` + callout tables.

### 2F. Videos (DONE 2026-09-29, embeds only)
- `scripts/sync-r6-videos.js` → `content/videos.json` (64/76 ops):
  Ubisoft SSR first (biography YouTube ID, ability mp4), Fandom
  `{{#ev:youtube}}` backup. YouTube renders as click-to-load lite-embed
  (nocookie) in How to Play; mp4s are outbound links only. No downloads.

## 3. Tool ports (after style + data)

Import/Share loadout codes (S) → Glossary/callouts (M) → Match Log (M) →
Chaos Shuffle (M) → Timeline/Chronicle (M) → Progression hub (L) →
Worldle (L) → Build Lab (L) → Community hub (M).

## 4. Gates (every step)

sync → `build-data --check` → `build-sitemap --check` → smoke scenarios →
screenshot pairs vs DBD rhythm → push. CC-BY-SA + non-affiliation footer.

## 5. Deploy (DEFERRED)

Cloudflare Pages deploy happens only when the wiki is actually done.
Do not propose it as a next step before then.

## 6. Icon follow-ups (resolved 2026-09-28 — user-supplied, pinned)

- **No icon file upstream**: Deimos, Skopós, Tubarão → pinned
  `review/local-assets/{deimos,skopos,tubarao}-icon.webp` (256px, transparent).
- **Legacy upstream**: Buck, Frost, Tachanka → pinned
  `review/local-assets/{buck,frost,tachanka}-badge.webp`.
- Mechanism: `ICON_OVERRIDES` in `sync-r6-data.js` + `{ local: }` manifest
  entries (content-hash revision, never re-downloaded). Resyncs converge.
- Do NOT paper over anything else with gadget faces or currency icons —
  null beats wrong (picker denylist + `gadget != icon` assertion still hold).

## 7. Missing data tracker (audit 2026-09-27, recheck on every resync)

Upstream gaps (wiki has nothing to scrape — fallbacks cover, do not fake):

- **Hero portraits (11)**: Amaru, Capitão, Gridlock, Jackal, Nomad, Bandit,
  Goyo, Kaid, Mozzie, Thorn, Tubarão. Article infoboxes fall back cleanly.
- **Gadget icons (0, resolved 2026-09-28)**: Aruni (`Surya_Gate.png`),
  Goyo (`Volcán_Shield.png`), Lesion (`Gu.png`), Vigil (`ERC-7.png`) via
  `GADGET_ICON_OVERRIDES`; Ace/Kali/Ram switched to schematic art
  (Kali negated for dark UI via manifest `invert`).
- **Map layouts (3 maps)**: Calypso Casino, Fortress, Hereford Base (Rework).
  Articles show the "no floor plans" panel; modal never mounts empty.
- **Quotes (fixed 2026-09-28)**: banter-section `* OpName` headers leaked as
  fake quotes on 5 ops (Ace, Thatcher, Frost, Jäger + Blitz "(Laughs)").
  Parser now keeps only lines with quoted speech and includes nested `**`
  banter lines with speaker prefix. Remaining gaps are genuine upstream
  absences: Ram, Rauora, Sens, Solid Snake, Denari, Noor, Oryx, Tubarão
  (section hides when empty).
- **Trivia (1)**: Solid Snake. **How-to (1)**: Rook.
- **Attachments 13/15**: Horizontal Grip and Scope/Siege are wiki stubs
  (no infobox) — unwinnable until upstream fills them.
- **Loadout coverage (fixed 2026-09-28)**: 52/76 ops had zero firearms —
  three parser bugs in `parseLoadout`: case-sensitive table headers
  (`|Primary`), a `$` in the row terminator that never matched mid-table,
  `|primary =` (spaced) params missed, target-instead-of-display bullets
  (`MAC-11#Sieg|SMG-11`), `|Gadget x 2` headers. All 76 ops now parse
  (Clash shield-only by design); build-data throws on firearm-less ops.
  Knock-ons fixed in the same pass: `{{WeaponTTK}}`/single-range damage
  format (Tacit .45), shared-page alias merging (M249 SAW, AUG A3, Luison,
  9x19VSN), shield exclusions from the stats warning. Weapons 63→106.
- **Weapon TTK (computed locally, 2026-09-28)**: wiki rows (13/62) are
  kept as reference; `ttkComputed` precomputed locally (100/110/125 HP,
  close-range, full-auto ROF; pellet shotguns excluded) — 54 wiki rows
  cross-checked, 4 armor drifts logged (5.7 USG, PRB92, PMM, 1911 TACOPS).
  Static JSON ships; zero client-side math.
- **Weapon alias poisoning (fixed 2026-09-28)**: search fallback adopted
  unrelated pages (GONNE-6 merged as POF-9 alias — Amaru showed POF-9
  stats/link). Resolution is now direct → upstream redirect → curated
  KNOWN_ALIASES → related-only search; page+alias audit throws on
  unrelated adoption; same-page entries consolidate; stale entries carry
  forward (scrubbed) so flaky runs never shrink the dataset. Multi-variant
  pages split into own entries with sliced mag/ammo/reload (M249 SAW).
  Weapons 106→110 (GONNE-6, Tacit .45 + single-range damage format). Independent
  triple-check: 0 errors (self/alias resolution, all 76 loadouts, stat
  sanity, art existence).
- **Operator touch-ups (done 2026-09-29)**: fav/season row under the
  lead removed; infobox Season links to the season sheet; first two
  present sections render beside the infobox rail via additive
  `ArticleShell.leadExtra` (TOC derives from the same order, always in
  sync; mobile single-column unchanged).
- **Role/ability leaks (fixed 2026-09-29)**: same-line `|imagecaption=`
  and `}}` closes bled prose into 13 roles + 2 abilities. Fix is
  post-process (`cleanRole` head-split, `cleanAbility` junk-strip),
  NOT terminator surgery (which broke 25 gadgets). Roster guard refuses
  degraded writes (<90% of candidates).
- **Patch history (2026-09-28)**: `content/patches.json` (170 rows) via
  `sync-r6-liquipedia.js` (free no-key MediaWiki API, gzip, CC BY-SA 3.0,
  warn-only failures). Season sheets show matched Patches sections
  (name-token + `<year>.<season>` version rule); roster cross-check clean
  (diffs are Recruit variants + Warden naming).

Stale-meta hygiene (all resolved — section kept for history):

- ~~`README` still says 72 operators~~ → fixed 2026-09-28 (76 + full counts).
- ~~`META.gameVersion: Y8S4`~~ → fixed 2026-09-28 (`Y11S3`, live season).
- `PROGRESSION_TABS=[]` — still empty; feeds the deferred Progression hub (§3).

## 8. Risks

- Fandom patch-day staleness → patch-history cross-checks + `lastSynced`.
- Recoil numerics need testing, not scraping.
- Non-elite skin coverage is best-effort gallery crawl.
- Ubisoft SSR may go client-rendered → `__NEXT_DATA__` reverse-engineering.
