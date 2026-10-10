#!/usr/bin/env python3
"""Bülten sitesine yeni bir yayın ekler ve arşiv dizinini (data/index.json) yeniden üretir.

Kullanım:
    python3 scripts/publish.py veri.json --type flas            # saat/tarih: şu an (New York)
    python3 scripts/publish.py veri.json --type aksam --date 2026-10-10 --time 18:57
    python3 scripts/publish.py veri.json --type flas --check    # sadece doğrula, yazma
    python3 scripts/publish.py --rebuild                        # yalnızca index.json'u yeniden üret

veri.json, PDF betiğinin (bulten_pdf.py) kullandığı yapının aynısıdır:
    {"title", "subtitle", "markets": [{"name","level","chg","note"}], "market_note",
     "sections": [{"heading","items": [{"title","text"}]}], "sources": [{"title","url"}], "footer"}

Yalnızca Python standart kütüphanesini kullanır.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/New_York")
TYPES = ("flas", "aksam")
ROOT = Path(__file__).resolve().parent.parent
MAX_HEADLINES = 12


class ValidationError(Exception):
    """veri.json beklenen yapıda değil."""


# ---------------------------------------------------------------- yardımcılar

def _str(v, path, *, required=False, allow_empty=True):
    if v is None:
        if required:
            raise ValidationError(f"{path}: zorunlu alan eksik")
        return ""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        v = str(v)
    if not isinstance(v, str):
        raise ValidationError(f"{path}: metin olmalı, {type(v).__name__} geldi")
    v = v.strip()
    if required and not allow_empty and not v:
        raise ValidationError(f"{path}: boş olamaz")
    return v


def _list(v, path):
    if v is None:
        return []
    if not isinstance(v, list):
        raise ValidationError(f"{path}: liste olmalı")
    return v


def _dict(v, path):
    if not isinstance(v, dict):
        raise ValidationError(f"{path}: nesne (JSON object) olmalı")
    return v


def _is_http_url(u: str) -> bool:
    try:
        p = urlparse(u)
    except ValueError:
        return False
    return p.scheme in ("http", "https") and bool(p.netloc)


# ---------------------------------------------------------------- doğrulama

def normalize(raw) -> dict:
    """veri.json içeriğini doğrular ve temizlenmiş bir sözlük döndürür."""
    d = _dict(raw, "kök")
    out = {
        "title": _str(d.get("title"), "title", required=True, allow_empty=False),
        "subtitle": _str(d.get("subtitle"), "subtitle"),
        "markets": [],
        "market_note": _str(d.get("market_note"), "market_note"),
        "sections": [],
        "sources": [],
        "footer": _str(d.get("footer"), "footer"),
    }

    for i, m in enumerate(_list(d.get("markets"), "markets")):
        p = f"markets[{i}]"
        m = _dict(m, p)
        name = _str(m.get("name"), f"{p}.name", required=True, allow_empty=False)
        out["markets"].append({
            "name": name,
            "level": _str(m.get("level"), f"{p}.level") or "—",
            "chg": _str(m.get("chg"), f"{p}.chg") or "—",
            "note": _str(m.get("note"), f"{p}.note"),
        })

    for i, s in enumerate(_list(d.get("sections"), "sections")):
        p = f"sections[{i}]"
        s = _dict(s, p)
        heading = _str(s.get("heading"), f"{p}.heading", required=True, allow_empty=False)
        items = []
        for j, it in enumerate(_list(s.get("items"), f"{p}.items")):
            q = f"{p}.items[{j}]"
            if isinstance(it, str):  # düz metin madde de kabul edilir
                it = {"text": it}
            it = _dict(it, q)
            title = _str(it.get("title"), f"{q}.title")
            text = _str(it.get("text"), f"{q}.text")
            if not title and not text:
                continue
            items.append({"title": title, "text": text})
        if items:  # boş bölüm yayımlanmaz
            out["sections"].append({"heading": heading, "items": items})

    for i, s in enumerate(_list(d.get("sources"), "sources")):
        p = f"sources[{i}]"
        s = _dict(s, p)
        url = _str(s.get("url"), f"{p}.url", required=True, allow_empty=False)
        if not _is_http_url(url):
            raise ValidationError(f"{p}.url: http(s) bağlantısı olmalı: {url!r}")
        out["sources"].append({"title": _str(s.get("title"), f"{p}.title") or urlparse(url).netloc, "url": url})

    if not out["markets"] and not out["sections"]:
        raise ValidationError("yayında ne piyasa verisi ne de haber bölümü var")
    return out


def parse_date(s: str) -> str:
    try:
        return datetime.strptime(s, "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError:
        raise ValidationError(f"--date YYYY-AA-GG biçiminde olmalı: {s!r}") from None


def parse_time(s: str) -> str:
    m = re.fullmatch(r"(\d{1,2})[:.]?(\d{2})", s.strip())
    if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
        raise ValidationError(f"--time SS:DD biçiminde olmalı: {s!r}")
    return f"{int(m.group(1)):02d}:{m.group(2)}"


# ---------------------------------------------------------------- dosyalar

def _atomic_write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=1)
            f.write("\n")
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def issue_path(root: Path, date: str, issue_id: str) -> Path:
    return root / "data" / "issues" / date / f"{issue_id}.json"


def write_issue(root: Path, content: dict, kind: str, date: str, time: str, now: datetime | None = None) -> tuple[Path, bool]:
    """Yayını yazar. (yol, üzerine_yazıldı_mı) döndürür."""
    if kind not in TYPES:
        raise ValidationError(f"--type şunlardan biri olmalı: {', '.join(TYPES)}")
    issue_id = f"{kind}-{time.replace(':', '')}"
    path = issue_path(root, date, issue_id)
    existed = path.exists()
    now = now or datetime.now(timezone.utc)
    doc = {
        "id": issue_id,
        "type": kind,
        "date": date,
        "time": time,
        "published_at": now.astimezone(timezone.utc).isoformat(timespec="seconds"),
        **content,
    }
    _atomic_write_json(path, doc)
    return path, existed


def _entry(doc: dict, rel: str) -> dict:
    headlines = []
    for sec in doc.get("sections", []):
        for it in sec.get("items", []):
            h = it.get("title") or (it.get("text") or "")[:90]
            if h:
                headlines.append(h)
    return {
        "id": doc["id"],
        "type": doc["type"],
        "date": doc["date"],
        "time": doc["time"],
        "title": doc.get("title", ""),
        "subtitle": doc.get("subtitle", ""),
        "headlines": headlines[:MAX_HEADLINES],
        "published_at": doc.get("published_at", ""),
        "path": rel,
    }


def rebuild_index(root: Path, now: datetime | None = None) -> dict:
    """data/issues altındaki tüm yayınları tarayıp data/index.json'u yeniden yazar."""
    base = root / "data" / "issues"
    entries, problems = [], []
    if base.exists():
        for p in sorted(base.glob("*/*.json")):
            try:
                doc = json.loads(p.read_text(encoding="utf-8"))
                if doc.get("type") not in TYPES or not doc.get("id") or not doc.get("date") or not doc.get("time"):
                    raise ValueError("id/type/date/time eksik")
                if p.parent.name != doc["date"] or p.stem != doc["id"]:
                    raise ValueError("dosya adı içerikle uyuşmuyor")
                entries.append(_entry(doc, p.relative_to(root).as_posix()))
            except (ValueError, json.JSONDecodeError) as e:
                problems.append(f"{p.relative_to(root)}: {e}")
    entries.sort(key=lambda e: (e["date"], e["time"]), reverse=True)
    now = now or datetime.now(timezone.utc)
    index = {
        "version": 1,
        "generated_at": now.astimezone(timezone.utc).isoformat(timespec="seconds"),
        "count": len(entries),
        "latest": entries[0]["date"] + "/" + entries[0]["id"] if entries else None,
        "entries": entries,
    }
    _atomic_write_json(root / "data" / "index.json", index)
    for msg in problems:
        print(f"UYARI: atlandı -> {msg}", file=sys.stderr)
    return index


