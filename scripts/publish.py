#!/usr/bin/env python3
"""Add a World Brief issue to the site and rebuild data/world.json.

    python3 scripts/publish.py veri.json          # validate + write data/world/<date>_aksam-<HHMM>.json
    python3 scripts/publish.py veri.json --check  # validate only
    python3 scripts/publish.py --rebuild          # rebuild data/world.json from data/world/*.json

veri.json: {"type":"aksam","date":"YYYY-MM-DD","time":"HH:MM","key":"YYYY-MM-DDTHH:MM",
            "published_at":"ISO 8601","title":"World Brief · ...","subtitle":"Prepared HH:MM ET",
            "sections":[{"heading":"World","items":[{"title":"...","text":"..."}]}],
            "sources":[{"title":"...","url":"https://..."}],"footer":"..."}
Standard library only.
"""
import argparse, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIR = ROOT / "data" / "world"
TURKISH = re.compile(r"[ğĞşŞıİ]")
# Turkish-only letters in proper names (Erdoğan, Qeşm, İstanbul) are transliterated
# automatically instead of rejecting the whole issue.
TRANSLIT = str.maketrans({"ğ": "g", "Ğ": "G", "ş": "s", "Ş": "S", "ı": "i", "İ": "I"})


def translit(x):
    if isinstance(x, str):
        return x.translate(TRANSLIT)
    if isinstance(x, list):
        return [translit(v) for v in x]
    if isinstance(x, dict):
        return {k: translit(v) for k, v in x.items()}
    return x


def validate(d):
    d = translit(d)
    errs = []
    for k in ("date", "time", "title"):
        if not isinstance(d.get(k), str) or not d[k].strip():
            errs.append(f"missing {k}")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d.get("date", "")):
        errs.append("date must be YYYY-MM-DD")
    if not re.fullmatch(r"\d{2}:\d{2}", d.get("time", "")):
        errs.append("time must be HH:MM")
    secs = d.get("sections") or []
    if [s.get("heading") for s in secs] != ["World"]:
        errs.append("sections must contain exactly one section with heading 'World'")
    elif not secs[0].get("items"):
        errs.append("World section has no items")
    for s in d.get("sources") or []:
        if not str(s.get("url", "")).startswith("https://"):
            errs.append(f"source url must be https: {s.get('url')}")
    if TURKISH.search(json.dumps(d, ensure_ascii=False)):
        errs.append("Turkish characters found; the site is English-only")
    if errs:
        sys.exit("INVALID: " + "; ".join(errs))
    d["type"] = "aksam"
    d["key"] = f"{d['date']}T{d['time']}"
    return d


def rebuild():
    issues = []
    for p in sorted(DIR.glob("*.json")):
        issues.append({"id": p.stem, "data": json.loads(p.read_text())})
    issues.sort(key=lambda x: x["data"]["key"], reverse=True)
    out = {"latest": issues[0]["id"] if issues else None, "count": len(issues), "issues": issues}
    (ROOT / "data" / "world.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("veri", nargs="?")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--rebuild", action="store_true")
    a = ap.parse_args()
    if a.veri:
        d = validate(json.loads(Path(a.veri).read_text()))
        doc_id = f"{d['date']}_aksam-{d['time'].replace(':', '')}"
        if a.check:
            print(f"OK: {doc_id}")
            return
        DIR.mkdir(parents=True, exist_ok=True)
        (DIR / f"{doc_id}.json").write_text(json.dumps(d, ensure_ascii=False, indent=1) + "\n")
        print(f"wrote data/world/{doc_id}.json")
    out = rebuild()
    print(f"OK: {out['count']} issues, latest {out['latest']}")


if __name__ == "__main__":
    main()
