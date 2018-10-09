#!/usr/bin/env bash 
set -e

./codeship/decryptFiles.sh

cp codeship/unencrypted_files/npmrc .npmrc

if [ $CI_BRANCH == "master" ]; then
    npm publish .
else 
    npm publish . --tag="next"
fi

npm run-script build

P_VERSION=`cat package.json | jq -r '. | .version'` 

GITHUB_ASSETS="dist/vlocity-linux-x64,dist/vlocity-macos-x64,dist/vlocity-win-x64.exe,dist/vlocity-win-x86.exe"

if [ $CI_BRANCH == "master" ]; then
    publish-release --notes "$P_VERSION" --token $GITHUB --target_commitish $CI_BRANCH --owner vlocityinc --repo vlocity_build --name "v$P_VERSION" --tag "v$P_VERSION" --assets "$GITHUB_ASSETS" --draft
else 
    publish-release --notes "Beta - v$P_VERSION" --token $GITHUB --target_commitish $CI_BRANCH --prerelease --reuseRelease --owner vlocityinc --repo vlocity_build --name "Beta-v$P_VERSION" --editRelease --tag next --assets "$GITHUB_ASSETS" --draft
fi