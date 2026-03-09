#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$PROJECT_ROOT/.build"

echo "[build] Compiling TypeScript..."
cd "$PROJECT_ROOT"
npx tsc

echo "[build] Staging clean deployment package..."
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# Copy only compiled output (flatten dist/ into .build/)
cp -r dist/* "$BUILD_DIR/"

# Copy package files for production dependency resolution
cp package.json package-lock.json "$BUILD_DIR/"

# Install production dependencies only (no dev deps, no scripts)
cd "$BUILD_DIR"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund 2>&1 | tail -1

# Keep only the "type": "module" declaration for ESM support in Lambda
rm -f package-lock.json
echo '{"type":"module"}' > package.json

echo "[build] Package staged at .build/ ($(du -sh "$BUILD_DIR" | cut -f1) total)"
