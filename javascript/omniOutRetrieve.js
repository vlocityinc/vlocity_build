var async = require('async');
var path = require('path');

module.exports = function(vlocity, currentContextData, jobInfo, callback) {

    var query = 'Select vlocity_namespace__Type__c, vlocity_namespace__Language__c, vlocity_namespace__SubType__c from vlocity_namespace__OmniScript__c WHERE vlocity_namespace__IsActive__c = true AND vlocity_namespace__IsProcedure__c = false'.replace(/vlocity_namespace/g,  vlocity.namespace);

    vlocity.jsForceConnection.query(query, function(err, result) {
        if (err) { return console.error(err); }
        async.eachSeries(result.records, function(record, seriesCallback) {

            var body = {
                sClassName: 'Vlocity BuildJSONWithPrefill',
                sType: record[vlocity.namespace + '__Type__c'], 
                sSubType: record[vlocity.namespace + '__SubType__c'],
                sLang: record[vlocity.namespace + '__Language__c']
            };

            vlocity.jsForceConnection.apex.post('/' + vlocity.namespace + '/v1/GenericInvoke/', body, function(err, prefilledJson) {
                if (err) { return console.error(err); }

                if (!record[vlocity.namespace + '__Type__c'] || !record[vlocity.namespace + '__SubType__c'] ||  !record[vlocity.namespace + '__Language__c']) return;

                var filename = record[vlocity.namespace + '__Type__c'] + '_' + record[vlocity.namespace + '__SubType__c'] + '_' + record[vlocity.namespace + '__Language__c'];

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
