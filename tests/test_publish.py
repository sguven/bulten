"""scripts/publish.py için testler.  Çalıştır: python3 -m pytest -q tests"""
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures"
sys.path.insert(0, str(ROOT / "scripts"))
import publish  # noqa: E402


def fixture(name):
    return json.loads((FIX / name).read_text(encoding="utf-8"))


def run_cli(*args, cwd=None):
    return subprocess.run([sys.executable, str(ROOT / "scripts" / "publish.py"), *args],
                          capture_output=True, text=True, cwd=cwd)


@pytest.fixture
def site(tmp_path):
    (tmp_path / "data").mkdir()
    return tmp_path


# ------------------------------------------------------------ normalize()

class TestNormalize:
    def test_full_fixture_roundtrip(self):
        d = publish.normalize(fixture("aksam.json"))
        assert d["title"].startswith("Akşam Bülteni")
        assert len(d["markets"]) == 9
        assert [s["heading"] for s in d["sections"]][0] == "Dünya — bilmen gerekenler"
        assert d["sources"][2]["url"] == "https://www.secaucusnj.gov/"

    def test_turkish_characters_preserved(self):
        d = publish.normalize({"title": "Çığ öğüş İı Şş", "sections": [{"heading": "Ğ", "items": [{"text": "ü"}]}]})
        assert d["title"] == "Çığ öğüş İı Şş"

    def test_title_required(self):
        with pytest.raises(publish.ValidationError, match="title"):
            publish.normalize({"sections": [{"heading": "a", "items": [{"text": "b"}]}]})

    def test_blank_title_rejected(self):
        with pytest.raises(publish.ValidationError, match="title: boş"):
            publish.normalize({"title": "   ", "markets": [{"name": "x"}]})

    def test_root_must_be_object(self):
        with pytest.raises(publish.ValidationError, match="kök"):
            publish.normalize([1, 2])

    def test_empty_content_rejected(self):
        with pytest.raises(publish.ValidationError, match="ne piyasa"):
            publish.normalize({"title": "x", "sections": [{"heading": "a", "items": []}]})

    def test_empty_sections_dropped(self):
        d = publish.normalize(fixture("minimal.json"))
        assert [s["heading"] for s in d["sections"]] == ["Dünya — bilmen gerekenler"]

    def test_blank_items_dropped(self):
        d = publish.normalize({"title": "x", "sections": [{"heading": "h", "items": [{"title": " ", "text": ""}, {"text": "ok"}]}]})
        assert d["sections"][0]["items"] == [{"title": "", "text": "ok"}]

    def test_string_items_accepted(self):
        d = publish.normalize({"title": "x", "sections": [{"heading": "h", "items": ["düz madde"]}]})
        assert d["sections"][0]["items"][0] == {"title": "", "text": "düz madde"}

    def test_numbers_coerced_to_strings(self):
        d = publish.normalize({"title": "x", "markets": [{"name": "BTC", "level": 121430, "chg": 2.3}]})
        assert d["markets"][0]["level"] == "121430"
        assert d["markets"][0]["chg"] == "2.3"

    def test_missing_market_values_become_dash(self):
        d = publish.normalize({"title": "x", "markets": [{"name": "Brent"}]})
        assert d["markets"][0] == {"name": "Brent", "level": "—", "chg": "—", "note": ""}

    def test_market_name_required(self):
        with pytest.raises(publish.ValidationError, match=r"markets\[0\]\.name"):
            publish.normalize({"title": "x", "markets": [{"level": "1"}]})

    def test_wrong_types_reported_with_path(self):
        with pytest.raises(publish.ValidationError, match=r"sections\[0\]\.items: liste"):
            publish.normalize({"title": "x", "sections": [{"heading": "h", "items": "nope"}]})
        with pytest.raises(publish.ValidationError, match=r"markets\[0\]\.level: metin"):
            publish.normalize({"title": "x", "markets": [{"name": "a", "level": ["1"]}]})
        with pytest.raises(publish.ValidationError, match="markets: liste"):
            publish.normalize({"title": "x", "markets": {"name": "a"}})

    def test_bool_is_not_a_string(self):
        with pytest.raises(publish.ValidationError):
            publish.normalize({"title": True, "markets": [{"name": "a"}]})

    @pytest.mark.parametrize("url", ["javascript:alert(1)", "ftp://x.com/a", "www.reuters.com", "", "https://"])
    def test_bad_source_urls_rejected(self, url):
        with pytest.raises(publish.ValidationError, match="sources"):
            publish.normalize({"title": "x", "markets": [{"name": "a"}], "sources": [{"title": "t", "url": url}]})

    def test_source_title_defaults_to_host(self):
        d = publish.normalize({"title": "x", "markets": [{"name": "a"}], "sources": [{"url": "https://www.cnbc.com/x"}]})
        assert d["sources"][0]["title"] == "www.cnbc.com"

    def test_whitespace_trimmed(self):
        d = publish.normalize({"title": "  x  ", "markets": [{"name": " a ", "chg": " +1% "}]})
        assert d["title"] == "x" and d["markets"][0]["name"] == "a" and d["markets"][0]["chg"] == "+1%"

    def test_unknown_fields_ignored(self):
        d = publish.normalize({"title": "x", "markets": [{"name": "a"}], "evil": "<script>"})
        assert "evil" not in d


