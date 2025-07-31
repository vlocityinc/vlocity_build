const async = require('async');
const path = require('path');

/**
 * Download off-platform OmniScript
 * @param {*} vlocity 
 * @param {*} currentContextData 
 * @param {*} jobInfo 
 * @param {*} callback 
 */
module.exports = async function(vlocity, currentContextData, jobInfo, callback) {
    let query = vlocity.omnistudio.updateQuery('Select %vlocity_namespace%__Type__c, %vlocity_namespace%__Language__c, %vlocity_namespace%__SubType__c from %vlocity_namespace%__OmniScript__c WHERE %vlocity_namespace%__IsActive__c = true AND %vlocity_namespace%__IsProcedure__c = false').replace(/%vlocity_namespace%/g,  vlocity.namespace);
    let processedOmniScripts = new Set(); // Track processed OmniScripts to avoid duplicates

    if(jobInfo.queries.length > 0) {
        for (const element of jobInfo.queries) {
            if(element.VlocityDataPackType === 'OmniScript') {
                query = vlocity.omnistudio.updateQuery(element.query).replace(/%vlocity_namespace%/g,  vlocity.namespace);
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

                const filename = vlocity.isOmniStudioInstalled ? (record['Type'] + record['SubType'] + record['Language']) : record[vlocity.namespace + '__Type__c']+record[vlocity.namespace + '__SubType__c']+record[vlocity.namespace + '__Language__c'];
                
                // Skip if this OmniScript has already been processed
                if (processedOmniScripts.has(filename)) {
                    return;
                }
                
                vlocity.datapacksexpand.targetPath = jobInfo.projectPath + '/' + jobInfo.expansionPath;
                const file = vlocity.datapacksexpand.writeFile('OmniOut', 'OmniOut', filename, 'json', prefilledJson, false);

                VlocityUtils.success('Created file:', path.join(vlocity.datapacksexpand.targetPath, 'OmniOut', 'OmniOut', filename));
                jobInfo.currentStatus[`${filename}`] = 'Success';
                
                // Mark this OmniScript as processed
                processedOmniScripts.add(filename);

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
