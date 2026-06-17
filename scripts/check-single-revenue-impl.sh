#!/usr/bin/env bash
# CI guard: fail if collected-revenue BUSINESS LOGIC appears outside revenue.service.ts.
# The repo layer (payment.repo.ts) legitimately contains SQL — that's allowed.
# What's forbidden: any other file defining computeCollected or hardcoding
# status='COLLECTED' filter logic outside the repo+service pair.
set -euo pipefail

SERVICE="src/revenue/revenue.service.ts"
REPO="src/repos/payment.repo.ts"

BAD=$(grep -rEn \
  "computeCollected|COLLECTED_STATUSES" \
  --include='*.ts' \
  src/ \
  | grep -v "^${SERVICE}:" \
  | grep -v "^${REPO}:" \
  | grep -v '\.test\.ts:' \
  | grep -v '\.spec\.ts:' \
  || true)

if [ -n "$BAD" ]; then
  echo "❌ Forbidden second revenue implementation detected:"
  echo "$BAD"
  echo ""
  echo "computeCollected must only be defined in ${SERVICE}."
  echo "SQL allow-list belongs in ${REPO} only."
  exit 1
fi

echo "✅ Single revenue implementation check passed."
