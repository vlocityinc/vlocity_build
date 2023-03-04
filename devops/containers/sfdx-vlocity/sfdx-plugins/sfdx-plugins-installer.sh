#!/bin/bash

for row in $(cat package.json | jq -c '.devDependencies | to_entries | .[]'); do
  name=$(echo $row | jq -r '.key')
  # sfdx plugins:install does not work with ~ and ^ https://github.com/forcedotcom/cli/issues/1966
  version=$(echo $row | jq -r '.value' | cut -d "~" -f2 | cut -d "^" -f2)
  echo "Installing $name@$version"
  echo 'y' | sfdx plugins:install $name@$version
done