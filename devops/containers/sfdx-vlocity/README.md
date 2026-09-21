# sfdx-vlocity

This docker image bundles all the dependencies needed for developing Vlocity Applications for Salesforce.

Developers can use this image to:

- run CI automations.
- create cloud or local development environments using docker containers.

## Dependencies

- Openjdk 11
- Node 14
- sfdx cli
- sf cli
- vlocity cli

### SFDX plugins

- sfdx-git-delta

## How to build

```shell
docker build --platform linux/amd64 --no-cache --progress plain .
```

## Tools to setup Development Environments using Containers

### Local

- [Docker Desktop](https://www.docker.com/products/docker-desktop/).

or Visual Studio Code|Github [`devcontainer.json`](https://containers.dev/implementors/json_reference/) files.

- [devcontainers cli](https://github.com/devcontainers/cli).

- Visual Studio Code extension called [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers).

### Cloud

- [Codespaces](https://github.com/features/codespaces)

- [Gitpod](https://www.gitpod.io/)
