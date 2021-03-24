const async = require('async');
const path = require('path');

/**
 * Download off-platform LWC OmniScript
 * @param {*} vlocity 
 * @param {*} currentContextData 
 * @param {*} jobInfo 
 * @param {*} callback 
 */
module.exports = async function(vlocity, currentContextData, jobInfo, callback) {
    let listOfCustomLwc = [];

    if(jobInfo.queries.length > 0) {
        for (const element of jobInfo.queries) {
            if(element.VlocityDataPackType === 'OmniScript') {
                var query = element.query.replace(/%vlocity_namespace%/g,  vlocity.namespace);
            }
        }
    }
    

    vlocity.jsForceConnection.query(query, function(err, result) {
        if (err) { return console.error(err); }
        async.eachSeries(result.records, function(record, seriesCallback) {

            var body = {
                sClassName: 'Vlocity BuildJSONWithPrefill',
                sType: record[vlocity.namespace + '__Type__c'], 
                sSubType: record[vlocity.namespace + '__SubType__c'],
                sLang: record[vlocity.namespace + '__Language__c']
            };

            vlocity.jsForceConnection.apex.post('/' + vlocity.namespace + '/v1/GenericInvoke/', body, async function(err, prefilledJson) {
                if (err) { return console.error(err); }

                if (!record[vlocity.namespace + '__Type__c'] || !record[vlocity.namespace + '__SubType__c'] ||  !record[vlocity.namespace + '__Language__c']) return;
                
                vlocity.datapacksexpand.targetPath = jobInfo.projectPath + '/' + jobInfo.expansionPath;

                listOfCustomLwc = await extractLwcDependencies(JSON.parse(prefilledJson) || {});

                // add the OmniScript itself
                const currentOmniScriptLwc = await fetchOmniOutContents(record[vlocity.namespace + '__Type__c']+record[vlocity.namespace + '__SubType__c']+record[vlocity.namespace + '__Language__c'], vlocity);
                const parsedOmniScriptRes = await extractSources(currentOmniScriptLwc['compositeResponse'][1]['body']['records']);
                await createFiles(parsedOmniScriptRes, vlocity, 'modules', `vlocityomniscript/${record[vlocity.namespace + '__Type__c']+record[vlocity.namespace + '__SubType__c']+record[vlocity.namespace + '__Language__c']}`);

                // add all custom LWCs as well
                for (const element of listOfCustomLwc) {
                    let retrieveLwcFile = await fetchOmniOutContents(element, vlocity);
                    let parsedSources = await extractSources(retrieveLwcFile['compositeResponse'][1]['body']['records']);
                    await createFiles(parsedSources, vlocity, 'modules', `c/${element}`);
                }

                seriesCallback();
            }, function(err, result) {
                seriesCallback();
            });
        }, function(err, result) {
            callback();
        });
    });
};

/**
 * Identify the custom LWCs being used inside the OmniScript. This is based on the OmniScript definition
 * @param {*} definition 
 * @returns 
 */
const extractLwcDependencies = async(definition) => {
    return new Promise(async (resolve, reject) => {
        let lwcList = [];

        try {
            // get all custom LWCs within step
            if(definition['children'] && definition['children'].length > 0) {
                definition['children'].forEach(child => {
                    if(child['children'] && child['children'].length > 0) {
                        child['children'].forEach(child1 => {
                            if(child1.eleArray[0].type === 'Custom Lightning Web Component') {
                                lwcList.push(child1.eleArray[0].propSetMap.lwcName)
                            }
                        });
                    }
                });
            }

            // get all mappings in script configuration
            if(definition.propSetMap && definition.propSetMap.elementTypeToLwcTemplateMapping) {
                for (const [key, value] of Object.entries(definition.propSetMap.elementTypeToLwcTemplateMapping)) {
                    lwcList.push(value);
                }
            }

            // get all lwc overrides
            if(definition['children'] && definition['children'].length > 0) {
                definition['children'].forEach(child => {
                    if(child.propSetMap && child.propSetMap.lwcComponentOverride) {
                        lwcList.push(child.propSetMap.lwcComponentOverride);
                    }
                    if(child['children'] && child['children'].length > 0) {
                        child['children'].forEach(child1 => {
                            if(child1.eleArray[0].propSetMap && child1.eleArray[0].propSetMap.lwcComponentOverride) {
                                lwcList.push(child1.eleArray[0].propSetMap.lwcComponentOverride)
                            }
                        });
                    }
                });
            }

            resolve(lwcList);
        } catch(e) {
            reject(e);
        }
    });
}

/**
 * Fetching the metadata for the given lwc name
 * @param {*} lwc 
 * @param {*} vlocity 
 * @returns 
 */
const fetchOmniOutContents = async(lwc, vlocity) => {
        const body = {
            allOrNone: true,
            compositeRequest: [
                {
                    "method": "GET",
                    "referenceId": "bundleInfo",
                    "url": `/services/data/v48.0/tooling/query?q=SELECT+Id,DeveloperName,Description+FROM+LightningComponentBundle+WHERE+DeveloperName='${lwc}'`
                },
                {
                    "method": "GET",
                    "referenceId": "bundleResources",
                    "url": "/services/data/v48.0/tooling/query?q=SELECT+Id,FilePath,Format,Source+FROM+LightningComponentResource+WHERE+LightningComponentBundleId='@{bundleInfo.records[0].Id}'"
                }
             ]
        }

        const siteUrl = vlocity.jsForceConnection.instanceUrl; 


        const request = {
            method: `POST`,
            url: `${siteUrl}/services/data/v50.0/tooling/composite`,
            body: JSON.stringify(body),
            headers: { 
                'Content-Type': 'application/json'
            },
        };

        return await vlocity.jsForceConnection.request(request);
}

/**
 * 
 * @param {*} items 
 * @returns 
 */
const extractSources = async (items) => {
    return new Promise(async (resolve, reject) => {

        let parsed = [];

        if(items.length > 0) {
            items.map(async (i) => {
                let path = i['FilePath'].replace('lwc', '');

                if(path.startsWith("dc")) {
                    path = 'c' + path;
                } else {
                    path = 'vlocityomniscript' + path;
                }

                if (i['Source'] === "(hidden)") {
                    console.log('Skipping path');
                } else {
                    parsed[path] = await parseSource(i['Source']);
                }
            });
        }

        resolve(parsed);
    });
}

/**
 * 
 * @param {*} source 
 * @returns 
 */
const parseSource = async (source) => {
    return new Promise((resolve, reject) => {
        /* Rename imports vlocity_cmt -> c */
        source = source.replace(new RegExp('vlocity_cmt', 'g'), 'c');

        resolve(source);
    });
}

/**
 * 
 * @param {*} files 
 * @param {*} vlocity 
 * @param {*} parentFolder 
 * @param {*} childFolder 
 */
const createFiles = async(files, vlocity, parentFolder = 'modules', childFolder = 'vlocityomniscript') => {
    try {
       for (const key in files) {
           if (files.hasOwnProperty(key)) {
                console.log(`${key}: `);

                const filename = path.basename(key) || null;
                const fileTypeName = filename.split('.') || null;

                if(fileTypeName[1] !== 'xml' && fileTypeName[1] !== 'js-meta') {
                    await vlocity.datapacksexpand.writeFile(parentFolder, childFolder, fileTypeName[0], fileTypeName[1], files[key], false);
                }
            }
        }
    } catch (error) {
        console.error(`Got an error trying to write to a file: ${error.message}`);
    }
}