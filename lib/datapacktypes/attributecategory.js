var AttributeCategory = module.exports = function(vlocity) {
    this.vlocity = vlocity;
};

AttributeCategory.prototype.onDeployError = async function(inputMap) {
    var jobInfo = inputMap.jobInfo;
    var dataPackWithError = inputMap.dataPack;
    var dataPacks = inputMap.dataPacks;

    if (jobInfo.autoFixDeployErrors
     && jobInfo.autoFixDeployErrors.AttributeCategoryDisplaySequence
     && dataPackWithError.VlocityDataPackMessage.includes("%vlocity_namespace%__DisplaySequence__c")) {
        VlocityUtils.report('Auto Fix Deploy Error');
        await this.handleAttributeCategoryDisplaySequence(jobInfo, dataPackWithError, dataPacks);
    }
};

AttributeCategory.prototype.handleAttributeCategoryDisplaySequence = async function(jobInfo, dataPackWithError, dataPacks) {
    var sObject = await this.vlocity.datapackserrorhandling.getSObject(dataPackWithError, jobInfo);
    var dataPack = this.vlocity.utilityservice.getDataPackData(dataPackWithError);

    var displaySequenceFieldAPIName = '%vlocity_namespace%__DisplaySequence__c';
    
    var queryString = this.vlocity.queryservice.buildSOQL(displaySequenceFieldAPIName, sObject.name);
    var queryResult = await this.vlocity.queryservice.query(queryString);

    if (queryResult.records.length == 0) {
        return;
    }

    var valuesMap = {};

    for (var record of queryResult.records) {
        valuesMap[record[displaySequenceFieldAPIName]] = '';
    }

    for (var pack of dataPacks) {
        valuesMap[this.vlocity.utilityservice.getDataPackData(pack)[displaySequenceFieldAPIName]] = '';
    }

    for (var i = 1; i < 9999; i++) {
        if (!valuesMap.hasOwnProperty(i)) {
            VlocityUtils.verbose('DataPack Updated', dataPackWithError.VlocityDataPackKey + ' - ' + displaySequenceFieldAPIName + ' field has been updated with value: ' + i);
            dataPack[displaySequenceFieldAPIName] = i;
            break;
        }
    }

    var filePath = this.vlocity.datapacksbuilder.recordSourceKeyToFilePath[dataPack.VlocityRecordSourceKey];
    this.vlocity.datapacksbuilder.allFileDataMap[filePath.toLowerCase()] = null;

    jobInfo.currentStatus[dataPackWithError.VlocityDataPackKey] = 'Ready';
    
    var jobInfoCopy = JSON.parse(JSON.stringify(jobInfo));

    await this.vlocity.datapacksexpand.expand(jobInfoCopy.projectPath + '/' + jobInfoCopy.expansionPath, {dataPacks: [dataPackWithError]}, jobInfoCopy);
    await this.vlocity.datapacksbuilder.setFileData(filePath, "utf8");
};