#!/usr/bin/env python3
"""Claude sayfasını (Artifact) tek bir HTML dosyası olarak derler.

  python3 scripts/build_artifact.py            -> dist/gundem.html (yayımlanacak dosya)

assets/lib.js + assets/app.js tek bir <script type="module"> içinde birleştirilir,
assets/style.css satır içine alınır. Yazı tipleri Google Fonts'tan gelir (Claude
sayfalarında izin verilen tek yazı tipi kaynağı).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

FONTS = ("https://fonts.googleapis.com/css2?family=Archivo:wght@400..700"
         "&family=Newsreader:opsz,wght@6..72,500..700&display=swap")

MARKUP = """<a class="skip" href="#main">İçeriğe geç</a>
<header class="masthead">
  <div class="masthead__inner">
    <a class="brand" href="#bugun" aria-label="Gündem, bugünün yayınları">Gündem</a>
    <nav class="tabs" aria-label="Bölümler">
      <a class="tab" href="#bugun" data-tab="today">Bugün</a>
      <a class="tab" href="#arsiv" data-tab="archive">Arşiv</a>
    </nav>
  </div>
</header>
<main id="main" class="page" tabindex="-1" aria-live="polite">
  <p class="loading">Yükleniyor…</p>
</main>
<div class="toast" id="toast" role="status" hidden>
  <span class="toast__text"></span>
  <a class="toast__action" href="#bugun">Göster</a>
  <button class="toast__close" type="button" aria-label="Kapat">
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
  </button>
</div>"""


def bundle_js() -> str:
    lib = (ROOT / "assets" / "lib.js").read_text(encoding="utf-8")
    app = (ROOT / "assets" / "app.js").read_text(encoding="utf-8")
    lib = re.sub(r"^export\s+", "", lib, flags=re.M)
    app = re.sub(r"^import\s*\{[^}]*\}\s*from\s*'\./lib\.js';\s*", "", app, flags=re.S)
    if "export " in app.split("\n", 1)[0] or re.search(r"^\s*import\s", app, flags=re.M):
        sys.exit("HATA: app.js içinde birleştirilemeyen import kaldı")
    js = "// lib.js\n" + lib + "\n// app.js\n" + app
    return js.replace("</script", "<\\/script")


def build() -> str:
    css = (ROOT / "assets" / "style.css").read_text(encoding="utf-8")
    return (
        "<title>Gündem</title>\n"
        '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
        f'<link rel="stylesheet" href="{FONTS}">\n'
        f"<style>\n{css}\n</style>\n"
        f"{MARKUP}\n"
        f'<script type="module">\n{bundle_js()}\n</script>\n'
    )


def main() -> int:
    DIST.mkdir(exist_ok=True)
    out = DIST / "gundem.html"
    out.write_text(build(), encoding="utf-8")
    print(f"OK: {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
