#!/usr/bin/env bash 
set -e

./codeship/decryptFiles.sh

sfdx

SF_AUTH_ORG=`sf org login sfdx-url --sfdx-url-file codeship/unencrypted_files/test.json --json`
SF_USERNAME=`echo $SF_AUTH_ORG | jq -r '. | .result.username'`

sf force alias set VB_TEST_ORG=$SF_USERNAME

npm i

npm run-script unitTest

npm link

vlocity -sfdx.username $SF_USERNAME runTestJob --verbose

echo 'Running JSON Jobs - Takes up to 10 minutes with no output'

# Must return a JSON with a result
vlocity -sfdx.username $SF_USERNAME runTestJob --json | jq .


#npm run-script build

#./dist/vlocity-linux-x64 -sfdx.username $SF_USERNAME --nojob packExport -key VlocityCard/datapacktest-card

#./dist/vlocity-linux-x64 -sfdx.username $SF_USERNAME --nojob packGetAllAvailableExports --json | jq .

#./dist/vlocity-linux-x64 -sfdx.username $SF_USERNAME --nojob installVlocityInitial

#./dist/vlocity-linux-x64 -sfdx.username $SF_USERNAME --nojob refreshVlocityBase

#./dist/vlocity-linux-x64 -sfdx.username $SF_USERNAME -projectPath "vlocity-temp" --nojob packExport -key VlocityCard/datapacktest-card

#./dist/vlocity-linux-x64 -sfdx.username $SF_USERNAME -projectPath "vlocity-temp" --nojob packDeploy -key VlocityCard/datapacktest-card --json | jq .
