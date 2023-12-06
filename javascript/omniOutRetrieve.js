var async = require('async');
var path = require('path');

module.exports = function(vlocity, currentContextData, jobInfo, callback) {

    var query = vlocity.omnistudio.updateQuery('Select %vlocity_namespace%__Type__c, %vlocity_namespace%__Language__c, %vlocity_namespace%__SubType__c from %vlocity_namespace%__OmniScript__c WHERE %vlocity_namespace%__IsActive__c = true AND %vlocity_namespace%__IsProcedure__c = false').replace(/%vlocity_namespace%/g,  vlocity.namespace);

    vlocity.jsForceConnection.query(query, function(err, result) {
        if (err) { return console.error(err); }
        async.eachSeries(result.records, function(record, seriesCallback) {

            var body = {
                sClassName: 'Vlocity BuildJSONWithPrefill',
                sType: record[vlocity.namespace + '__Type__c'] || record['Type'], 
                sSubType: record[vlocity.namespace + '__SubType__c'] || record['SubType'],
                sLang: record[vlocity.namespace + '__Language__c'] || record['Language']
            };

            vlocity.jsForceConnection.apex.post('/' + vlocity.namespace + '/v1/GenericInvoke/', body, function(err, prefilledJson) {
                if (err) { return console.error(err); }

                if (!vlocity.isOmniStudioInstalled && (!record[vlocity.namespace + '__Type__c'] || !record[vlocity.namespace + '__SubType__c'] ||  !record[vlocity.namespace + '__Language__c']) || 
                    vlocity.isOmniStudioInstalled && (! record['Type'] || ! record['SubType'] ||  ! record['Language'])
                ) return;

                var filename = vlocity.isOmniStudioInstalled ? (record['Type'] + record['SubType'] + record['Language']) : record[vlocity.namespace + '__Type__c']+record[vlocity.namespace + '__SubType__c']+record[vlocity.namespace + '__Language__c'];
                vlocity.datapacksexpand.targetPath = jobInfo.projectPath + '/' + jobInfo.expansionPath;
                var file = vlocity.datapacksexpand.writeFile('OmniOut', 'OmniOut', filename, 'json', prefilledJson, false);

                VlocityUtils.success('Created file:', path.join(vlocity.datapacksexpand.targetPath, 'OmniOut', 'OmniOut', filename));
                seriesCallback();
            }, function(err, result) {
                seriesCallback();
            });
        }, function(err, result) {
            callback();
        });
    });
};
