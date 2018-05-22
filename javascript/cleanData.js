var async = require('async');

module.exports = function(vlocity, currentContextData, jobInfo, callback) {

    var errorLog = [];

    vlocity.checkLogin(function() {

        // Add Global Key
        // Delete
        var healthCheckItems = {
            Delete: [
                'SELECT Id FROM vlocity_namespace__ProductChildItem__c where vlocity_namespace__ParentProductId__c = null',
                'SELECT Id FROM vlocity_namespace__AttributeAssignment__c where vlocity_namespace__AttributeId__c = null',
                'SELECT Id FROM vlocity_namespace__PriceListEntry__c where vlocity_namespace__ProductId__c = null',
                'SELECT Id FROM vlocity_namespace__VqMachineResource__c where vlocity_namespace__VqResourceId__c = null OR vlocity_namespace__VqMachineId__c = null',
                'SELECT Id FROM vlocity_namespace__VlocityDataPack__c where vlocity_namespace__Status__c in (\'Ready\',\'InProgress\',\'Complete\') AND CreatedDate != TODAY'
            ],
            AddGlobalKey: [
                'SELECT Id FROM vlocity_namespace__AttributeAssignment__c WHERE vlocity_namespace__GlobalKey__c = null', 
                'SELECT Id FROM vlocity_namespace__ContextAction__c WHERE vlocity_namespace__GlobalKey__c = null',
                'SELECT Id FROM vlocity_namespace__ContextDimension__c WHERE vlocity_namespace__GlobalKey__c = null',
                'SELECT Id FROM vlocity_namespace__ContextMapping__c WHERE vlocity_namespace__GlobalKey__c = null',
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
            ],
            CheckDuplicates: [
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__AttributeAssignment__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1', 
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__ContextAction__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__ContextDimension__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__ContextMapping__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__ContextScope__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__EntityFilter__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__ObjectClass__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__ObjectElement__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__ObjectFacet__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__ObjectFieldAttribute__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__ObjectLayout__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__ObjectRuleAssignment__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__ObjectSection__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__OrchestrationDependencyDefinition__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__OrchestrationItemDefinition__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__OrchestrationPlanDefinition__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__Picklist__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__PicklistValue__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__PriceListEntry__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__PricingElement__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM Product2 GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__ProductChildItem__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__ProductConfigurationProcedure__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__ProductRelationship__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__Promotion__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__Rule__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__TimePlan__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__TimePolicy__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__UIFacet__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__UISection__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__VlocityFunctionArgument__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT vlocity_namespace__GlobalKey__c, count(Id) FROM vlocity_namespace__VlocityFunction__c GROUP BY vlocity_namespace__GlobalKey__c HAVING count(Id) > 1',
                'SELECT Name, count(Id) FROM vlocity_namespace__InterfaceImplementation__c GROUP BY Name HAVING count(Id) > 1'
            ]
        }; 

        var allHealthItems = [];

        Object.keys(healthCheckItems).forEach(function(type) {
            healthCheckItems[type].forEach(function(query) {
                allHealthItems.push({ type: type, query: query });
            });
        });

        async.eachSeries(allHealthItems, function(item, seriesCallback) {
            VlocityUtils.success(item.type, item.query);

            query(item)
            .then(processRecords)
            .then(runBatch)
            .then(function(item) {
                VlocityUtils.success(item.type, item.query);
                seriesCallback();
            })
            .catch(function(err){
                VlocityUtils.error('Error', err.stack);
                seriesCallback();
            });

        }, function(err, result) {

            errorLog.forEach(function(errLog) {
                VlocityUtils.error('Error', errLog);
            });
            
            callback();
        });
    });

    function query(item) {
        return new Promise(function(resolve, reject) {

            item.records = [];

            item.query = item.query.replace(/vlocity_namespace/g, vlocity.namespace);

            VlocityUtils.success('Running Query', item.query);
            var thisQuery = vlocity.jsForceConnection.query(item.query)
            .on('record', function(record) {
                if (record.attributes.type == 'AggregateResult') {

                    var sobjectType = item.query.substring(item.query.indexOf('FROM') + 5, item.query.indexOf('GROUP'));
                    var field = item.query.substring(item.query.indexOf('BY') + 3, item.query.indexOf('HAVING')-1);
                    errorLog.push(item.query.substring(item.query.indexOf('FROM') + 5, item.query.indexOf('GROUP')) + 'found duplicates for ' + field + ': ' + record[field]);
                } else {
                    item.records.push(record);
                }
            })
            .on('end', function() {
                VlocityUtils.success('Records', thisQuery.totalFetched);
                resolve(item);
            })
            .on('error', function(err) {
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
                    VlocityUtils.success((item.type == 'AddGlobalKey' ? 'Adding' : 'Changing') + ' GlobalKey', record.Id);
                    record[vlocity.namespacePrefix + 'GlobalKey__c'] = vlocity.datapacksutils.guid();
                });
            } 

            resolve(item);
        });
    }


}
