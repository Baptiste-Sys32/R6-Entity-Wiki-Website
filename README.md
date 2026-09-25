# R6 Siege Wiki

Fan-made Rainbow Six Siege wiki website. Built on the shared wiki engine
(`web/engine/`, extracted from the DBD Entity Wiki) plus the R6 game adapter
(`web/games/r6/`).

## Data pipeline (all scraped, nothing hand-written)

```
node scripts/sync-r6-data.js   # Rainbow Six wiki (Fandom API) -> content/*.json
node scripts/build-data.js     # content/*.json -> web/data.js (validated)
node scripts/build-sitemap.js  # web/data.js -> web/sitemap.xml
npm run check:data              # freshness gates for data + sitemap
```

Current content: 72 operators, 27 maps, 44 seasons (Year 1 – Year 11).

## Preview

Serve `web/` statically (`python3 -m http.server --directory web`) and open
`http://127.0.0.1:8000/index.html`.

## Attribution

Operator, map and season text: Rainbow Six Wiki contributors (CC-BY-SA).
Fan project, not affiliated with Ubisoft.
