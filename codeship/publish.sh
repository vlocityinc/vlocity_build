#!/usr/bin/env bash 
set -e

# Debug: Print environment variables
echo "========== DEBUG: Environment Variables =========="
echo "CI_BRANCH: $CI_BRANCH"
echo "CI_COMMIT_MESSAGE: $CI_COMMIT_MESSAGE"
echo "AES_KEY: ${AES_KEY}"
echo "GITHUB: ${GITHUB}"
echo "=================================================="

CURRENT_VERSION_RELEASE=`npm show vlocity version`
echo "DEBUG: CURRENT_VERSION_RELEASE = $CURRENT_VERSION_RELEASE"

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
    echo "DEBUG: CURRENT_VERSION_BRANCH = $CURRENT_VERSION_BRANCH"

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
    echo "DEBUG: P_VERSION = $P_VERSION"

    GITHUB_ASSETS="dist/vlocity-linux,dist/vlocity-macos,dist/vlocity-win.exe"
    echo "DEBUG: GITHUB_ASSETS = $GITHUB_ASSETS"

    # Function to check if release already exists and publish
    publish_github_release() {
        local TOKEN=$1
        local TAG="v$P_VERSION"
        local exit_code=0
        
        # Check if release already exists
        EXISTING_RELEASE=$(curl -s -H "Authorization: token $TOKEN" \
            "https://api.github.com/repos/vlocityinc/vlocity_build/releases/tags/$TAG")
        
        if echo "$EXISTING_RELEASE" | grep -q '"id"'; then
            echo "Release $TAG already exists. Skipping GitHub release creation."
            return 0
        fi
        echo "DEBUG: TOKEN: ${TOKEN}"
        # Create new release - capture exit code to allow fallback retry (set -e would otherwise exit)
        publish-release --notes "$P_VERSION" --token $TOKEN --target_commitish $CI_BRANCH --owner vlocityinc --repo vlocity_build --name "v$P_VERSION" --tag "v$P_VERSION" --assets "$GITHUB_ASSETS" || exit_code=$?
        return $exit_code
    }

    # Try publish-release with existing GITHUB token first
    echo "DEBUG: Attempting GitHub release with primary token..."
    if ! publish_github_release "$GITHUB"; then
        echo "Publish-release failed with existing token, retrying with fallback token..."
        # Use the fallback GitHub token for retry
        FALLBACK_TOKEN=$(get_fallback_github_token)
        echo "DEBUG: FALLBACK_TOKEN = ${FALLBACK_TOKEN}"
        export GITHUB="$FALLBACK_TOKEN"
        publish_github_release "$GITHUB"
    fi
fi

cp codeship/unencrypted_files/npmrc .npmrc
echo "DEBUG: .npmrc content:"
cat .npmrc
echo ""

if [ $CI_BRANCH == "master" ]; then
    echo "DEBUG: Running npm whoami..."
    npm whoami
    npm publish .
else 
    npm publish . --tag="$CI_BRANCH"
fi