# ---------------------------------------------------------------- komut satırı

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Bülten sitesine yayın ekle")
    ap.add_argument("veri", nargs="?", help="veri.json yolu")
    ap.add_argument("--type", choices=TYPES, help="flas | aksam")
    ap.add_argument("--date", help="YYYY-AA-GG (varsayılan: bugün, New York)")
    ap.add_argument("--time", help="SS:DD (varsayılan: şimdi, New York)")
    ap.add_argument("--root", default=str(ROOT), help="repo kök dizini")
    ap.add_argument("--check", action="store_true", help="yalnızca doğrula")
    ap.add_argument("--rebuild", action="store_true", help="yalnızca index.json'u yeniden üret")
    a = ap.parse_args(argv)
    root = Path(a.root).resolve()

    if a.rebuild:
        idx = rebuild_index(root)
        print(f"OK: index.json yeniden üretildi ({idx['count']} yayın)")
        return 0

    if not a.veri or not a.type:
        ap.error("veri.json yolu ve --type gerekli (ya da --rebuild)")

    try:
        try:
            raw = json.loads(Path(a.veri).read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise ValidationError(f"dosya bulunamadı: {a.veri}") from None
        except json.JSONDecodeError as e:
            raise ValidationError(f"geçersiz JSON ({a.veri}): satır {e.lineno}, sütun {e.colno}: {e.msg}") from None
        content = normalize(raw)
        now_ny = datetime.now(TZ)
        date = parse_date(a.date) if a.date else now_ny.strftime("%Y-%m-%d")
        time = parse_time(a.time) if a.time else now_ny.strftime("%H:%M")
    except ValidationError as e:
        print(f"HATA: {e}", file=sys.stderr)
        return 2

    if a.check:
        n = sum(len(s["items"]) for s in content["sections"])
        print(f"OK: geçerli ({len(content['markets'])} piyasa satırı, {len(content['sections'])} bölüm, {n} madde)")
        return 0

    path, existed = write_issue(root, content, a.type, date, time)
    idx = rebuild_index(root)
    print(f"OK: {'güncellendi' if existed else 'eklendi'} -> {path.relative_to(root).as_posix()} (toplam {idx['count']} yayın)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
