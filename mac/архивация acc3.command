#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

echo "Архивация acc3."
echo

npm run archive:acc3
EXIT_CODE=$?

pause_and_exit "$EXIT_CODE"