# ------------------------------------------------------------ tarih/saat

class TestDateTime:
    @pytest.mark.parametrize("raw,exp", [("12:45", "12:45"), ("8:45", "08:45"), ("1857", "18:57"), ("18.57", "18:57"), ("00:00", "00:00")])
    def test_parse_time_ok(self, raw, exp):
        assert publish.parse_time(raw) == exp

    @pytest.mark.parametrize("raw", ["24:00", "12:60", "noon", "1:2", ""])
    def test_parse_time_bad(self, raw):
        with pytest.raises(publish.ValidationError):
            publish.parse_time(raw)

    def test_parse_date(self):
        assert publish.parse_date("2026-10-08") == "2026-10-08"
        for bad in ["2026-13-01", "08/10/2026", "2026-02-30"]:
            with pytest.raises(publish.ValidationError):
                publish.parse_date(bad)


# ------------------------------------------------------------ yazma ve dizin

class TestWriteAndIndex:
    def test_write_issue_layout_and_metadata(self, site):
        now = datetime(2026, 10, 8, 16, 47, tzinfo=timezone.utc)
        content = publish.normalize(fixture("flas_ogle.json"))
        path, existed = publish.write_issue(site, content, "flas", "2026-10-08", "12:47", now=now)
        assert not existed
        assert path == site / "data/issues/2026-10-08/flas-1247.json"
        doc = json.loads(path.read_text(encoding="utf-8"))
        assert doc["id"] == "flas-1247" and doc["type"] == "flas"
        assert doc["date"] == "2026-10-08" and doc["time"] == "12:47"
        assert doc["published_at"] == "2026-10-08T16:47:00+00:00"
        assert doc["sections"] == content["sections"]
        assert "Güncelleme" in path.read_text(encoding="utf-8")  # ensure_ascii=False

    def test_rerun_overwrites_same_slot(self, site):
        c = publish.normalize(fixture("flas_ogle.json"))
        publish.write_issue(site, c, "flas", "2026-10-08", "12:47")
        c2 = dict(c, subtitle="düzeltilmiş")
        _, existed = publish.write_issue(site, c2, "flas", "2026-10-08", "12:47")
        assert existed
        idx = publish.rebuild_index(site)
        assert idx["count"] == 1 and idx["entries"][0]["subtitle"] == "düzeltilmiş"

    def test_bad_type_rejected(self, site):
        with pytest.raises(publish.ValidationError):
            publish.write_issue(site, {"title": "x"}, "sabah", "2026-10-08", "08:45")

    def test_index_sorted_newest_first_across_days(self, site):
        for name, kind, date, time in [
            ("flas_sabah.json", "flas", "2026-10-08", "08:47"),
            ("aksam.json", "aksam", "2026-10-07", "19:06"),
            ("flas_kapanis.json", "flas", "2026-10-08", "15:49"),
            ("aksam.json", "aksam", "2026-10-08", "19:08"),
            ("flas_ogle.json", "flas", "2026-10-08", "12:46"),
        ]:
            publish.write_issue(site, publish.normalize(fixture(name)), kind, date, time)
        idx = publish.rebuild_index(site)
        order = [(e["date"], e["time"]) for e in idx["entries"]]
        assert order == [("2026-10-08", "19:08"), ("2026-10-08", "15:49"), ("2026-10-08", "12:46"),
                         ("2026-10-08", "08:47"), ("2026-10-07", "19:06")]
        assert idx["latest"] == "2026-10-08/aksam-1908"
        assert idx["count"] == 5 and idx["version"] == 1

    def test_index_entry_fields(self, site):
        publish.write_issue(site, publish.normalize(fixture("aksam.json")), "aksam", "2026-10-08", "19:08")
        e = publish.rebuild_index(site)["entries"][0]
        assert set(e) == {"id", "type", "date", "time", "title", "subtitle", "headlines", "published_at", "path"}
        assert e["path"] == "data/issues/2026-10-08/aksam-1908.json"
        assert (site / e["path"]).exists()
        assert e["headlines"][:3] == ["Fed'den güvercin sinyal", "Petrolde arz endişesi", "Konut kredisi faizleri"]

    def test_headline_falls_back_to_text_and_is_capped(self, site):
        items = [{"text": "x" * 200}] + [{"title": f"b{i}"} for i in range(20)]
        c = publish.normalize({"title": "t", "sections": [{"heading": "h", "items": items}]})
        publish.write_issue(site, c, "aksam", "2026-10-08", "19:00")
        e = publish.rebuild_index(site)["entries"][0]
        assert e["headlines"][0] == "x" * 90
        assert len(e["headlines"]) == publish.MAX_HEADLINES

    def test_empty_site_index(self, site):
        idx = publish.rebuild_index(site)
        assert idx["count"] == 0 and idx["latest"] is None and idx["entries"] == []
        assert json.loads((site / "data/index.json").read_text())["count"] == 0

    def test_corrupt_files_skipped_not_fatal(self, site, capsys):
        publish.write_issue(site, publish.normalize(fixture("aksam.json")), "aksam", "2026-10-08", "19:08")
        bad = site / "data/issues/2026-10-08/flas-0845.json"
        bad.write_text("{bozuk", encoding="utf-8")
        mismatch = site / "data/issues/2026-10-09/flas-0845.json"
        mismatch.parent.mkdir(parents=True)
        mismatch.write_text(json.dumps({"id": "flas-0845", "type": "flas", "date": "2026-10-01", "time": "08:45"}), encoding="utf-8")
        idx = publish.rebuild_index(site)
        assert idx["count"] == 1
        err = capsys.readouterr().err
        assert "flas-0845.json" in err and "uyuşmuyor" in err

    def test_no_temp_files_left(self, site):
        publish.write_issue(site, publish.normalize(fixture("aksam.json")), "aksam", "2026-10-08", "19:08")
        publish.rebuild_index(site)
        assert not list(site.rglob(".tmp-*"))


