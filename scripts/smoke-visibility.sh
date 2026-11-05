#!/usr/bin/env bash
# scripts/smoke-visibility.sh — smoke шага 5 (приватность).
# Требует БД и работающий API. Создаёт временного участника (viewer),
# если его ещё нет.
set -euo pipefail

BASE="http://127.0.0.1:3000"
PHONE_A="+79001234567";  PASS_A="ChangeMe123456"
PHONE_B="+79007654321";  PASS_B="ChangeMeViewer1"   # временный viewer

echo "── ensure viewer (phone $PHONE_B) ──"
VIEWER_ID=$(psql "$DATABASE_URL" -Atc "select id from participants where phone_hash = encode(digest('$PHONE_B','sha256'),'hex') and deleted_at is null limit 1")
if [[ -z "$VIEWER_ID" ]]; then
  # Пароль ChangeMeViewer1 — argon2id-хеш надо сгенерировать в node.
  HASH=$(pnpm tsx -e "import { hashPassword } from './src/security/password.js'; hashPassword('$PASS_B').then(h=>process.stdout.write(h))")
  VIEWER_ID=$(psql "$DATABASE_URL" -Atc "
    with dir as (select id from directions where status='active' order by number limit 1)
    insert into participants
      (external_id, wave_letter, wave_number, direction_id, name, phone,
       phone_hash, messengers, password_hash, status, profile_risk, entered_at)
    values
      ('SMOKE-VIEWER-1', 'S', 1, (select id from dir), 'Smoke Viewer',
       encode(pgp_sym_encrypt('$PHONE_B','${ENCRYPTION_KEY:-x}')::bytea,'base64'),
       encode(digest('$PHONE_B','sha256'),'hex'),
       '{}'::jsonb, '$HASH', 'full', 'compatible', now())
    returning id")
fi
echo "viewer_id=$VIEWER_ID"

TOKEN_A=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$PHONE_A\",\"password\":\"$PASS_A\"}" | jq -r .access_token)
TOKEN_B=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$PHONE_B\",\"password\":\"$PASS_B\"}" | jq -r .access_token)
[[ "$TOKEN_A" == "null" || -z "$TOKEN_A" ]] && { echo "FAIL: A login"; exit 1; }
[[ "$TOKEN_B" == "null" || -z "$TOKEN_B" ]] && { echo "FAIL: B login"; exit 1; }

HA="Authorization: Bearer $TOKEN_A"
HB="Authorization: Bearer $TOKEN_B"
A_ID=$(curl -s -H "$HA" "$BASE/me" | jq -r .id)
echo "A_ID=$A_ID"

echo
echo "── 1. default visibility A (всё private/false) ──"
curl -s -H "$HA" "$BASE/passport/visibility" | jq '.data[] | {scope, visibility, consent}'

echo
echo "── 2. B читает A scope=public → 403 (плюс access_log) ──"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "$HB" "$BASE/passport/people/$A_ID?scope=public")
echo "HTTP $code $( [[ $code == 403 ]] && echo '✅' || echo '❌' )"

echo
echo "── 3. access_log A: есть deny-запись ──"
curl -s -H "$HA" "$BASE/passport/access-log" | jq '.data[0]'

echo
echo "── 4. A даёт mentor=levels, consent=true ──"
curl -s -X PATCH "$BASE/passport/visibility" -H "$HA" -H 'Content-Type: application/json' \
  -d '{"scope":"mentor","visibility":"levels","consent":true}' | jq '{scope, visibility, consent}'

echo
echo "── 5. B читает A scope=mentor → 200 (реальный overview) ──"
curl -s -H "$HB" "$BASE/passport/people/$A_ID?scope=mentor" | jq '{width, depthExecution, counts: .counts.notAssessed}'

echo
echo "── 6. B через public — всё ещё 403 (нет согласия для public) ──"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "$HB" "$BASE/passport/people/$A_ID?scope=public")
echo "HTTP $code $( [[ $code == 403 ]] && echo '✅' || echo '❌' )"

echo
echo "── 7. consent=false сбрасывает в private ──"
curl -s -X PATCH "$BASE/passport/visibility" -H "$HA" -H 'Content-Type: application/json' \
  -d '{"scope":"mentor","visibility":"full","consent":false}' | jq '{scope, visibility, consent}'
# ожидаем: visibility=private

echo
echo "── 8. История A содержит visibility_changed ──"
curl -s -H "$HA" "$BASE/passport/history" | jq '[.data[] | select(.eventType=="visibility_changed")] | length'

echo
echo "── 9. Self-чтение A по A → overview, access_log не растёт ──"
BEFORE=$(curl -s -H "$HA" "$BASE/passport/access-log" | jq '.meta.total')
curl -s -H "$HA" "$BASE/passport/people/$A_ID" > /dev/null
AFTER=$(curl -s -H "$HA" "$BASE/passport/access-log" | jq '.meta.total')
echo "before=$BEFORE after=$AFTER $( [[ "$BEFORE" == "$AFTER" ]] && echo '✅' || echo '❌' )"