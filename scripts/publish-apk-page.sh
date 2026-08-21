#!/usr/bin/env bash
# Regenerate the APK download page from the APK files themselves.
#
# The dates on this page used to be typed by hand, which meant they were right on the day
# they were written and quietly wrong afterwards -- and a stale "last updated" is worse
# than none, because it tells a user who is chasing a bug that they already have the
# newest build. Everything here is read from the files on disk, so the page cannot
# disagree with what it is serving.
#
# Run after publishing new APKs:  sudo -u its bash scripts/publish-apk-page.sh
set -euo pipefail

APK_DIR="${APK_DIR:-/srv/clients/monhorus/apk}"
TZ_NAME="${TZ_NAME:-Asia/Ulaanbaatar}"
BASE_URL="${BASE_URL:-https://monhorus.itsystem.mn}"

cd "$APK_DIR"

for f in monhorus-employee.apk monhorus-customer.apk; do
  [ -f "$f" ] || { echo "missing $f in $APK_DIR" >&2; exit 1; }
done

# Human-readable size to one decimal, from the real byte count.
size_of() { awk -v b="$(stat -c %s "$1")" 'BEGIN{ printf "%.1f MB", b/1048576 }'; }
# Build time in the operator's timezone, not UTC -- the reader is in Ulaanbaatar.
time_of() { TZ="$TZ_NAME" date -d "@$(stat -c %Y "$1")" '+%Y-%m-%d %H:%M'; }
hash_of() { sha256sum "$1" | cut -c1-12; }

EMP_SIZE=$(size_of monhorus-employee.apk); EMP_TIME=$(time_of monhorus-employee.apk); EMP_HASH=$(hash_of monhorus-employee.apk)
CUS_SIZE=$(size_of monhorus-customer.apk); CUS_TIME=$(time_of monhorus-customer.apk); CUS_HASH=$(hash_of monhorus-customer.apk)

# The page's own "last updated" is the newer of the two APKs, never the moment this script
# ran -- rerunning the generator must not make an unchanged build look fresh.
NEWEST=$(stat -c %Y monhorus-employee.apk monhorus-customer.apk | sort -n | tail -1)
PAGE_TIME=$(TZ="$TZ_NAME" date -d "@$NEWEST" '+%Y-%m-%d %H:%M')

cat > index.html.new <<HTML
<!doctype html>
<html lang="mn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Монхорус — Android апп</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         margin: 0; padding: 2rem 1.25rem 3rem; line-height: 1.6;
         background: #f6f7f9; color: #16181d; }
  @media (prefers-color-scheme: dark) { body { background: #14161a; color: #e8eaed; } }
  main { max-width: 34rem; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
  .sub { opacity: .7; margin: 0 0 1.25rem; font-size: .95rem; }
  .updated { display: inline-block; font-size: .82rem; background: #e8f0fe; color: #1a4fa0;
             border: 1px solid #c5d9f7; border-radius: 999px; padding: .3rem .85rem;
             margin-bottom: 1.75rem; font-variant-numeric: tabular-nums; }
  @media (prefers-color-scheme: dark) { .updated { background: #16233d; color: #9dc0f5; border-color: #2c4470; } }
  .card { background: #fff; border: 1px solid #e3e6ea; border-radius: 12px;
          padding: 1.15rem 1.25rem; margin-bottom: 1rem; }
  @media (prefers-color-scheme: dark) { .card { background: #1c1f24; border-color: #2c3037; } }
  .card h2 { font-size: 1.05rem; margin: 0 0 .3rem; }
  .card p { margin: 0 0 1rem; font-size: .9rem; opacity: .8; }
  a.dl { display: inline-block; background: #2563eb; color: #fff; text-decoration: none;
         padding: .65rem 1.15rem; border-radius: 8px; font-weight: 600; font-size: .95rem; }
  a.dl:hover { background: #1d4ed8; }
  .meta { margin-top: .8rem; font-size: .78rem; opacity: .6; font-variant-numeric: tabular-nums; }
  .meta b { font-weight: 600; opacity: .9; }
  ol { font-size: .87rem; opacity: .85; padding-left: 1.2rem; margin: .5rem 0 0; }
  ol li { margin-bottom: .35rem; }
  .note { font-size: .85rem; opacity: .75; border-top: 1px solid #e3e6ea;
          padding-top: 1rem; margin-top: 1.5rem; }
  @media (prefers-color-scheme: dark) { .note { border-color: #2c3037; } }
  code { background: rgba(127,127,127,.16); padding: .1rem .35rem; border-radius: 4px;
         font-size: .85em; }
</style>
</head>
<body>
<main>
  <h1>Монхорус — Android апп</h1>
  <p class="sub">Цахилгааны үйлчилгээний систем</p>

  <div class="updated">Сүүлд шинэчлэгдсэн: ${PAGE_TIME}</div>

  <div class="card">
    <h2>Ажилтны апп</h2>
    <p>Талбарын инженер, техникчдэд зориулав.</p>
    <a class="dl" href="monhorus-employee.apk">Татаж авах</a>
    <div class="meta">
      <b>${EMP_TIME}</b> · ${EMP_SIZE} · Android 7.0+<br>
      шалгах код: <code>${EMP_HASH}</code>
    </div>
  </div>

  <div class="card">
    <h2>Харилцагчийн апп</h2>
    <p>Үйлчлүүлэгчдэд зориулав.</p>
    <a class="dl" href="monhorus-customer.apk">Татаж авах</a>
    <div class="meta">
      <b>${CUS_TIME}</b> · ${CUS_SIZE} · Android 7.0+<br>
      шалгах код: <code>${CUS_HASH}</code>
    </div>
  </div>

  <div class="card">
    <h2>Хэрхэн суулгах вэ</h2>
    <ol>
      <li>Дээрх товчийг дарж APK файлыг татаж авна.</li>
      <li>Татсан файлаа нээхэд <em>«Тодорхойгүй эх сурвалж»</em> сануулга гарвал
          зөвшөөрөл олгоно.</li>
      <li>«Суулгах» дарж, дуусмагц апп-аа нээнэ.</li>
      <li>Танд өгсөн нэвтрэх нэр, нууц үгээр нэвтэрнэ.</li>
    </ol>
    <p class="note" style="border:0;padding:0;margin-top:.9rem">
      Аппаа шинэчлэхэд <b>хуучныг устгах шаардлагагүй</b> — дээрээс нь шууд суулгахад
      төхөөрөмж дээрх мэдээлэл хэвээр үлдэнэ.
    </p>
  </div>

  <p class="note">
    Апп нь <code>monhorus.itsystem.mn</code> сервертэй HTTPS-ээр холбогдоно.<br>
    Вэб хувилбар: <a href="${BASE_URL}">monhorus.itsystem.mn</a>
  </p>
</main>
</body>
</html>
HTML

chmod a+r index.html.new
mv -f index.html.new index.html

echo "APK page regenerated"
echo "  page updated : $PAGE_TIME"
echo "  employee     : $EMP_TIME  $EMP_SIZE  $EMP_HASH"
echo "  customer     : $CUS_TIME  $CUS_SIZE  $CUS_HASH"
