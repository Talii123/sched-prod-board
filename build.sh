#!/bin/sh
# Stamps the git sha into a copy of app/ at dist/. Usage: ./build.sh
set -e
cd "$(dirname "$0")"
SHA=$(git rev-parse HEAD)
rm -rf dist && cp -R app dist
sed -i.bak "s/__BUILD_SHA__/$SHA/g" dist/index.html && rm dist/index.html.bak
echo "built $SHA"
