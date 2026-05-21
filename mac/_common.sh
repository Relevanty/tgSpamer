#!/bin/bash

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  source "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
fi

MAC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$MAC_DIR/.." && pwd)"

cd "$PROJECT_DIR" || exit 1

pause_and_exit() {
  local exit_code="$1"

  echo
  read -n 1 -s -r -p "Нажмите любую клавишу, чтобы выйти..."
  echo
  exit "$exit_code"
}

require_node_and_npm() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js не найден."
    echo "Открываю сайт Node.js."
    open "https://nodejs.org/"
    echo "Установите Node.js LTS, затем запустите установка.command снова."
    return 1
  fi

  if ! command -v npm >/dev/null 2>&1; then
    echo "npm не найден. Переустановите Node.js с официального сайта."
    open "https://nodejs.org/"
    return 1
  fi

  return 0
}

ensure_env_file() {
  local account="$1"
  local env_file=".env.$account"
  local example_file="example.env.$account"

  if [ -f "$env_file" ]; then
    return 0
  fi

  if [ -f "$example_file" ]; then
    cp "$example_file" "$env_file"
    echo "Создан $env_file из $example_file."
    echo
    return 0
  fi

  echo "Не найден $example_file. Невозможно создать $env_file."
  return 1
}
