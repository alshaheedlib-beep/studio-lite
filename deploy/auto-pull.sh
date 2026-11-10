#!/usr/bin/env bash
# سحب تلقائي من GitHub: إذا في تحديث جديد، يسحبه ويعيد تشغيل كل نسخ الاستوديو
# يُشغَّل كل دقيقة من cron:
#   * * * * * /opt/studio-lite/deploy/auto-pull.sh >> /var/log/studio-lite-pull.log 2>&1
set -e
cd "$(dirname "$0")/.."
git fetch -q origin
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse @{u})
if [ "$LOCAL" != "$REMOTE" ]; then
  git reset -q --hard "$REMOTE"
  for p in $(pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>JSON.parse(s).filter(x=>x.name.startsWith("studio-")).forEach(x=>console.log(x.name)))'); do
    pm2 restart "$p" --update-env >/dev/null
  done
  echo "$(date '+%F %T') updated to $(git rev-parse --short HEAD)"
fi
