var async = require('async');

module.exports = function(vlocity, currentContextData, jobInfo, callback) {

    vlocity.checkLogin(function() {

        // Add Global Key
        // Delete
        var healthCheckItems = {
            Delete: [
                'SELECT Id FROM vlocity_namespace__ProductChildItem__c where vlocity_namespace__ParentProductId__c = null',
                'SELECT Id FROM vlocity_namespace__AttributeAssignment__c where vlocity_namespace__AttributeId__c = null',
                'SELECT Id FROM vlocity_namespace__PriceListEntry__c where vlocity_namespace__ProductId__c = null',
                'SELECT Id FROM vlocity_namespace__VqMachineResource__c where vlocity_namespace__VqResourceId__c = null OR vlocity_namespace__VqMachineId__c = null'
            ],
            AddGlobalKey: [ 
                'SELECT Id FROM vlocity_namespace__ContextAction__c WHERE vlocity_namespace__GlobalKey__c = null',
                'SELECT Id FROM vlocity_namespace__ContextDimension__c WHERE vlocity_namespace__GlobalKey__c = null',
                'SELECT Id FROM vlocity_namespace__ContextScope__c WHERE vlocity_namespace__GlobalKey__c = null',
                'SELECT Id FROM vlocity_namespace__EntityFilter__c WHERE vlocity_namespace__GlobalKey__c = null',
                'SELECT Id FROM vlocity_namespace__ObjectClass__c WHERE vlocity_namespace__GlobalKey__c = null',
                'SELECT Id FROM vlocity_namespace__ObjectElement__c WHERE vlocity_namespace__GlobalKey__c = null',
                'SELECT Id FROM vlocity_namespace__ObjectFacet__c WHERE vlocity_namespace__GlobalKey__c = null',
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
                'SELECT Id FROM vlocity_namespace__VlocityFunctionArgument__c WHERE vlocity_namespace__GlobalKey__c = null',
                'SELECT Id FROM vlocity_namespace__VlocityFunction__c WHERE vlocity_namespace__GlobalKey__c = null'
            ]
        }; 

        var allHealthItems = [];

        Object.keys(healthCheckItems).forEach(function(type) {
            healthCheckItems[type].forEach(function(query) {
                allHealthItems.push({ type: type, query: query });
            });
        });

        async.eachSeries(allHealthItems, function(item, seriesCallback) {
            VlocityUtils.log('\x1b[36m', item.type, '>>', '\x1b[0m', item.query);

            query(item)
            .then(processRecords)
            .then(runBatch)
            .then(function(item) {
                VlocityUtils.log(item.type, 'Finished', item.query);
                seriesCallback();
            })
            .catch(function(err){
                VlocityUtils.log('\x1b[31m', 'Error >>', '\x1b[0m', err.stack);
                seriesCallback();
            });

        }, function(err, result) {
            
            callback();
        });
    });

    function query(item) {
        return new Promise(function(resolve, reject) {

            item.records = [];

            item.query = item.query.replace(/vlocity_namespace/g, vlocity.namespace);

            VlocityUtils.log('\x1b[36m', 'Running Query >>', '\x1b[0m', item.query);
            var thisQuery = vlocity.jsForceConnection.query(item.query)
            .on('record', function(record) {
                item.records.push(record);
            })
            .on('end', function() {
                VlocityUtils.log('\x1b[36m', 'Records >>', '\x1b[0m', thisQuery.totalFetched);
                resolve(item);
            })
            .on('error', function(err) {
                VlocityUtils.log('\x1b[31m', 'Query Error >> ', '\x1b[0m', err);
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
                    VlocityUtils.log('Error:', batchInfo);
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
            } else if (item.type == 'AddGlobalKey') {
                item.batchType = 'update';

                item.records.forEach(function(record) {
                    record[vlocity.namespacePrefix + 'GlobalKey__c'] = vlocity.datapacksutils.guid();
                });
            }

            resolve(item);
        });
    }


}
