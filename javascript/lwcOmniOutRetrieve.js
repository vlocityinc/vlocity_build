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
    let processedOmniScripts = new Set(); // Track processed OmniScripts to avoid duplicates

    if(jobInfo.queries.length > 0) {
        for (const element of jobInfo.queries) {
            if(element.VlocityDataPackType === 'OmniScript') {
                var query = vlocity.omnistudio.updateQuery(element.query).replace(/%vlocity_namespace%/g,  vlocity.namespace);
            }
        }
    }
    jobInfo.currentStatus = jobInfo.currentStatus || {};

    try {
        const result = await vlocity.jsForceConnection.query(query);
        
        await async.eachSeries(result.records, async function(record) {
            try {
                // Use the new jsforce v3 approach for Apex REST calls
                const apexUrl = '/services/apexrest/' + vlocity.namespace + '/v1/GenericInvoke/';
                const prefilledJson = await vlocity.jsForceConnection.request({
                    method: 'POST',
                    url: apexUrl,
                    body: JSON.stringify({
                        sClassName: 'Vlocity BuildJSONWithPrefill',
                        sType: record[vlocity.namespace + '__Type__c'] || record['Type'],
                        sSubType: record[vlocity.namespace + '__SubType__c'] || record['SubType'],
                        sLang: record[vlocity.namespace + '__Language__c'] || record['Language']
                    }),
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                if (!vlocity.isOmniStudioInstalled && (!record[vlocity.namespace + '__Type__c'] || !record[vlocity.namespace + '__SubType__c'] ||  !record[vlocity.namespace + '__Language__c']) || 
                    vlocity.isOmniStudioInstalled && (! record['Type'] || ! record['SubType'] ||  !record['Language'])
                ) {
                    return;
                }
                
                let lwcname = vlocity.isOmniStudioInstalled ? (record['Type'] + record['SubType'] + record['Language']) : record[vlocity.namespace + '__Type__c']+record[vlocity.namespace + '__SubType__c']+record[vlocity.namespace + '__Language__c'];
                
                // Skip if this OmniScript has already been processed
                if (processedOmniScripts.has(lwcname)) {
                    return;
                }
                
                vlocity.datapacksexpand.targetPath = jobInfo.projectPath + '/' + jobInfo.expansionPath;

                listOfCustomLwc = await extractLwcDependencies(JSON.parse(prefilledJson) || {});

                // add the OmniScript itself
                const currentOmniScriptLwc = await fetchOmniOutContents(lwcname, vlocity);
                const parsedOmniScriptRes = await extractSources(currentOmniScriptLwc['compositeResponse'][1]['body']['records'], vlocity.namespace);
                
                await createFiles(parsedOmniScriptRes, vlocity, 'modules', `vlocityomniscript/${lwcname}`);

                // add all custom LWCs as well
                for (const element of listOfCustomLwc) {
                    let retrieveLwcFile = await fetchOmniOutContents(element, vlocity);
                    let parsedSources = await extractSources(retrieveLwcFile['compositeResponse'][1]['body']['records'], vlocity.namespace);
                    await createFiles(parsedSources, vlocity, 'modules', `c/${element}`);
                }
                if (Object.keys(parsedOmniScriptRes).length > 0) {
                    jobInfo.currentStatus[`${lwcname}`] = 'Success';
                }
                
                // Mark this OmniScript as processed
                processedOmniScripts.add(lwcname);

            } catch (err) {
                VlocityUtils.error('Error processing OmniScript:', err);
            }
        });

        callback();
    } catch (err) {
        VlocityUtils.error('Query error:', err);
        callback(err);
    }
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
 * @param {*} namespace 
 * @returns 
 */
const extractSources = async (items, namespace) => {
    return new Promise(async (resolve, reject) => {

        let parsed = [];

        if(items?.length > 0) {
            for (const i of items) {
                let path = i['FilePath'].replace('lwc', '');

                if(path.startsWith("dc")) {
                    path = 'c' + path;
                } else {
                    path = 'vlocityomniscript' + path;
                }

                if (i['Source'] === "(hidden)") {
                    VlocityUtils.log('Skipping path');
                } else {
                    parsed[path] = await parseSource(i['Source'], namespace);
                }
            }
        }

        resolve(parsed);
    });
}

/**
 * 
 * @param {*} source 
 * @param {*} namespace 
 * @returns 
 */
const parseSource = async (source, namespace) => {
    return new Promise((resolve, reject) => {
        /* Rename imports like vlocity_cmt -> c */
        source = source.replace(new RegExp(namespace, 'g'), 'c');

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
                VlocityUtils.log(`${key}: `);

                const filename = path.basename(key) || null;
                const fileTypeName = filename.split('.') || null;

                if(fileTypeName[1] !== 'xml' && fileTypeName[1] !== 'js-meta') {
                    await vlocity.datapacksexpand.writeFile(parentFolder, childFolder, fileTypeName[0], fileTypeName[1], files[key], false);
                }
            }
        }
    } catch (error) {
        VlocityUtils.error(`Got an error trying to write to a file: ${error.message}`);
    }
}
