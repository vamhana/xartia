#!/usr/bin/env bash
# scripts/smoke-passport.sh — быстрый smoke-тест Passport API.
set -euo pipefail

BASE="http://127.0.0.1:3000"
PHONE="+79001234567"
PASS="ChangeMe123456"

if ! command -v jq >/dev/null; then
  echo "jq не установлен: sudo apt install -y jq" >&2
  exit 1
fi

echo "── login ──"
TOKEN=$(curl -s -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"password\":\"$PASS\"}" | jq -r .access_token)
if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
  echo "FAIL: login не дал access_token" >&2; exit 1
fi
echo "OK  ${TOKEN:0:32}..."

H="Authorization: Bearer $TOKEN"

echo
echo "── 1. catalog?limit=5 ──"
curl -s -H "$H" "$BASE/passport/catalog?limit=5" | jq '{count: (.data|length), first: .data[0].atomId, meta}'

echo
echo "── 2. catalog?query=SQL ──"
curl -s -H "$H" "$BASE/passport/catalog?query=SQL" | jq '.data[].atomId'

echo
echo "── 3. catalog?query=0009 ──"
curl -s -H "$H" "$BASE/passport/catalog?query=0009" | jq '.data[].atomId'

echo
echo "── 4. atoms/CYB.ATOM.0009 (эталон 5.2) ──"
curl -s -H "$H" "$BASE/passport/atoms/CYB.ATOM.0009" \
  | jq '.atom | {atomId: .atom_id, name, version, status, dimensions: (.dimension_applicability | keys), hasCriteria: (.assessment_criteria != null)}'

echo
echo "── 5. atoms/CYB.ATOM.9999 → 404 ──"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" "$BASE/passport/atoms/CYB.ATOM.9999")
echo "HTTP $code  $( [[ $code == 404 ]] && echo '✅' || echo '❌ ожидалось 404' )"

echo
echo "── 6. atoms/ATOM-1 (битый ID) → 400 ──"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" "$BASE/passport/atoms/ATOM-1")
echo "HTTP $code  $( [[ $code == 400 ]] && echo '✅' || echo '❌ ожидалось 400' )"

echo
echo "── 7. history (пустая) ──"
curl -s -H "$H" "$BASE/passport/history" | jq

echo
echo "── 8. старый контракт test-passport.ts ──"
cd "$(dirname "$0")/.."
pnpm tsx scripts/test-passport.ts "$PHONE" "$PASS" 2>&1 | tail -5