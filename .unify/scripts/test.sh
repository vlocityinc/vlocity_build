#!/usr/bin/env bash
# =============================================================================
# Unify Test Script for vlocity_build
# 
# This script is designed for CloudBees Unify and uses environment variables
# for secrets instead of encrypted files (CodeShip approach).
#
# Environment Variables (set by Unify workflow):
#   - SF_TEST_ORG_CREDENTIALS: Salesforce SFDX auth URL (JSON content)
#   - GITHUB_TOKEN: GitHub access token
#   - NPM_TOKEN: NPM registry token
# =============================================================================

set -e

echo "=========================================="
echo "Unify Test Pipeline - vlocity_build"
echo "=========================================="

# -----------------------------------------------------------------------------
# Salesforce Authentication
# -----------------------------------------------------------------------------
echo ">> Authenticating to Salesforce..."

# Check for Unify secrets (preferred)
if [ -n "$SF_TEST_ORG_CREDENTIALS" ]; then
    echo "Using Unify secrets for Salesforce authentication"
    SF_CREDENTIALS_FILE="/tmp/sf_credentials_$$.json"
    echo "$SF_TEST_ORG_CREDENTIALS" > "$SF_CREDENTIALS_FILE"
# Fallback to CodeShip decrypted file (for hybrid migration period)
elif [ -f "codeship/unencrypted_files/test.json" ]; then
    echo "Using CodeShip decrypted file for Salesforce authentication (migration mode)"
    SF_CREDENTIALS_FILE="codeship/unencrypted_files/test.json"
else
    echo "Error: No Salesforce credentials found!"
    echo "Set SF_TEST_ORG_CREDENTIALS environment variable or ensure decrypted files exist."
    exit 1
fi

# Verify SFDX is available
echo ">> SFDX Version:"
sf --version || sfdx --version

# Authenticate to Salesforce
SF_AUTH_ORG=$(sf org login sfdx-url --sfdx-url-file "$SF_CREDENTIALS_FILE" --json)
SF_USERNAME=$(echo "$SF_AUTH_ORG" | jq -r '.result.username')

if [ -z "$SF_USERNAME" ] || [ "$SF_USERNAME" == "null" ]; then
    echo "Error: Failed to extract Salesforce username from authentication response"
    echo "Auth response: $SF_AUTH_ORG"
    exit 1
fi

echo ">> Authenticated as: $SF_USERNAME"

# Set alias for convenience
sf force alias set VB_TEST_ORG="$SF_USERNAME"

# Clean up temp credentials file if created
if [[ "$SF_CREDENTIALS_FILE" == /tmp/* ]]; then
    rm -f "$SF_CREDENTIALS_FILE"
fi

# -----------------------------------------------------------------------------
# NPM Setup
# -----------------------------------------------------------------------------
echo ">> Installing dependencies..."
npm install

# -----------------------------------------------------------------------------
# Unit Tests
# -----------------------------------------------------------------------------
echo ">> Running unit tests..."
npm run-script unitTest

# -----------------------------------------------------------------------------
# Link Package
# -----------------------------------------------------------------------------
echo ">> Linking package..."
npm link || echo "npm link failed, continuing..."

# -----------------------------------------------------------------------------
# Vlocity Test Jobs
# -----------------------------------------------------------------------------
echo ">> Running Vlocity test job (verbose)..."
vlocity -sfdx.username "$SF_USERNAME" runTestJob --verbose

echo ">> Running Vlocity test job (JSON) - Takes up to 10 minutes..."
vlocity -sfdx.username "$SF_USERNAME" runTestJob --json | jq .

echo "=========================================="
echo "Unify Test Pipeline - COMPLETED"
echo "=========================================="


