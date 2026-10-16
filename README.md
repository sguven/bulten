# Daily Brief (Gündem)

A phone-first static site for my Turkish-language news briefs: the intraday **Gün İçi Flaş**
updates and the **Akşam Bülteni** evening brief. Scheduled Claude tasks wrote each issue as JSON
and pushed it here; the site picked it up automatically. The site's content is in Turkish.

> **Status:** archive. New issues are no longer published to this repo; it keeps the issues
> from 7–9 October 2026.

- **Today** – the day's issues laid out like stops on a route: 08:45 pre-open, 12:45 midday,
  15:45 into the close, 18:57 evening brief. An issue that is being prepared pulses in amber.
- **Archive** – every issue by day, with headline search that ignores Turkish diacritics
  ("tutanaklari" finds "tutanakları") and a Flash / Evening Brief filter.
- An open page checks for a new issue every 5 minutes and shows a notice.
- Designed for phones; follows the system dark theme and can be added to the home screen.

## How it works

```
scheduled task ──> veri.json ──> scripts/publish_and_push.sh ──> git push ──> GitHub Pages
                                   │
                                   ├─ scripts/publish.py: validates, writes data/issues/<date>/<type>-<HHMM>.json
                                   └─ rebuilds data/index.json (the archive index)
```

The site is fully static (no build step): `index.html` + `assets/` + `data/`.
Issue types are `flas` (intraday flash) and `aksam` (evening brief).

### Adding an issue by hand

```bash
bash scripts/publish_and_push.sh veri.json flas                      # now (New York time)
bash scripts/publish_and_push.sh veri.json aksam 2026-10-10 18:57    # specific date/time
python3 scripts/publish.py veri.json --type flas --check             # validate only
python3 scripts/publish.py --rebuild                                 # rebuild the index
```

`veri.json` uses the same structure as the PDF script:

```json
{
  "title": "Gün İçi Flaş · Cuma 9 Ekim · 12:45 ET",
  "subtitle": "Öğle · 08:45–12:45 arası",
  "markets": [{ "name": "S&P 500", "level": "6.712,40", "chg": "+0,42%", "note": "12:30 ET" }],
  "market_note": "<b>Ne hareket ettiriyor:</b> …",
  "sections": [{ "heading": "Son dakika", "items": [{ "title": "Short headline", "text": "…" }] }],
  "sources": [{ "title": "Reuters", "url": "https://www.reuters.com/…" }],
  "footer": "…"
}
```

Only `<b>`, `<strong>`, `<i>`, `<em>` and `<br>` are rendered in text; everything else is shown as
plain text. Items whose headline ends with `(doğrulanmadı)` ("unverified") get a label.

### Schedule

The expected stops on the Today page live in `data/site.json`. If the scheduled tasks' times
change, update it there too.

## Tests

```bash
npm ci && pip install pytest && npx playwright install chromium
npm test            # everything
npm run test:py     # publishing scripts (validation, index, git push and conflict handling)
npm run test:unit   # dates/time zones, search, security, stop logic
npm run test:e2e    # real browser: desktop + phone, light/dark theme, accessibility (axe)
npm run serve       # http://localhost:8080
```

GitHub Actions runs all tests on every code change and checks that `data/` is consistent after
every publish.

Fonts: Newsreader and Archivo (SIL Open Font License), hosted with the site.
