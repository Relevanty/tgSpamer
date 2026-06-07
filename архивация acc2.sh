#!/bin/bash
cd "$(dirname "$0")"

echo "Архивация acc2."
echo

npm run archive:acc2
exit $?
