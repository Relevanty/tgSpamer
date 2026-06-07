#!/bin/bash
cd "$(dirname "$0")"

echo "Архивация acc3."
echo

npm run archive:acc3
exit $?
