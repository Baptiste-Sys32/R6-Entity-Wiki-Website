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

### 2D. Skins + cosmetics
- Elite sets + per-op galleries, Ubisoft elite carousel, weapon-skin
  category, seasonal/event/paragon, charms, drone + gadget skins.
- Cosmetics-style catalog view after data proves out.

### 2E. Maps
- Ubisoft: thumbs + blueprint ZIPs. Fandom: layouts, floors, spawns,
  objectives, cameras → `MapLayoutModal` + callout tables.

### 2F. Videos (embeds only)
- YouTube IDs + posters from Ubisoft/Fandom; embed in articles. No downloads.

## 3. Tool ports (after style + data)

Import/Share loadout codes (S) → Glossary/callouts (M) → Match Log (M) →
Chaos Shuffle (M) → Timeline/Chronicle (M) → Progression hub (L) →
Worldle (L) → Build Lab (L) → Community hub (M).

## 4. Gates (every step)

sync → `build-data --check` → `build-sitemap --check` → smoke scenarios →
screenshot pairs vs DBD rhythm → push. CC-BY-SA + non-affiliation footer.

## 5. Risks

- Fandom patch-day staleness → patch-history cross-checks + `lastSynced`.
- Recoil numerics need testing, not scraping.
- Non-elite skin coverage is best-effort gallery crawl.
- Ubisoft SSR may go client-rendered → `__NEXT_DATA__` reverse-engineering.
