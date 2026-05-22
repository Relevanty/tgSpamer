#!/bin/sh

set -u

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"

echo "Готовлю ярлыки для Mac..."
echo

for file in "$SCRIPT_DIR"/*.command "$SCRIPT_DIR/_common.sh"; do
  if [ -e "$file" ]; then
    chmod +x "$file"
    echo "Разрешен запуск: $(basename "$file")"
  fi
done

if command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine "$PROJECT_DIR" 2>/dev/null || true
fi

echo
echo "Готово. Теперь файлы .command можно открывать двойным кликом."

if [ -t 0 ]; then
  echo
  printf "Нажмите Enter, чтобы закрыть..."
  read _ || true
fi
