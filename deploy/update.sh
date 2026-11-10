#!/usr/bin/env bash
# يعمل كل دقيقة: عند وجود تحديث على GitHub يسحبه ويعيد بناء البرنامج مرة وحدة ويعيد تشغيل كل نسخ الاستوديوهات.
set -euo pipefail
SRC=/opt/studio-lite
BASE=/opt/studio-lite-data
cd "$SRC"
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && exit 0
git reset -q --hard origin/main
echo "$(date -Is) deploying $(git rev-parse --short HEAD)"
docker build -q -t studio-lite "$SRC" >/dev/null
for f in "$BASE"/instances/*.env; do
  [ -e "$f" ] || continue
  slug=$(basename "$f" .env)
  SKIP_BUILD=1 bash "$SRC/deploy/run.sh" "$slug" && echo "  restarted studio-$slug"
done
echo "$(date -Is) done"
