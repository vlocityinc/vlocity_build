#!/usr/bin/env bash 
set -e

if [ $CI_BRANCH == "master" ]; then
    CURRENT_VERSION=`npm show vlocity version`
    npm version $CURRENT_VERSION --no-git-tag-version
    npm version patch --no-git-tag-version
else 
    CURRENT_VERSION=`npm show vlocity@$CI_BRANCH version`
    npm version $CURRENT_VERSION --no-git-tag-version
    npm version prerelease --no-git-tag-version
fi

./codeship/decryptFiles.sh

if [ $CI_BRANCH == "master" ]; then

    npm run-script build

    P_VERSION=`cat package.json | jq -r '. | .version'` 

    GITHUB_ASSETS="dist/vlocity-linux-x64,dist/vlocity-macos-x64,dist/vlocity-win-x64.exe,dist/vlocity-win-x86.exe"

    publish-release --notes "$P_VERSION" --token $GITHUB --target_commitish $CI_BRANCH --owner vlocityinc --repo vlocity_build --name "v$P_VERSION" --tag "v$P_VERSION" --assets "$GITHUB_ASSETS" --draft
fi

cp codeship/unencrypted_files/npmrc .npmrc

if [ $CI_BRANCH == "master" ]; then
    npm publish .
else 
    npm publish . --tag="$CI_BRANCH"
fi