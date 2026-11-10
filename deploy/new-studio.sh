#!/usr/bin/env bash
# إنشاء نسخة جديدة لاستوديو (كل استوديو له بياناته ومنفذه ورابطه الخاص)
# الاستخدام:  sudo bash deploy/new-studio.sh solo 3101 solo.alshaheed.ps "Solo" "محمد:mohammad,احمد:ahmad,محمود:mahmoud"
# (الوسيط الأخير اختياري: موظفين يُنشؤون تلقائياً بكلمة مرور 1234)
set -euo pipefail
SLUG="${1:?اسم مختصر للاستوديو بالإنجليزي مثل solo}"
PORT="${2:?رقم منفذ غير مستخدم مثل 3101}"
DOMAIN="${3:?الرابط مثل solo.alshaheed.ps}"
NAME="${4:-$SLUG}"
STAFF="${5:-}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="/var/lib/studio-lite/$SLUG"
ADMIN_PASS="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 10)"

mkdir -p "$DATA_DIR"

# تشغيل دائم عبر pm2
command -v pm2 >/dev/null || npm install -g pm2
PORT="$PORT" DATA_DIR="$DATA_DIR" STUDIO_NAME="$NAME" ADMIN_PASSWORD="$ADMIN_PASS" SEED_STAFF="$STAFF" \
  pm2 start "$APP_DIR/server.js" --name "studio-$SLUG" --update-env
pm2 save

# إعداد nginx
cat > "/etc/nginx/sites-available/studio-$SLUG" <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 25m;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
ln -sf "/etc/nginx/sites-available/studio-$SLUG" "/etc/nginx/sites-enabled/studio-$SLUG"
nginx -t && systemctl reload nginx

# شهادة https مجانية (يجب أن يكون الدومين موجهاً للسيرفر أولاً)
if command -v certbot >/dev/null; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m admin@"${DOMAIN#*.}" --redirect || echo "⚠️  لم تنجح الشهادة — تأكد أن $DOMAIN موجه لـ IP السيرفر ثم شغّل: certbot --nginx -d $DOMAIN"
fi

echo "=============================================="
echo " ✅ تم إنشاء نسخة: $NAME"
echo " الرابط:        https://$DOMAIN"
echo " دخول المدير:   admin"
echo " كلمة المرور:   $ADMIN_PASS   (احفظها وغيّرها من الإعدادات)"
[ -n "$STAFF" ] && echo " الموظفين:      $STAFF  (كلمة المرور 1234)"
echo " البيانات في:   $DATA_DIR"
echo "=============================================="
