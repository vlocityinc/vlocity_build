var async = require('async');

module.exports = function(vlocity, currentContextData, jobInfo, callback) {
    // Delete
    var healthCheckItems = {
        Delete: [
            'SELECT Id FROM vlocity_namespace__AttributeAssignment__c where vlocity_namespace__AttributeId__c = null',
            'SELECT Id FROM vlocity_namespace__ProductChildItem__c where vlocity_namespace__ParentProductId__c = null OR (vlocity_namespace__ChildProductId__c = null AND vlocity_namespace__IsRootProductChildItem__c = false)',
            'SELECT Id FROM vlocity_namespace__PriceListEntry__c where vlocity_namespace__ProductId__c = null AND vlocity_namespace__PromotionId__c = null',
            'SELECT Id FROM vlocity_namespace__VqMachineResource__c where vlocity_namespace__VqResourceId__c = null OR vlocity_namespace__VqMachineId__c = null',
            'SELECT Id FROM vlocity_namespace__VlocityDataPack__c where vlocity_namespace__Status__c in (\'Ready\',\'InProgress\',\'Complete\') AND CreatedDate != TODAY',
            'SELECT Id FROM vlocity_namespace__OverrideDefinition__c WHERE NOT ((vlocity_namespace__OverridingAttributeAssignmentId__c != null AND vlocity_namespace__OverriddenAttributeAssignmentId__c != null) OR (vlocity_namespace__OverridingProductChildItemId__c != null AND vlocity_namespace__OverriddenProductChildItemId__c != null) OR (vlocity_namespace__OverridingPriceListEntryId__c != null AND vlocity_namespace__OverriddenPriceListEntryId__c != null))',
            'SELECT Id, Name, vlocity_namespace__AttributeId__c, vlocity_namespace__IsOverride__c, vlocity_namespace__ObjectId__c, vlocity_namespace__GlobalKey__c ,vlocity_namespace__Value__c FROM vlocity_namespace__AttributeAssignment__c WHERE vlocity_namespace__IsOverride__c = true AND id NOT IN (SELECT vlocity_namespace__OverridingAttributeAssignmentId__c FROM vlocity_namespace__OverrideDefinition__c)',
            'SELECT Id, vlocity_namespace__ParentProductId__c,vlocity_namespace__ChildProductId__c,vlocity_namespace__IsOverride__c FROM vlocity_namespace__ProductChildItem__c WHERE vlocity_namespace__IsOverride__c = true AND id NOT IN (SELECT vlocity_namespace__OverridingProductChildItemId__c FROM vlocity_namespace__OverrideDefinition__c)'
        ],
        CheckDuplicates: [
            'SELECT vlocity_namespace__OverridingAttributeAssignmentId__c, vlocity_namespace__OverriddenAttributeAssignmentId__c, count(id) FROM vlocity_namespace__OverrideDefinition__c GROUP BY vlocity_namespace__OverridingAttributeAssignmentId__c, vlocity_namespace__OverriddenAttributeAssignmentId__c HAVING count(id) > 1 AND vlocity_namespace__OverridingAttributeAssignmentId__c != null AND vlocity_namespace__OverriddenAttributeAssignmentId__c != null',
            'SELECT vlocity_namespace__OverridingProductChildItemId__c, vlocity_namespace__OverriddenProductChildItemId__c, count(id) FROM vlocity_namespace__OverrideDefinition__c GROUP BY vlocity_namespace__OverridingProductChildItemId__c, vlocity_namespace__OverriddenProductChildItemId__c HAVING count(id) > 1 AND vlocity_namespace__OverridingProductChildItemId__c != null AND vlocity_namespace__OverriddenProductChildItemId__c != null',
            'SELECT vlocity_namespace__OverridingPriceListEntryId__c, vlocity_namespace__OverriddenPriceListEntryId__c, count(id) FROM vlocity_namespace__OverrideDefinition__c GROUP BY vlocity_namespace__OverridingPriceListEntryId__c, vlocity_namespace__OverriddenPriceListEntryId__c HAVING count(id) > 1 AND vlocity_namespace__OverridingPriceListEntryId__c != null AND vlocity_namespace__OverriddenPriceListEntryId__c != null',
            'SELECT vlocity_namespace__AttributeId__c, vlocity_namespace__ObjectId__c, count(id)FROM vlocity_namespace__AttributeAssignment__c WHERE  vlocity_namespace__IsOverride__c = false GROUP BY vlocity_namespace__AttributeId__c, vlocity_namespace__ObjectId__c HAVING count(id) > 1 AND vlocity_namespace__AttributeId__c != null AND vlocity_namespace__ObjectId__c != null',
            'SELECT vlocity_namespace__ParentProductId__c,vlocity_namespace__ChildProductId__c, count(id) FROM vlocity_namespace__ProductChildItem__c WHERE  vlocity_namespace__IsOverride__c = false GROUP BY vlocity_namespace__ParentProductId__c, vlocity_namespace__ChildProductId__c HAVING count(id) > 1 AND vlocity_namespace__ParentProductId__c != null AND vlocity_namespace__ChildProductId__c != null'
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
                
                if (record.attributes.type == 'AggregateResult') {
                    var field = item.query.substring(item.query.indexOf('SELECT') + 7, item.query.indexOf(','));
                    jobInfo.report.push(item.query.substring(item.query.indexOf('FROM') + 5, item.query.indexOf('GROUP')) + 'found duplicates for ' + field + ': ' + record[field]);
                } else {
                    item.records.push(record);
                }
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