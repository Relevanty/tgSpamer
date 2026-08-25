#!/usr/bin/env bash
cd "$(dirname "$0")/.."

if [ ! -f ".env.acc1" ]; then
    if [ -f "templates/example.env" ]; then
        cp "templates/example.env" ".env.acc1"
        printf "\nPROFILE=acc1\n" >> ".env.acc1"
        echo "Created .env.acc1 from templates/example.env."
    else
        echo "Missing templates/example.env. Cannot create .env.acc1."
        exit 1
    fi
fi
echo "Login acc1. SESSION_STRING will be saved to .env.acc1 after QR login."
npm run login:acc1
