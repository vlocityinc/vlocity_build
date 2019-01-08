var async = require('async');

module.exports = function(vlocity, currentContextData, jobInfo, callback) {

    // Add Global Key
    // Delete
    var healthCheckItems = {
        AddGlobalKey: [
            'SELECT Id FROM vlocity_namespace__AttributeAssignment__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__Catalog__c WHERE vlocity_namespace__GlobalKey__c = null', 
            'SELECT Id FROM vlocity_namespace__ContextAction__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__ContextDimension__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__ContextMapping__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__ContextScope__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__EntityFilter__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__ObjectClass__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__ObjectElement__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__ObjectFieldAttribute__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__ObjectLayout__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__ObjectRuleAssignment__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__ObjectSection__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__OrchestrationDependencyDefinition__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__OrchestrationItemDefinition__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__OrchestrationPlanDefinition__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__Picklist__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__PicklistValue__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__PriceListEntry__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__PricingElement__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__PricingVariable__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM Product2 WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__ProductChildItem__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__ProductConfigurationProcedure__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__ProductRelationship__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__Promotion__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__Rule__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__TimePlan__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__TimePolicy__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__UIFacet__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__UISection__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__VlocityAttachment__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__VlocityFunctionArgument__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__VlocityFunction__c WHERE vlocity_namespace__GlobalKey__c = null',
            'SELECT Id FROM vlocity_namespace__VlocityUILayout__c WHERE vlocity_namespace__GlobalKey__c = null'
        ]
    }; 

    var allHealthItems = [];

    Object.keys(healthCheckItems).forEach(function(type) {
        healthCheckItems[type].forEach(function(query) {
            allHealthItems.push({ type: type, query: query });
        });
    });

    async.each(allHealthItems, function(item, seriesCallback) {
        VlocityUtils.success(item.type, item.query);

        query(item)
        .then(processRecords)
        .then(runBatch)
        .then(function(item) {
            VlocityUtils.success(item.type, item.query);
            seriesCallback();
        })
        .catch(function(err){
            VlocityUtils.error('Error', err);
            seriesCallback();
        });

    }, function(err, result) {

        if (jobInfo.report.length == 0) {
            jobInfo.report.push('No Issues Found');
        }

        callback();
    });

    function query(item) {
        return new Promise(function(resolve, reject) {

            item.records = [];

            item.query = item.query.replace(/vlocity_namespace/g, vlocity.namespace);
            
            var thisQuery = vlocity.jsForceConnection.query(item.query)
            .on('record', function(record) {
                item.records.push(record);
            })
            .on('end', function() {
                VlocityUtils.success('Running Query', item.query);
                VlocityUtils.success('Records', thisQuery.totalFetched);
                resolve(item);
            })
            .on('error', function(err) {
                VlocityUtils.success('Running Query', item.query);
                VlocityUtils.error('Query Error', err);
                resolve(item);
            })
            .run({ autoFetch : true, maxFetch : 1000000 });
        });
    }

    function runBatch(item) {
        return new Promise(function(resolve, reject) {    

            if (item.records && item.records.length > 0) {

                vlocity.jsForceConnection.bulk.createJob(item.records[0].attributes.type, item.batchType).createBatch()
                .on('error', function(batchInfo) {
                    VlocityUtils.error('Error', batchInfo);
                    reject();
                })
                .on('queue', function(batchInfo) {
                    this.poll(1000, 20000);
                })
                .on('response', function(rets) {
                    if (rets) {
                        for (var i = 0; i < rets.length; i += 1) {
                            VlocityUtils.log(item.type, rets[i].success ? 'Success' : 'error', rets[i].id);
                        }
                    }

                    resolve(item);
                })
                .execute(item.records);
            } else {
                resolve(item);
            }
        });
    }

    function processRecords(item) {
        return new Promise(function(resolve, reject) {

            if (item.type == 'Delete') {
                item.batchType = 'delete';
            } else if (item.type == 'AddGlobalKey' || item.type == 'CheckGlobalKey') {
                item.batchType = 'update';

                item.records.forEach(function(record) {
                    
                    var message = 'Added ' + item.records.length + ' GlobalKeys for ' + record.attributes.type;

                    if (jobInfo.report.indexOf(message) == -1) {
                        jobInfo.report.push(message);
                    }

                    VlocityUtils.error('Adding GlobalKey', record.attributes.type, record.Id);
                    record[vlocity.namespacePrefix + 'GlobalKey__c'] = vlocity.datapacksutils.guid();
                });
            } 

            resolve(item);
        });
    }
}
