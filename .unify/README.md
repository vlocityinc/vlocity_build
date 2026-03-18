# CloudBees Unify Workflows

This directory contains CloudBees Unify workflow definitions for the vlocity_build project.

## Directory Structure

```
.unify/
├── README.md              # This file
├── workflows/
│   ├── test-workflow.yaml     # Test pipeline workflow
│   └── publish-workflow.yaml  # Publish pipeline workflow
└── scripts/
    ├── test.sh                # Unify-specific test script
    └── publish.sh             # Unify-specific publish script
```

## Workflows

### test-workflow.yaml
- **Purpose:** Run unit tests and Vlocity test jobs
- **Triggers:** Push and Pull Requests (all branches)
- **Runner:** Docker (vlocitybuild image)
- **Script:** `.unify/scripts/test.sh`

### publish-workflow.yaml
- **Purpose:** Build and publish package to NPM and GitHub
- **Triggers:** Push to master, alpha, beta branches
- **Runner:** Docker (vlocitybuild image)
- **Script:** `.unify/scripts/publish.sh`

## Scripts

### `.unify/scripts/test.sh`
Unify-specific test script that:
- Uses `SF_TEST_ORG_CREDENTIALS` environment variable (Unify secret)
- Falls back to CodeShip decrypted files during hybrid migration period
- Runs unit tests and Vlocity test jobs

### `.unify/scripts/publish.sh`
Unify-specific publish script that:
- Uses `NPM_TOKEN` and `GITHUB_TOKEN` environment variables (Unify secrets)
- Handles version management for master/alpha/beta branches
- Creates GitHub releases for master branch
- Publishes to NPM registry

## Comparison: CodeShip vs Unify Scripts

| Feature | CodeShip (`codeship/`) | Unify (`.unify/scripts/`) |
|---------|------------------------|---------------------------|
| SF Credentials | Decrypted file: `codeship/unencrypted_files/test.json` | Env var: `$SF_TEST_ORG_CREDENTIALS` |
| GitHub Token | Env var: `$GITHUB` (from encryption) | Env var: `$GITHUB_TOKEN` |
| NPM Auth | Decrypted file: `codeship/unencrypted_files/npmrc` | Env var: `$NPM_TOKEN` |
| Fallback Token | Read from file: `github_token.enc` | Env var: `$GITHUB_FALLBACK_TOKEN` |
| Decryption | Required: `./codeship/decryptFiles.sh` | Not required (secrets from Unify) |

## Setup Instructions

1. **Import Workflows to Unify:**
   - Go to CloudBees Unify Dashboard
   - Navigate to your component
   - Go to Workflows section
   - Import these YAML files

2. **Configure Secrets:**
   - Ensure all required secrets are added to Unify
   - Link secrets to the component
   - Verify secret names match workflow references

3. **Configure Docker Image:**
   - Ensure `vlocitybuild` image is available
   - Configure image registry access
   - Set up image caching

## Required Secrets

| Secret Name | Description | Source (CodeShip) |
|-------------|-------------|-------------------|
| `NPM_TOKEN` | NPM registry authentication token | `codeship/unencrypted_files/npmrc` |
| `GITHUB_TOKEN` | GitHub API token for releases | `$GITHUB` env var |
| `GITHUB_FALLBACK_TOKEN` | Fallback GitHub token (optional) | `codeship/unencrypted_files/github_token.enc` |
| `SF_TEST_ORG_CREDENTIALS` | Salesforce test org credentials (JSON) | `codeship/unencrypted_files/test.json` |

## Environment Variables

Workflows automatically set these environment variables:
- `CI_BRANCH` - Current branch name (from `workflow.ref_name`)
- `CI_COMMIT_MESSAGE` - Commit message (from `workflow.commit_message`)
- `SF_USERNAME` - Salesforce username (set during test workflow)
- `GITHUB_OWNER` - Repository owner (default: `vlocityinc`)
- `GITHUB_REPO` - Repository name (default: `vlocity_build`)

## Migration Notes

**CodeShip files are NOT modified** - Unify uses separate scripts in `.unify/scripts/`:

| CodeShip | Unify |
|----------|-------|
| `codeship/test.sh` | `.unify/scripts/test.sh` |
| `codeship/publish.sh` | `.unify/scripts/publish.sh` |
| `codeship-steps.yml` | `.unify/workflows/*.yaml` |

This allows both systems to run in parallel during migration without conflicts.

### Hybrid Migration Mode

The Unify scripts support a hybrid mode where they can fall back to CodeShip decrypted files if Unify secrets are not available. This is useful during the migration period:

```bash
# test.sh: Falls back to codeship/unencrypted_files/test.json if SF_TEST_ORG_CREDENTIALS is not set
# publish.sh: Uses only Unify environment variables (no fallback to files)
```

For detailed migration instructions, see `MIGRATION_GUIDE_CODESHIP_TO_UNIFY.md` in the repository root.