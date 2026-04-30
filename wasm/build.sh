# this script convert the cpp code to wasm (web assembly).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="${SCRIPT_DIR}/tree_engine.cpp"
OUT_DIR="${SCRIPT_DIR}/../panel"
OUT_JS="${OUT_DIR}/tree_engine.js"
OUT_WASM="${OUT_DIR}/tree_engine.wasm"

echo "[Dendrite] Compiling tree_engine.cpp → WASM ..."

emcc "$SRC" \
  -O3 \
  -s WASM=1 \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
  -s ALLOW_MEMORY_GROWTH=0 \
  -s INITIAL_MEMORY=1048576 \
  -s MAXIMUM_MEMORY=1048576 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME='TreeEngineModule' \
  -s ENVIRONMENT='web' \
  -s FILESYSTEM=0 \
  -s ASSERTIONS=0 \
  -s SINGLE_FILE=0 \
  -o "$OUT_JS"

echo "[Dendrite] Build complete:"
echo "  JS glue → ${OUT_JS}"
echo "  WASM    → ${OUT_WASM}"
ls -lh "$OUT_JS" "$OUT_WASM"