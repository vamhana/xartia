#!/usr/bin/env bash
#Запуск: bash scripts/passport-smoke.sh — каждый раз новый EV/AS, без ручной сборки
set -euo pipefail
API=${API:-http://127.0.0.1:3000}
PHONE=${ARCHITECT_PHONE:-+79001234567}
PASSWORD=${ARCHITECT_PASSWORD:-ChangeMe123456}
SUBJECT_ID=${SUBJECT_ID:-18621917-2781-431e-b470-feaab736bb76}      # Смоук Субъект
VERIFIER_ID=${VERIFIER_ID:-d2771db9-e669-4f3f-9eeb-562a62dd8a0f}    # Смоук Асессор с VERIFIER
ATOM=${ATOM:-CYB.ATOM.0042}
DIM=${DIM:-U}

login() { curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"password\":\"$PASSWORD\"}" | jq -r .access_token; }

imp()   { curl -s -X POST "$API/dev/impersonate/$1" -H "Authorization: Bearer $2" \
  -H 'Content-Type: application/json' -d '{}' | jq -r .access_token; }

TOKEN_A=$(login)
[ ${#TOKEN_A} -gt 100 ] || { echo "login failed"; exit 1; }
SUBJ_TOKEN=$(imp "$SUBJECT_ID"  "$TOKEN_A")
TOKEN_C=$(imp    "$VERIFIER_ID" "$TOKEN_A")

EV=$(curl -s -X POST "$API/passport/evidence" -H "Authorization: Bearer $SUBJ_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"atomId\":\"$ATOM\",\"dimension\":\"$DIM\",\"evidenceType\":\"portfolio\",\"description\":\"smoke $(date +%s)\"}" \
  | jq -r .evidenceId)

AS=$(curl -s -X POST "$API/passport/assessments" -H "Authorization: Bearer $TOKEN_A" \
  -H 'Content-Type: application/json' \
  -d "{\"participantId\":\"$SUBJECT_ID\",\"atomId\":\"$ATOM\",\"dimension\":\"$DIM\",\"level\":5,\"method\":\"exam\",\"evidenceIds\":[\"$EV\"]}" \
  | jq -r .assessmentId)

echo "EV=$EV"
echo "AS=$AS"

curl -s -X POST "$API/passport/evidence/$EV/dispute" -H "Authorization: Bearer $SUBJ_TOKEN" \
  -H 'Content-Type: application/json' -d "{\"reason\":\"smoke $(date +%s)\"}" | jq .

curl -s -X POST "$API/passport/evidence/$EV/resolve" -H "Authorization: Bearer $TOKEN_C" \
  -H 'Content-Type: application/json' -d '{"resolution":"accepted","note":"ok"}' | jq .