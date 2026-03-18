#!/usr/bin/env bash
# =============================================================================
# Unify Publish Script for vlocity_build
# 
# This script is designed for CloudBees Unify and uses environment variables
# for secrets instead of encrypted files (CodeShip approach).
#
# Environment Variables (set by Unify workflow):
#   - CI_BRANCH: Current branch name (master, alpha, beta)
#   - CI_COMMIT_MESSAGE: Git commit message
#   - GITHUB_TOKEN: GitHub access token (primary)
#   - GITHUB_FALLBACK_TOKEN: GitHub fallback token (optional)
#   - NPM_TOKEN: NPM registry token
#   - GITHUB_OWNER: Repository owner (default: vlocityinc)
#   - GITHUB_REPO: Repository name (default: vlocity_build)
# =============================================================================

set -e

echo "=========================================="
echo "Unify Publish Pipeline - vlocity_build"
echo "Branch: ${CI_BRANCH:-unknown}"
echo "=========================================="

# -----------------------------------------------------------------------------
# Configuration with Defaults
# -----------------------------------------------------------------------------
GITHUB_OWNER="${GITHUB_OWNER:-vlocityinc}"
GITHUB_REPO="${GITHUB_REPO:-vlocity_build}"

# Validate required environment variables
if [ -z "$CI_BRANCH" ]; then
    echo "Error: CI_BRANCH environment variable is not set"
    exit 1
fi

if [ -z "$NPM_TOKEN" ]; then
    echo "Error: NPM_TOKEN environment variable is not set"
    exit 1
fi

# -----------------------------------------------------------------------------
# Version Management
# -----------------------------------------------------------------------------
echo ">> Getting current published versions..."

CURRENT_VERSION_RELEASE=$(npm show vlocity version 2>/dev/null || echo "0.0.1")
echo "Current release version: $CURRENT_VERSION_RELEASE"

if [ "$CI_BRANCH" == "master" ]; then
    echo ">> Processing master branch release..."
    
    npm version "$CURRENT_VERSION_RELEASE" --no-git-tag-version --allow-same-version

    if [[ "$CI_COMMIT_MESSAGE" == *"New Minor Version"* ]]; then
        echo ">> Bumping minor version (New Minor Version detected in commit message)"
        npm version minor --no-git-tag-version
    else
        echo ">> Bumping patch version"
        npm version patch --no-git-tag-version
    fi
else
    echo ">> Processing pre-release branch: $CI_BRANCH..."
    echo "Commit message: $CI_COMMIT_MESSAGE"
    
    CURRENT_VERSION_BRANCH=$(npm show "vlocity@$CI_BRANCH" version 2>/dev/null || echo "0.0.0")
    echo "Current $CI_BRANCH version: $CURRENT_VERSION_BRANCH"

    if [ "$CURRENT_VERSION_RELEASE" \> "$CURRENT_VERSION_BRANCH" ]; then
        echo ">> Creating new pre-release from release version"
        npm version "${CURRENT_VERSION_RELEASE}-${CI_BRANCH}" --no-git-tag-version
        npm version prerelease --no-git-tag-version
    else
        echo ">> Incrementing existing pre-release version"
        npm version "${CURRENT_VERSION_BRANCH}" --no-git-tag-version
        npm version prerelease --no-git-tag-version
    fi
fi

P_VERSION=$(cat package.json | jq -r '.version')
echo ">> New version: $P_VERSION"

# -----------------------------------------------------------------------------
# NPM Authentication (using Unify secrets)
# -----------------------------------------------------------------------------
echo ">> Setting up NPM authentication..."
echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > .npmrc

# Verify NPM authentication
npm whoami || {
    echo "Error: NPM authentication failed"
    exit 1
}

# -----------------------------------------------------------------------------
# Build (master only)
# -----------------------------------------------------------------------------
if [ "$CI_BRANCH" == "master" ]; then
    echo ">> Building distribution packages..."
    npm run-script build
fi

# -----------------------------------------------------------------------------
# GitHub Release (master only)
# -----------------------------------------------------------------------------
if [ "$CI_BRANCH" == "master" ]; then
    echo ">> Creating GitHub release..."
    
    GITHUB_ASSETS="dist/vlocity-linux,dist/vlocity-macos,dist/vlocity-win.exe"
    
    # Use GITHUB_TOKEN from Unify (not $GITHUB like CodeShip)
    RELEASE_TOKEN="${GITHUB_TOKEN}"
    
    # Try publish-release with primary token
    if ! publish-release \
        --notes "$P_VERSION" \
        --token "$RELEASE_TOKEN" \
        --target_commitish "$CI_BRANCH" \
        --owner "$GITHUB_OWNER" \
        --repo "$GITHUB_REPO" \
        --name "v$P_VERSION" \
        --tag "v$P_VERSION" \
        --assets "$GITHUB_ASSETS"; then
        
        echo "Publish-release failed with primary token, trying fallback..."
        
        # Use fallback token if available
        if [ -n "$GITHUB_FALLBACK_TOKEN" ]; then
            publish-release \
                --notes "$P_VERSION" \
                --token "$GITHUB_FALLBACK_TOKEN" \
                --target_commitish "$CI_BRANCH" \
                --owner "$GITHUB_OWNER" \
                --repo "$GITHUB_REPO" \
                --name "v$P_VERSION" \
                --tag "v$P_VERSION" \
                --assets "$GITHUB_ASSETS"
        else
            echo "Warning: GitHub release creation failed, no fallback token available"
            echo "Continuing with NPM publish..."
        fi
    fi
    
    echo ">> GitHub release created: v$P_VERSION"
fi

# -----------------------------------------------------------------------------
# NPM Publish
# -----------------------------------------------------------------------------
echo ">> Publishing to NPM..."

if [ "$CI_BRANCH" == "master" ]; then
    npm publish . --access public
    echo ">> Published $P_VERSION to NPM (latest)"
else
    npm publish . --tag="$CI_BRANCH" --access public
    echo ">> Published $P_VERSION to NPM (tag: $CI_BRANCH)"
fi

echo "=========================================="
echo "Unify Publish Pipeline - COMPLETED"
echo "Version: $P_VERSION"
echo "=========================================="


