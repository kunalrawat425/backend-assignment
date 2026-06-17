#!/usr/bin/env bash

# ==============================================================================
# Single Source of Truth Invariant Guard
#
# This script scans the codebase to ensure there is exactly ONE location where 
# collected revenue queries or custom SQL status-allow-list checks are computed.
# This prevents code duplication and metric drift caused by different parts
# of the application writing ad-hoc revenue aggregations.
# ==============================================================================

set -eo pipefail

TARGET_DIR="src"
CANONICAL_FILE="src/repos/revenue.service.ts"

echo "=== STARTING CANONICAL REVENUE IMPLEMENTATION GUARD CHECK ==="

# 1. Verify that the canonical file exists
if [ ! -f "$CANONICAL_FILE" ]; then
  echo "❌ Error: Canonical revenue implementation file '$CANONICAL_FILE' is missing!"
  exit 1
fi

# 2. Check for queries to .payment.aggregate, .payment.groupBy or similar payment queries
# outside the canonical file.
echo "Scanning for unauthorized payment aggregations outside of '$CANONICAL_FILE'..."

VIOLATIONS=0

# Scan for payment database access patterns
# We exclude the canonical file itself and the normalizers status map
FILES_TO_CHECK=$(find "$TARGET_DIR" -type f -name "*.ts" ! -path "$CANONICAL_FILE")

for file in $FILES_TO_CHECK; do
  # We look for direct queries on payment aggregates or groupings
  if grep -E "\.payment\.(aggregate|groupBy)" "$file" > /dev/null; then
    echo "❌ Violation in $file: Direct payment aggregation or grouping queries are forbidden. Use RevenueService instead."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi

  # We look for queries filtering on PaymentStatus.COLLECTED or status lists outside normalizers, mappers, and repositories
  if [[ "$file" != *"src/normalizers/"* && "$file" != *"src/repos/payment.repo.ts"* ]]; then
    if grep -F "PaymentStatus.COLLECTED" "$file" > /dev/null; then
      echo "❌ Violation in $file: Hardcoding PaymentStatus.COLLECTED in business logic queries is forbidden. Use RevenueService instead."
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  fi
done

if [ "$VIOLATIONS" -gt 0 ]; then
  echo "❌ Check Failed: Found $VIOLATIONS violation(s). Ensure all revenue calculations consume 'RevenueService.computeCollected()'."
  exit 1
else
  echo "✅ Check Succeeded: Zero duplicate revenue calculation patterns or status allow-list leaks found."
  exit 0
fi