# ------------------------------------------------------------ komut satırı

class TestCli:
    def test_publish_end_to_end(self, site):
        r = run_cli(str(FIX / "flas_kapanis.json"), "--type", "flas", "--date", "2026-10-08", "--time", "15:49", "--root", str(site))
        assert r.returncode == 0, r.stderr
        assert "eklendi -> data/issues/2026-10-08/flas-1549.json" in r.stdout
        idx = json.loads((site / "data/index.json").read_text(encoding="utf-8"))
        assert idx["latest"] == "2026-10-08/flas-1549"
        r2 = run_cli(str(FIX / "flas_kapanis.json"), "--type", "flas", "--date", "2026-10-08", "--time", "15:49", "--root", str(site))
        assert "güncellendi" in r2.stdout

    def test_default_date_time_is_new_york_now(self, site):
        before = datetime.now(publish.TZ)
        r = run_cli(str(FIX / "aksam.json"), "--type", "aksam", "--root", str(site))
        assert r.returncode == 0, r.stderr
        e = json.loads((site / "data/index.json").read_text())["entries"][0]
        assert e["date"] == before.strftime("%Y-%m-%d") or e["date"] == datetime.now(publish.TZ).strftime("%Y-%m-%d")
        assert abs(int(e["time"][:2]) * 60 + int(e["time"][3:]) - (before.hour * 60 + before.minute)) <= 1

    def test_check_mode_writes_nothing(self, site):
        r = run_cli(str(FIX / "aksam.json"), "--type", "aksam", "--check", "--root", str(site))
        assert r.returncode == 0 and "geçerli" in r.stdout
        assert not (site / "data/index.json").exists()

    def test_invalid_json_exit_code_and_message(self, site, tmp_path):
        bad = tmp_path / "bad.json"
        bad.write_text('{"title": "x",}', encoding="utf-8")
        r = run_cli(str(bad), "--type", "flas", "--root", str(site))
        assert r.returncode == 2 and "geçersiz JSON" in r.stderr and "satır 1" in r.stderr
        assert not (site / "data/issues").exists()

    def test_missing_file(self, site):
        r = run_cli("/yok/veri.json", "--type", "flas", "--root", str(site))
        assert r.returncode == 2 and "bulunamadı" in r.stderr

    def test_validation_error_nothing_written(self, site, tmp_path):
        bad = tmp_path / "v.json"
        bad.write_text(json.dumps({"title": "x", "markets": [{"name": "a"}], "sources": [{"url": "javascript:1"}]}), encoding="utf-8")
        r = run_cli(str(bad), "--type", "flas", "--root", str(site))
        assert r.returncode == 2 and "sources[0].url" in r.stderr
        assert not (site / "data/issues").exists()

    def test_bad_time_flag(self, site):
        r = run_cli(str(FIX / "aksam.json"), "--type", "aksam", "--time", "25:00", "--root", str(site))
        assert r.returncode == 2 and "--time" in r.stderr

    def test_type_required(self, site):
        r = run_cli(str(FIX / "aksam.json"), "--root", str(site))
        assert r.returncode != 0

    def test_rebuild(self, site):
        run_cli(str(FIX / "aksam.json"), "--type", "aksam", "--date", "2026-10-08", "--time", "19:08", "--root", str(site))
        (site / "data/index.json").unlink()
        r = run_cli("--rebuild", "--root", str(site))
        assert r.returncode == 0 and "1 yayın" in r.stdout
        assert (site / "data/index.json").exists()

    def test_repo_data_is_consistent(self, tmp_path):
        """Repodaki gerçek data/ klasörü, yeniden üretilen dizinle aynı yayınları içermeli."""
        shutil.copytree(ROOT / "data", tmp_path / "data")
        committed = json.loads((ROOT / "data/index.json").read_text(encoding="utf-8"))
        rebuilt = publish.rebuild_index(tmp_path)
        strip = lambda es: [{k: v for k, v in e.items()} for e in es]
        assert strip(committed["entries"]) == strip(rebuilt["entries"])
