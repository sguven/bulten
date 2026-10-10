# Gündem

Akşam Bülteni ve Gün İçi Flaş'ların yayımlandığı site. Zamanlanmış görevler her çalıştığında yeni yayını buraya ekler; site kendiliğinden güncellenir.

- **Bugün** — günün yayınları bir güzergâh gibi duraklarla: 08:45 açılış öncesi, 12:45 öğle, 15:45 kapanışa doğru, 18:57 akşam bülteni. Hazırlanmakta olan yayın kehribar renkte yanıp söner.
- **Arşiv** — gün gün tüm yayınlar; başlıklarda arama (Türkçe karakter duyarsız: "tutanaklari" → "tutanakları") ve Flaş / Akşam Bülteni filtresi.
- Açık sayfa her 5 dakikada bir yeni yayın olup olmadığına bakar ve bildirir.
- Telefona göre tasarlandı; koyu temayı sistemden alır. Ana ekrana eklenebilir.

## Nasıl çalışır

```
zamanlanmış görev ──> veri.json ──> scripts/publish_and_push.sh ──> git push ──> GitHub Pages
                                      │
                                      ├─ scripts/publish.py: doğrular, data/issues/<tarih>/<tür>-<SSDD>.json yazar
                                      └─ data/index.json'u (arşiv dizini) yeniden üretir
```

Site tamamen statiktir (derleme adımı yok): `index.html` + `assets/` + `data/`.

### Elle yayın eklemek

```bash
bash scripts/publish_and_push.sh veri.json flas                      # şimdi (New York saati)
bash scripts/publish_and_push.sh veri.json aksam 2026-10-10 18:57    # belirli tarih/saat
python3 scripts/publish.py veri.json --type flas --check             # yalnızca doğrula
python3 scripts/publish.py --rebuild                                 # dizini yeniden üret
```

`veri.json`, PDF betiğinin kullandığı yapıyla aynıdır:

```json
{
  "title": "Gün İçi Flaş · Cuma 9 Ekim · 12:45 ET",
  "subtitle": "Öğle · 08:45–12:45 arası",
  "markets": [{ "name": "S&P 500", "level": "6.712,40", "chg": "+0,42%", "note": "12:30 ET" }],
  "market_note": "<b>Ne hareket ettiriyor:</b> …",
  "sections": [{ "heading": "Son dakika", "items": [{ "title": "Kısa başlık", "text": "…" }] }],
  "sources": [{ "title": "Reuters", "url": "https://www.reuters.com/…" }],
  "footer": "…"
}
```

Metinlerde yalnızca `<b>`, `<strong>`, `<i>`, `<em>`, `<br>` işlenir; geri kalan her şey düz metin olarak gösterilir. Başlığı `(doğrulanmadı)` ile biten maddeler etiketle işaretlenir.

### Program

Bugün sayfasındaki beklenen duraklar `data/site.json` içindedir. Zamanlanmış görevlerin saatini değiştirirsen burayı da güncelle.

## Testler

```bash
npm ci && pip install pytest && npx playwright install chromium
npm test            # hepsi
npm run test:py     # yayınlama betikleri (doğrulama, dizin, git push ve çakışma çözümü)
npm run test:unit   # tarih/saat dilimi, arama, güvenlik, durak mantığı
npm run test:e2e    # gerçek tarayıcı: masaüstü + telefon, açık/koyu tema, erişilebilirlik (axe)
npm run serve       # http://localhost:8080
```

GitHub Actions her kod değişikliğinde tüm testleri, her yayından sonra da `data/` klasörünün tutarlılığını kontrol eder.

Yazı tipleri: Newsreader ve Archivo (SIL Open Font License), siteyle birlikte barındırılır.
