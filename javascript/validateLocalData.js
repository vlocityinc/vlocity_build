module.exports = function(vlocity, currentContextData, jobInfo, callback) {
    var ignoreTypes = ['%vlocity_namespace%__VlocityCard__c'];

    var allGlobalKeysBySObjectType = {};

    (currentContextData || []).forEach(function(currentData) {

        if (currentData) {

            if (currentData.VlocityDataPackData) {
                var dataField = vlocity.datapacksutils.getDataField(currentData);
        
                if (dataField) {
                    processSObjectData(currentData.VlocityDataPackData[dataField], currentData.VlocityDataPackKey);
                }
            } 
        }
    });

    callback();

    function processSObjectData(currentData, dataPackKey) {

        if (currentData) {  
            if (Array.isArray(currentData)) {
                currentData.forEach(function(childData) {
                    processSObjectData(childData, dataPackKey);
                });
            } else if (typeof currentData === 'object') {

                if (currentData.VlocityDataPackType == 'SObject') {
                    if (ignoreTypes.indexOf(currentData.VlocityRecordSObjectType) == -1 && !vlocity.datapacksutils.isNonUnique(null, currentData.VlocityRecordSObjectType)) {
                        validateGlobalKey(currentData, dataPackKey);
                    }
                }

                Object.keys(currentData).forEach(function(key) {
                    processSObjectData(currentData[key], dataPackKey);
                });
            }
        }
    }

    function validateGlobalKey(currentData, dataPackKey) {
        if (currentData['%vlocity_namespace%__GlobalKey__c'] === '') {
            if (jobInfo.fixLocalGlobalKeys) {
                currentData['%vlocity_namespace%__GlobalKey__c'] = vlocity.datapacksutils.guid();

                jobInfo.report.push('Adding Global Key ' + dataPackKey + ' - ' + currentData.VlocityRecordSObjectType.replace('%vlocity_namespace%__', '') + ' - ' + (currentData.Name ? currentData.Name : currentData.VlocityRecordSourceKey) + ' ' + currentData['%vlocity_namespace%__GlobalKey__c']);

            } else {
                jobInfo.hasError = true;
                jobInfo.errors.push(dataPackKey + ' - ' + currentData.VlocityRecordSObjectType.replace('%vlocity_namespace%__', '') + ' - ' + (currentData.Name ? currentData.Name : currentData.VlocityRecordSourceKey) + ' - Missing Global Key');
            }
        } else if (currentData['%vlocity_namespace%__GlobalKey__c']) {
            if (!allGlobalKeysBySObjectType[currentData.VlocityRecordSObjectType]) {
                allGlobalKeysBySObjectType[currentData.VlocityRecordSObjectType] = [];
            }

            if (allGlobalKeysBySObjectType[currentData.VlocityRecordSObjectType].indexOf(currentData['%vlocity_namespace%__GlobalKey__c']) != -1) {
                if (jobInfo.fixLocalGlobalKeys) {

                    var newKey = vlocity.datapacksutils.guid();

                    jobInfo.report.push('Changing Global Key ' + dataPackKey + ' - ' + currentData.VlocityRecordSObjectType.replace('%vlocity_namespace%__', '') + ' - ' + (currentData.Name ? currentData.Name : currentData.VlocityRecordSourceKey) + ' ' + currentData['%vlocity_namespace%__GlobalKey__c'] + ' => ' + newKey);

                    currentData['%vlocity_namespace%__GlobalKey__c'] = newKey;
                } else {
                    jobInfo.hasError = true;
                    jobInfo.errors.push(dataPackKey + ' - ' + currentData.VlocityRecordSObjectType.replace('%vlocity_namespace%__', '') + ' - ' + (currentData.Name ? currentData.Name : currentData.VlocityRecordSourceKey) + ' - Duplicate Global Key - ' + currentData['%vlocity_namespace%__GlobalKey__c']);
                }
            } else {
                allGlobalKeysBySObjectType[currentData.VlocityRecordSObjectType].push(currentData['%vlocity_namespace%__GlobalKey__c']);
            }
        }
    }
};