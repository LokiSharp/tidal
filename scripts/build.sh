#!/usr/bin/env bash
set -euo pipefail

# Build script: generates Clash YAML rule-sets from .list source files
# .list (Surge format) → .yaml (Clash format)

RULES_DIR="$(cd "$(dirname "$0")/.." && pwd)/rules"
DIST_DIR="$(cd "$(dirname "$0")/.." && pwd)/dist"

echo "🌊 Tidal build starting..."

# Clean dist
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# Copy everything as-is first
cp -r "$RULES_DIR"/* "$DIST_DIR"/

# Generate Clash Provider YAML from .list files
PROVIDER_DIR="$DIST_DIR/Provider"
CLASH_PROVIDER_DIR="$DIST_DIR/Clash/Provider"
mkdir -p "$CLASH_PROVIDER_DIR"

convert_list_to_yaml() {
  local src="$1"
  local rel="${src#$PROVIDER_DIR/}"
  local dest="$CLASH_PROVIDER_DIR/${rel%.list}.yaml"

  mkdir -p "$(dirname "$dest")"
  {
    echo "payload:"
    sed '/^$/d' "$src" | while IFS= read -r line; do
      if [[ "$line" =~ ^# ]]; then
        echo "  $line"
      else
        echo "  - $line"
      fi
    done
  } > "$dest"
}

count=0
while IFS= read -r -d '' file; do
  convert_list_to_yaml "$file"
  count=$((count + 1))
done < <(find "$PROVIDER_DIR" -name '*.list' -print0)

# Move .list files to Surge/Provider/
SURGE_PROVIDER_DIR="$DIST_DIR/Surge/Provider"
mkdir -p "$SURGE_PROVIDER_DIR"
cp -r "$PROVIDER_DIR"/* "$SURGE_PROVIDER_DIR"/
rm -rf "$PROVIDER_DIR"

echo "✅ Generated $count Clash YAML rule-sets"

# Verify
surge_count=$(find "$SURGE_PROVIDER_DIR" -name '*.list' | wc -l)
clash_count=$(find "$CLASH_PROVIDER_DIR" -name '*.yaml' | wc -l)

if [ "$surge_count" -eq "$clash_count" ]; then
  echo "✅ File count matches: $surge_count provider files"
else
  echo "❌ Mismatch: $surge_count .list vs $clash_count .yaml"
  exit 1
fi

echo "🌊 Build complete → $DIST_DIR"
