#!/usr/bin/env bash
# يشغّل (أو يعيد تشغيل) نسخة استوديو واحدة من صورة studio-lite. البيانات تبقى مع كل تحديث.
#   bash deploy/run.sh <اسم-مختصر>      (بدون بناء: SKIP_BUILD=1)
set -euo pipefail
SLUG="${1:?}"
SRC=/opt/studio-lite
BASE=/opt/studio-lite-data
source "$BASE/instances/$SLUG.env"
DATA="$BASE/$SLUG"
mkdir -p "$DATA"
chown -R 1000:1000 "$DATA"
[ "${SKIP_BUILD:-0}" = 1 ] || docker build -q -t studio-lite "$SRC" >/dev/null
docker rm -f "studio-$SLUG" >/dev/null 2>&1 || true
docker run -d --name "studio-$SLUG" --restart unless-stopped --memory 256m --cpus 0.5 \
  -p "$PORT":3000 -v "$DATA":/data \
  -e STUDIO_NAME="$NAME" -e ADMIN_PASSWORD="$ADMIN_PASSWORD" -e SEED_STAFF="$STAFF" \
  studio-lite >/dev/null
docker network inspect web >/dev/null 2>&1 && docker network connect web "studio-$SLUG" 2>/dev/null || true
docker image prune -f >/dev/null 2>&1 || true
