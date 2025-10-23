#!/usr/bin/env bash 
set -e


CURRENT_VERSION_RELEASE=`npm show vlocity version`
if [ $CI_BRANCH == "master" ]; then
    
    npm version $CURRENT_VERSION_RELEASE --no-git-tag-version --allow-same-version

    if [[ $CI_COMMIT_MESSAGE == *"New Minor Version"* ]]; then
        npm version minor --no-git-tag-version
    else
        npm version patch --no-git-tag-version
    fi
else
    echo $CI_COMMIT_MESSAGE
    
    CURRENT_VERSION_BRANCH=`npm show vlocity@$CI_BRANCH version`

    if [ "$CURRENT_VERSION_RELEASE" \> "$CURRENT_VERSION_BRANCH" ]; then
        npm version ${CURRENT_VERSION_RELEASE}-${CI_BRANCH} --no-git-tag-version
        npm version prerelease --no-git-tag-version
    else
        npm version ${CURRENT_VERSION_BRANCH} --no-git-tag-version
        npm version prerelease --no-git-tag-version
    fi
fi

./codeship/decryptFiles.sh

# Function to get GitHub token for retry (fallback token)
get_fallback_github_token() {
    # Read the decrypted GitHub token from the unencrypted files
    if [ -f "codeship/unencrypted_files/github_token.enc" ]; then
        cat codeship/unencrypted_files/github_token.enc
    else
        echo "Error: GitHub token file not found" >&2
        exit 1
    fi
}

if [ $CI_BRANCH == "master" ]; then

    npm run-script build

    P_VERSION=`cat package.json | jq -r '. | .version'` 

    GITHUB_ASSETS="dist/vlocity-linux,dist/vlocity-macos,dist/vlocity-win.exe"

    #publish-release --notes "$P_VERSION" --token $GITHUB --target_commitish $CI_BRANCH --owner vlocityinc --repo vlocity_build --name "v$P_VERSION" --tag "v$P_VERSION" --assets "$GITHUB_ASSETS" --draft
    # Try publish-release with existing GITHUB token first
    if ! publish-release --notes "$P_VERSION" --token $GITHUB --target_commitish $CI_BRANCH --owner vlocityinc --repo vlocity_build --name "v$P_VERSION" --tag "v$P_VERSION" --assets "$GITHUB_ASSETS"; then
        echo "Publish-release failed with existing token, retrying with fallback token..."
        # Use the fallback GitHub token for retry
        FALLBACK_TOKEN=$(get_fallback_github_token)
        export GITHUB="$FALLBACK_TOKEN"
        publish-release --notes "$P_VERSION" --token $GITHUB --target_commitish $CI_BRANCH --owner vlocityinc --repo vlocity_build --name "v$P_VERSION" --tag "v$P_VERSION" --assets "$GITHUB_ASSETS" 
    fi
fi

cp codeship/unencrypted_files/npmrc .npmrc

if [ $CI_BRANCH == "master" ]; then
    npm publish .
else 
    npm publish . --tag="$CI_BRANCH"
fi
