#!/usr/bin/env bash
# Studio Lite — تركيب نسخة استوديو على السيرفر (Docker + Caddy + سحب تلقائي من GitHub)
# برنامج مستقل: له رابطه الخاص، بدون أي علاقة بمواقع ثانية على نفس السيرفر.
#
#   bash /opt/studio-lite/deploy/install.sh <اسم-مختصر> "<اسم الاستوديو>" ["موظفين"] [الرابط]
# مثال:
#   bash /opt/studio-lite/deploy/install.sh solo "Solo" "محمد:mohammad,احمد:ahmad,محمود:mahmoud"
#
# إذا ما حددت رابط: بياخد رابط مجاني تلقائي مثل  https://solo.1-2-3-4.sslip.io  (https شغال فوراً)
# ولما تشتري دومين للبرنامج، أعد التشغيل وحط الدومين كآخر وسيط.
set -euo pipefail
SLUG="${1:?اكتب اسم مختصر بالإنجليزي، مثل: solo}"
NAME="${2:-$SLUG}"
STAFF="${3:-}"
DOMAIN="${4:-}"
SRC=/opt/studio-lite
BASE=/opt/studio-lite-data
CONF="$BASE/instances/$SLUG.env"
KEY=/root/.ssh/studio_lite

[[ "$SLUG" =~ ^[a-z0-9-]{2,30}$ ]] || { echo "الاسم المختصر: أحرف إنجليزية صغيرة وأرقام فقط"; exit 1; }
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
[ -f "$KEY" ] && git -C "$SRC" config core.sshCommand "ssh -i $KEY -o StrictHostKeyChecking=accept-new"
mkdir -p "$BASE/instances"

IP=$(curl -4 -s --max-time 5 ifconfig.me || hostname -I | awk '{print $1}')
if [ -f "$CONF" ]; then
  # نسخة موجودة: نحافظ على منفذها وكلمة سرها، ونحدّث الرابط إذا انكتب جديد
  source "$CONF"; NEWDOMAIN="${4:-$DOMAIN}"; DOMAIN="$NEWDOMAIN"; FIRST=0
else
  FIRST=1
  # أول منفذ فاضي من 8100
  PORT=8100; while ss -ltn | grep -q ":$PORT " || grep -qs "^PORT=$PORT$" "$BASE"/instances/*.env; do PORT=$((PORT+1)); done
  ADMIN_PASSWORD="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 10)"
  [ -n "$DOMAIN" ] || DOMAIN="$SLUG.${IP//./-}.sslip.io"
fi
cat > "$CONF" <<EOF
SLUG=$SLUG
NAME="$NAME"
STAFF="$STAFF"
PORT=$PORT
DOMAIN=$DOMAIN
ADMIN_PASSWORD=$ADMIN_PASSWORD
EOF
chmod 600 "$CONF"

echo ">> بناء البرنامج وتشغيله…"
bash "$SRC/deploy/run.sh" "$SLUG"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow "$PORT"/tcp >/dev/null; fi

# الرابط عبر Caddy (https تلقائي)
DOMAIN_MSG="لم يُعثر على Caddy — البرنامج متاح على http://$IP:$PORT فقط"
if docker ps --format '{{.Names}}' | grep -qx caddy; then
  CF=$(docker inspect caddy --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')
  if [ -n "$CF" ]; then
    # نشيل أي بلوك قديم لهذه النسخة ونكتبه من جديد
    python3 - "$CF" "studio-$SLUG" <<'PY'
import re, sys
p, name = sys.argv[1], sys.argv[2]
s = open(p).read()
s = re.sub(r'\n# studio-lite:%s\n[^\n]*\{\n(?:[^\n]*\n)*?\}\n' % re.escape(name), '\n', s)
open(p, 'w').write(s)
PY
    printf '\n# studio-lite:%s\n%s {\n\tencode zstd gzip\n\treverse_proxy %s:3000\n}\n' "studio-$SLUG" "$DOMAIN" "studio-$SLUG" >> "$CF"
    docker exec caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 \
      && DOMAIN_MSG="https://$DOMAIN" \
      || DOMAIN_MSG="أُضيف الرابط لكن Caddy لم يُعد التحميل — شغّل: docker logs caddy"
  fi
fi

# سحب تلقائي من GitHub كل دقيقة (لكل النسخ مرة وحدة)
echo "* * * * * root flock -n /tmp/studio-lite.lock bash $SRC/deploy/update.sh >> /var/log/studio-lite-deploy.log 2>&1" > /etc/cron.d/studio-lite-deploy
chmod 644 /etc/cron.d/studio-lite-deploy

sleep 2
echo ""
echo "=============================================="
echo " ✅ $NAME يعمل"
echo " الرابط:          $DOMAIN_MSG"
echo " رابط مؤقت:       http://$IP:$PORT"
if [ "$FIRST" = 1 ]; then
echo " دخول المدير:     admin"
echo " كلمة المرور:     $ADMIN_PASSWORD   (احفظها، وغيّرها من الإعدادات ← حسابي)"
[ -n "$STAFF" ] && echo " الموظفين:        $STAFF   (كلمة المرور 1234)"
fi
echo " البيانات:        $BASE/$SLUG   (نسخة احتياطية يومية تلقائية)"
echo " التحديث من GitHub: تلقائي كل دقيقة"
echo "=============================================="
