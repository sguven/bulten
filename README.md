# World Brief

**Live:** https://sguven.github.io/bulten/

A short, phone-first page with the world news that matters, written in English every evening
around 7 pm New York time. Each issue has 4–5 headlines, a sentence or two on why each one
matters, and links to the sources.

It is the public, English edition of a personal daily news brief that a scheduled Claude task
researches and writes. The full brief (markets, Turkey, local news) goes to email in Turkish;
only the world section is published here.

## Features

- **Today** – the latest issue, with a marker for the next expected one.
- **Archive** – every issue by day, with headline search.
- Checks for a new issue every 5 minutes; follows the system dark theme; can be added to the
  home screen.

## How it works

```
scheduled Claude task ──> veri.json ──> scripts/publish_and_push.sh ──> git push ──> GitHub Pages
                                         └─ scripts/publish.py: validates (English, "World" only),
                                            writes data/world/<date>_aksam-<HHMM>.json,
                                            rebuilds data/world.json
```

Static site, no build step: `index.html` + `data/world.json`.

```bash
bash scripts/publish_and_push.sh veri.json        # publish an issue
python3 scripts/publish.py veri.json --check      # validate only
python3 scripts/publish.py --rebuild              # rebuild data/world.json
```

Issues from October 2026 (Turkish, full brief) remain in the git history.
