#!/bin/bash
cd "$(dirname "$0")"

echo "Архивация acc1."
echo

npm run archive:acc1
exit $?
