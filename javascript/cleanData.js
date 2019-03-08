var async = require('async');

module.exports = async function(vlocity, currentContextData, jobInfo, callback) {
    // Delete
    var healthCheckItems = {
        Delete: [
            'SELECT Id FROM vlocity_namespace__ProductChildItem__c where vlocity_namespace__ParentProductId__c = null OR (vlocity_namespace__ChildProductId__c = null AND vlocity_namespace__IsRootProductChildItem__c = false)',
            //'SELECT Id FROM vlocity_namespace__OverrideDefinition__c where (vlocity_namespace__OverriddenProductChildItemId__c = null AND vlocity_namespace__OverridingProductChildItemId__c != null) OR (vlocity_namespace__OverriddenProductChildItemId__c != null AND vlocity_namespace__OverridingProductChildItemId__c = null) OR (vlocity_namespace__OverriddenAttributeAssignmentId__c = null AND vlocity_namespace__OverridingAttributeAssignmentId__c != null) OR (vlocity_namespace__OverriddenAttributeAssignmentId__c != null AND vlocity_namespace__OverridingAttributeAssignmentId__c = null) OR (vlocity_namespace__OverridingPriceListEntryId__c = null AND vlocity_namespace__OverriddenPriceListEntryId__c != null) OR (vlocity_namespace__OverridingPriceListEntryId__c != null AND vlocity_namespace__OverriddenPriceListEntryId__c = null) OR ( vlocity_namespace__OverriddenProductChildItemId__c = null AND vlocity_namespace__OverridingProductChildItemId__c = null AND vlocity_namespace__OverriddenAttributeAssignmentId__c = null AND vlocity_namespace__OverridingAttributeAssignmentId__c = null AND vlocity_namespace__OverridingPriceListEntryId__c = null AND vlocity_namespace__OverriddenPriceListEntryId__c = null)',
            'SELECT Id FROM vlocity_namespace__AttributeAssignment__c where vlocity_namespace__AttributeId__c = null',
            'SELECT Id FROM vlocity_namespace__PriceListEntry__c where vlocity_namespace__ProductId__c = null AND vlocity_namespace__PromotionId__c = null',
            'SELECT Id FROM vlocity_namespace__VqMachineResource__c where vlocity_namespace__VqResourceId__c = null OR vlocity_namespace__VqMachineId__c = null',
            'SELECT Id FROM vlocity_namespace__VlocityDataPack__c where vlocity_namespace__Status__c in (\'Ready\',\'InProgress\',\'Complete\') AND CreatedDate != TODAY',
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
                            if (rets[i].success) {
                                VlocityUtils.log(item.type, 'Success', rets[i].id);
                            } else {
                                VlocityUtils.error(item.type, 'Error', rets[i]);
                            }
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
            }

            resolve(item);
        });
    }
}