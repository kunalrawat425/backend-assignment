#!/bin/bash
# Buffalo Ingestion Pipeline Deployment Script
# Exit immediately if any command exits with a non-zero status
set -e

echo "======================================================"
echo "=== STARTING BUFFALO DEPLOYMENT BUILD PROCESS ==="
echo "======================================================"

# 1. Install dependencies
echo "Step 1: Installing dependencies..."
if command -v pnpm &> /dev/null; then
  pnpm install --frozen-lockfile
else
  echo "pnpm not found, falling back to npm..."
  npm ci
fi

# 2. Deploy database migrations
echo "Step 2: Deploying Prisma database migrations..."
if command -v pnpm &> /dev/null; then
  pnpm db:migrate:deploy
else
  npx prisma migrate deploy
fi

# 3. Generate Prisma client
echo "Step 3: Generating Prisma Client..."
if command -v pnpm &> /dev/null; then
  pnpm db:generate
else
  npx prisma generate
fi

# 4. Build the application
echo "Step 4: Compiling TypeScript code..."
if command -v pnpm &> /dev/null; then
  pnpm build
else
  npm run build
fi

echo "======================================================"
echo "=== BUFFALO DEPLOYMENT PREPARED SUCCESSFULLY ==="
echo "======================================================"
