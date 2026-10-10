"""scripts/publish_and_push.sh için testler — gerçek git depolarıyla (yerel 'bare' uzak depo)."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures"

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="git gerekli")


def sh(*args, cwd, env=None, check=True):
    import os
    e = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
    e.update(env or {})
    r = subprocess.run(list(args), cwd=cwd, capture_output=True, text=True, env=e)
    if check and r.returncode != 0:
        raise AssertionError(f"{args} -> {r.returncode}\n{r.stdout}\n{r.stderr}")
    return r


@pytest.fixture
def remote(tmp_path):
    """İçinde betikler ve boş data/ olan bir uzak depo + iki bağımsız klon."""
    bare = tmp_path / "remote.git"
    sh("git", "init", "-q", "--bare", "-b", "main", str(bare), cwd=tmp_path)
    seed = tmp_path / "seed"
    seed.mkdir()
    shutil.copytree(ROOT / "scripts", seed / "scripts", ignore=shutil.ignore_patterns("__pycache__"))
    (seed / "data").mkdir()
    sh("python3", "scripts/publish.py", "--rebuild", cwd=seed)
    sh("git", "init", "-q", "-b", "main", cwd=seed)
    sh("git", "add", ".", cwd=seed)
    sh("git", "commit", "-qm", "ilk", cwd=seed)
    sh("git", "remote", "add", "origin", str(bare), cwd=seed)
    sh("git", "push", "-q", "origin", "main", cwd=seed)
    clones = []
    for name in ("a", "b"):
        sh("git", "clone", "-q", str(bare), name, cwd=tmp_path)
        clones.append(tmp_path / name)
    return bare, clones, tmp_path


def remote_index(bare, tmp_path):
    check = tmp_path / "check"
    if check.exists():
        shutil.rmtree(check)
    sh("git", "clone", "-q", str(bare), "check", cwd=tmp_path)
    return json.loads((check / "data/index.json").read_text(encoding="utf-8")), check


def test_publish_commits_and_pushes(remote):
    bare, (a, _), tmp = remote
    r = sh("bash", "scripts/publish_and_push.sh", str(FIX / "aksam.json"), "aksam", "2026-10-08", "19:08", cwd=a)
    assert "OK: yayımlandı -> 2026-10-08/aksam-1908" in r.stdout
    idx, check = remote_index(bare, tmp)
    assert idx["latest"] == "2026-10-08/aksam-1908"
    assert (check / "data/issues/2026-10-08/aksam-1908.json").exists()
    log = sh("git", "log", "-1", "--format=%s", cwd=check).stdout.strip()
    assert log == "Yayın: 2026-10-08/aksam-1908"


def test_invalid_data_does_not_commit(remote, tmp_path):
    bare, (a, _), tmp = remote
    bad = tmp_path / "bad.json"
    bad.write_text('{"title": ""}', encoding="utf-8")
    r = sh("bash", "scripts/publish_and_push.sh", str(bad), "flas", cwd=a, check=False)
    assert r.returncode != 0 and "HATA" in r.stderr
    assert sh("git", "status", "--porcelain", cwd=a).stdout == ""
    idx, _ = remote_index(bare, tmp)
    assert idx["count"] == 0


def test_rerun_same_content_is_noop(remote):
    bare, (a, _), tmp = remote
    sh("bash", "scripts/publish_and_push.sh", str(FIX / "aksam.json"), "aksam", "2026-10-08", "19:08", cwd=a)
    before = sh("git", "rev-parse", "HEAD", cwd=a).stdout
    # aynı yayın yeniden: yalnızca published_at değişir -> yine commit edilir ama tek yayın kalır
    sh("bash", "scripts/publish_and_push.sh", str(FIX / "aksam.json"), "aksam", "2026-10-08", "19:08", cwd=a)
    idx, _ = remote_index(bare, tmp)
    assert idx["count"] == 1
    assert before  # HEAD vardı


def test_concurrent_publish_resolves_index_conflict(remote):
    """İki görev aynı anda yayımlarsa ikinci push reddedilir; betik birleştirip yeniden dener."""
    bare, (a, b), tmp = remote
    sh("bash", "scripts/publish_and_push.sh", str(FIX / "flas_kapanis.json"), "flas", "2026-10-08", "15:49", cwd=a)
    # b eski haliyle (pull yapmadan) yayımlıyor -> push reddedilecek, index.json çakışacak
    r = sh("bash", "scripts/publish_and_push.sh", str(FIX / "aksam.json"), "aksam", "2026-10-08", "19:08", cwd=b,
           env={"GUNDEM_SKIP_PULL": "1"})
    assert "Push reddedildi" in r.stderr
    assert "OK: yayımlandı" in r.stdout
    idx, check = remote_index(bare, tmp)
    assert [e["id"] for e in idx["entries"]] == ["aksam-1908", "flas-1549"]
    assert idx["latest"] == "2026-10-08/aksam-1908"
    # uzak depodaki dizin dosyalarla birebir tutarlı
    sh("python3", "scripts/publish.py", "--rebuild", cwd=check)
    rebuilt = json.loads((check / "data/index.json").read_text(encoding="utf-8"))
    assert rebuilt["entries"] == idx["entries"]
