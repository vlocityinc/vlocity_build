var yaml = require('js-yaml');
var fs = require('fs-extra');
var path = require('path');

var DeltaCheck = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};
};

DeltaCheck.prototype.runDeltaCheck = async function(jobInfo, currentContextData, onComplete) {
    var self = this;

    self.getLastModifiedDate();

    currentContextData = self.vlocity.utilityservice.checkNamespacePrefix(currentContextData);
    self.vlocityMatchingKeys = await self.vlocity.utilityservice.getAllDRMatchingKeys();
    self.vlocityMatchingKeys = self.vlocity.utilityservice.checkNamespacePrefix(self.vlocityMatchingKeys);

    self.queryDataPacksJobInfo = {};
    self.contextDataToCompareWith = {};
    self.listofIdsBySObjectTypeQueried = {};
    self.deltaCheckJobInfo = { generatedMatchingKeyValueToId : {}};

    await self.getAllSObjectsToQueryFor(currentContextData);
    
    var queries = await self.buildQueries();
    var firstQueryResult = await self.executeQueries(queries);
    var secondQueryResult;

    if (!this.vlocity.utilityservice.isEmptyObject(self.deltaDeployJobInfo.generatedMatchingKeyValueToId)) {
        self.dataPacksJobInfo = {};
        self.replaceMatchingKeyValueWithId();

        for (sObjectType in self.deltaDeployJobInfo.generatedMatchingKeyValueToId) {
            for (var i = 0; i < self.deltaDeployJobInfo.generatedMatchingKeyValueToId[sObjectType].length; i++) {
                var sObject = self.deltaDeployJobInfo.generatedMatchingKeyValueToId[sObjectType][i];
                sObject.VlocityRecordSObjectType = sObjectType;
                await this.addDataPack(sObject, false, null);
            }
        }

        queries = await self.buildQueries();
        secondQueryResult = await self.executeQueries(queries);
    }

    if (secondQueryResult) {
        for (var sObjectType in secondQueryResult) {
            if (firstQueryResult.hasOwnProperty(sObjectType)) {
                for (var i = 0; i < secondQueryResult[sObjectType].length; i++) {
                    firstQueryResult[sObjectType].push(secondQueryResult[sObjectType][i]);
                }
            } else {
                firstQueryResult[sObjectType] = secondQueryResult[sObjectType];
            }
        }
    }

    var deltaCheckResults = await self.compareResultsWithCurrentContextData(firstQueryResult, currentContextData);
    onComplete(jobInfo);
};

/*
 * The method itirates over a stored locally Datapacks and finds all sObjects, lookup and matching records to query for.
 */
DeltaCheck.prototype.getAllSObjectsToQueryFor = async function(currentContextData) {
    for (var i = 0; i < currentContextData.length; i++) {
        var dataPack = this.vlocity.utilityservice.getDataPackData(currentContextData[i]);
        await this.findAllDataPacks(dataPack);
    }

    return this.queryDataPacksJobInfo;
};

/**
 * The method itirates over a Datapack and finds all sObjects, lookup and matching records to query for.
 */
DeltaCheck.prototype.findAllDataPacks = async function(dataPack) {
    await this.addDataPackToJobInfo(dataPack, false, null);

    for (var dataPackField in dataPack) {
        if (dataPack[dataPackField]) {
            var matchingKeyFieldValue;
            var dataPackData;
            var firstLevelSObject = false;

            if (dataPack[dataPackField][0]
                && dataPack[dataPackField][0] instanceof Object
                && dataPack[dataPackField][0].VlocityRecordSObjectType) {
                firstLevelSObject = true;
                dataPackData = dataPack[dataPackField][0];
            } else if (dataPack[dataPackField].VlocityLookupRecordSourceKey) {
                dataPackData = dataPack[dataPackField];
                matchingKeyFieldValue = dataPackData.VlocityLookupRecordSourceKey.substring(dataPackData.VlocityLookupRecordSourceKey.indexOf('/')+1);
            } else if (dataPack[dataPackField].VlocityMatchingRecordSourceKey) {
                dataPackData = dataPack[dataPackField];
                matchingKeyFieldValue = dataPackData.VlocityMatchingRecordSourceKey.substring(dataPackData.VlocityMatchingRecordSourceKey.indexOf('/')+1);
            } else {
                continue;
            }

            if (dataPackData) {
                if (firstLevelSObject) {
                    await this.findAllDataPacks(dataPackData);
                } else if (matchingKeyFieldValue) {
                    // TODO: handle the use case when trying to replace sObject for example
                    await this.addDataPackToJobInfo(dataPackData, false, matchingKeyFieldValue);
                }
            }
        }
    }
};
 
DeltaCheck.prototype.addDataPackToJobInfo = async function(dataPackData, addLastModifiedDate, matchingKeyFieldValue) {
    var recordSObjectType = dataPackData.VlocityRecordSObjectType;
    var vlocityDataPackType = dataPackData.VlocityDataPackType;
    var matchingKeyFieldValueHash = await this.buildUniqueKey(recordSObjectType, dataPackData, matchingKeyFieldValue);

    if (matchingKeyFieldValueHash) {
        if (!this.queryDataPacksJobInfo[recordSObjectType].queryData) {
            this.queryDataPacksJobInfo[recordSObjectType].queryData = {};
        }

        if (addLastModifiedDate) {
            matchingKeyFieldValueHash = '((' + matchingKeyFieldValueHash + ') AND LastModifiedDate > ' + this.lastModifiedDate + ')';
        }
        
        if (!this.queryDataPacksJobInfo[recordSObjectType].queryData[matchingKeyFieldValueHash]) {
            this.queryDataPacksJobInfo[recordSObjectType].queryData[matchingKeyFieldValueHash] = dataPackData;
        }

        if (vlocityDataPackType === 'SObject') {
            if (!this.contextDataToCompareWith[recordSObjectType]) {
                this.contextDataToCompareWith[recordSObjectType] = {};
            }

            if (!this.contextDataToCompareWith[recordSObjectType][matchingKeyFieldValueHash]) {
                this.contextDataToCompareWith[recordSObjectType][matchingKeyFieldValueHash] = dataPackData;
            }
        }
    }
};

DeltaCheck.prototype.buildUniqueKey = async function(recordSObjectType, sObject, matchingKeyFieldValue) {
    if (!this.queryDataPacksJobInfo[recordSObjectType]) {
        this.queryDataPacksJobInfo[recordSObjectType] = {};
    }

    var sObjectDescribe = this.queryDataPacksJobInfo[recordSObjectType].sObjectDescribe;
    var matchingKeyField = this.queryDataPacksJobInfo[recordSObjectType].matchingKeyField;
    var fieldsDefinitionsMap = this.queryDataPacksJobInfo[recordSObjectType].fieldsDefinitionsMap;

    if (!matchingKeyField) {
        matchingKeyField = this.vlocityMatchingKeys[recordSObjectType];
        this.queryDataPacksJobInfo[recordSObjectType].matchingKeyField = matchingKeyField;   
    }

    if (!sObjectDescribe) {
        sObjectDescribe = await this.vlocity.utilityservice.describeSObject(recordSObjectType);
        this.queryDataPacksJobInfo[recordSObjectType].sObjectDescribe = sObjectDescribe;
    }

    if (!fieldsDefinitionsMap) {
        fieldsDefinitionsMap = this.vlocity.utilityservice.getFieldsDefinitionsMap(sObjectDescribe);
        this.queryDataPacksJobInfo[recordSObjectType].fieldsDefinitionsMap = fieldsDefinitionsMap;
    }

    if (matchingKeyField.includes(',')) {
        matchingKeyField = matchingKeyField.split(',');
        var referenceMatchingFieldFound = false;
        var sObjectRecord = {};

        for (var i = 0; i < matchingKeyField.length; i++) {
            if (fieldsDefinitionsMap[matchingKeyField[i]]) {
                //var fieldType = fieldsDefinitionsMap[matchingKeyField[i]].type;
                //if (fieldType === 'reference') {
                var referenceSObject = sObject[matchingKeyField[i]];

                if (referenceSObject && referenceSObject instanceof Object) {
                    referenceMatchingFieldFound = true;

                    if (referenceSObject.VlocityLookupRecordSourceKey) {
                        matchingKeyFieldValue = referenceSObject.VlocityLookupRecordSourceKey.substring(referenceSObject.VlocityLookupRecordSourceKey.indexOf('/')+1);
                    } else if (referenceSObject.VlocityMatchingRecordSourceKey) {
                        matchingKeyFieldValue = referenceSObject.VlocityMatchingRecordSourceKey.substring(referenceSObject.VlocityMatchingRecordSourceKey.indexOf('/')+1);
                    }

                    sObjectRecord[matchingKeyField[i]] = matchingKeyFieldValue;
                    matchingKeyFieldValue = '';
                }
                //}
            }
        }

        if (!this.vlocity.utilityservice.isEmptyObject(sObjectRecord)) {
            if (!this.deltaCheckJobInfo.generatedMatchingKeyValueToId
                [recordSObjectType]) {
                this.deltaCheckJobInfo.generatedMatchingKeyValueToId[recordSObjectType] = [];
            }

            this.deltaCheckJobInfo.generatedMatchingKeyValueToId[recordSObjectType].push(sObjectRecord);
        }

        if (referenceMatchingFieldFound) {
            return;
        }
    } else {
        matchingKeyField = [matchingKeyField];
    }

    if (matchingKeyFieldValue) {
        sObject[matchingKeyField] = matchingKeyFieldValue;
    }

    return this.buildWhereClauseHash(matchingKeyField, sObject, fieldsDefinitionsMap);
};

DeltaCheck.prototype.buildWhereClauseHash = function(matchingKeyField, dataPack, fieldsDefinitionsMap, addLastModifiedDate) {
    var fieldsValuesMap = {};
    var fieldsDefinitionsMapReduced = {};

    if (matchingKeyField instanceof Array) {
        for (var i = 0; i < matchingKeyField.length; i++) {
            var matchingKeyFieldValue = dataPack[matchingKeyField[i]];

            if (!matchingKeyFieldValue) {
                matchingKeyFieldValue = null;
            }

            if (matchingKeyFieldValue instanceof Object) {
                if (matchingKeyFieldValue.VlocityLookupRecordSourceKey) {
                    matchingKeyFieldValue = matchingKeyFieldValue.VlocityLookupRecordSourceKey.substring(matchingKeyFieldValue.VlocityLookupRecordSourceKey.indexOf('/')+1);
                } else if (matchingKeyFieldValue.VlocityMatchingRecordSourceKey) {
                    matchingKeyFieldValue = matchingKeyFieldValue.VlocityMatchingRecordSourceKey.substring(matchingKeyFieldValue.VlocityMatchingRecordSourceKey.indexOf('/')+1);
                }
            }
            
            if (!fieldsValuesMap[matchingKeyField[i]]) {
                fieldsValuesMap[matchingKeyField[i]] = [];
            }

            fieldsDefinitionsMapReduced[matchingKeyField[i]] = fieldsDefinitionsMap[matchingKeyField[i]];
            fieldsValuesMap[matchingKeyField[i]].push(matchingKeyFieldValue);
        }
    }
   
    return this.vlocity.queryservice.buildWhereClause(fieldsValuesMap, fieldsDefinitionsMapReduced);
};

DeltaCheck.prototype.executeQueries = async function(queriesMap) {
    var queriedRecordsMap = {};
    var queryPromises = [];

    for (var sObjectType in queriesMap) {
        for (var query in queriesMap[sObjectType]) {
            queryPromises.push({context: this, argument: {query: query, queriedRecordsMap: queriedRecordsMap}, func: 'runQuery'});
        }
    }

    await this.vlocity.utilityservice.parallelLimit(queryPromises);

    this.createMatchingKeyToSObjectIdMap(queriedRecordsMap);
    return queriedRecordsMap;
};

DeltaCheck.prototype.createMatchingKeyToSObjectIdMap = function(queriedRecordsMap) {
    for (var sObjectType in queriedRecordsMap) {
        for (var uniqueKey in queriedRecordsMap[sObjectType]) {
            var matchingKeyFieldValue = this.getMatchingKeyFieldValue(sObjectType, queriedRecordsMap[sObjectType][uniqueKey]);
            this.deltaDeployJobInfo[matchingKeyFieldValue] = queriedRecordsMap[sObjectType][uniqueKey].Id;
        }
    }
};

DeltaCheck.prototype.runQuery = async function(inputMap) {
    var query = inputMap.query;
    var queriedRecordsMap = inputMap.queriedRecordsMap;
    var result = await this.vlocity.queryservice.query(query);
    // TODO: handle not found in comparison loop twice from both sides
    if (result && result.records.length > 0) {
        if (!queriedRecordsMap[sObjectType]) {
            queriedRecordsMap[sObjectType] = {};
        }
            
        for (var i = 0; i < result.records.length; i++) {
            var whereClauseHash = await this.buildUniqueKey(sObjectType, result.records[i], null);
            queriedRecordsMap[sObjectType][whereClauseHash] = result.records[i];
        }
    }
};

DeltaCheck.prototype.buildQuerySelect = function(sObjectDescribe) {
    return Object.keys(this.vlocity.utilityservice.getFieldsDefinitionsMap(sObjectDescribe));
};

DeltaCheck.prototype.buildQueries = async function() {
    var queriesMap = {};

    for (var sObjectType in this.queryDataPacksJobInfo) {
        for (var whereClause in this.queryDataPacksJobInfo[sObjectType].queryData) {
            if (!queriesMap[sObjectType]) {
                queriesMap[sObjectType] = {};
            }

            var querySelect = queriesMap[sObjectType].querySelect;
            
            if (!querySelect) {
                querySelect = this.buildQuerySelect(this.queryDataPacksJobInfo[sObjectType].sObjectDescribe);
                queriesMap[sObjectType].querySelect = querySelect;
            }

            var fullQuery = 'SELECT ' + querySelect + ' FROM '+ sObjectType + ' WHERE ' + whereClause;
            queriesMap[sObjectType][fullQuery] = '';
        }

        if (queriesMap[sObjectType] &&
            queriesMap[sObjectType].querySelect) {
            delete queriesMap[sObjectType].querySelect;
        }
    }

    return queriesMap;
};

DeltaCheck.prototype.getMatchingKeyFieldValue = function(sObjectType, sObject) {
    var matchingKeyField = this.vlocityMatchingKeys[sObjectType];

    if (matchingKeyField.includes(',')) {
        matchingKeyField = matchingKeyField.split(',');
    }

    var matchingKeyFieldValue = '';

    if (matchingKeyField instanceof Array) {
        for (var i = 0; i < matchingKeyField.length; i++) {
            matchingKeyFieldValue += sObject[matchingKeyField[i]];
        }
    } else {
        matchingKeyFieldValue  = sObject[matchingKeyField];
    }

    return matchingKeyFieldValue;
};

DeltaCheck.prototype.compareDataPackWithSObject = async function(vlocityDataPackKey, dataPackData, sObject, results, deployDataPacksMap) {
    for (var fieldName in dataPackData) {
        if (dataPackData[fieldName][0]
            && dataPackData[fieldName][0] instanceof Object
            && dataPackData[fieldName][0].VlocityDataPackType == 'SObject') {
            var recordSObjectType = dataPackData[fieldName][0].VlocityRecordSObjectType;
            var matchingKeyFieldValue = this.getMatchingKeyFieldValue(recordSObjectType, dataPackData[fieldName][0]);
            var whereClauseHash = await this.buildUniqueKey(recordSObjectType, dataPackData, null);
            this.compareDataPackWithSObject(dataPackData[fieldName][0], results[recordSObjectType][whereClauseHash], results, deployDataPacksMap);
        }

        if (sObject.hasOwnProperty(fieldName)) {
            if (sObject[fieldName] == null) {
                sObject[fieldName] = "";
            }

            if (dataPackData[fieldName] !== sObject[fieldName]) {
                if (!deployDataPacksMap[vlocityDataPackKey]) {
                    deployDataPacksMap[vlocityDataPackKey] = {};
                }
                
                deployDataPacksMap[vlocityDataPackKey][fieldName] = sObject[fieldName];
            }
        }
    }
};

DeltaCheck.prototype.compareResultsWithCurrentContextData = async function(results, currentContextData) {
    var deployDataPacksMap = {};

    for (var i = 0; i < currentContextData.length; i++) {
        var vlocityDataPackKey = currentContextData[i].VlocityDataPackKey;
        var dataPackData = this.vlocity.utilityservice.getDataPackData(currentContextData[i]);
        var recordSObjectType = dataPackData.VlocityRecordSObjectType;
        var contextWhereClauseHash = await this.buildUniqueKey(recordSObjectType, dataPackData, null);

        if (results.hasOwnProperty(recordSObjectType)) {
            var sObject = results[recordSObjectType][contextWhereClauseHash];
            await this.compareDataPackWithSObject(vlocityDataPackKey, dataPackData, sObject, results, deployDataPacksMap);
        }
    }

    return deployDataPacksMap;
};

DeltaCheck.prototype.replaceMatchingKeyValueWithId = function() {
    if (this.deltaCheckJobInfo.generatedMatchingKeyValueToId) {
        for (var sObjectType in this.deltaCheckJobInfo.generatedMatchingKeyValueToId) {
            for (var i = 0; i < this.deltaCheckJobInfo.generatedMatchingKeyValueToId[sObjectType].length; i++) {
                for (var fieldName in this.deltaCheckJobInfo.generatedMatchingKeyValueToId[sObjectType][i]) {
                    if (this.deltaCheckJobInfo.hasOwnProperty(this.deltaCheckJobInfo.generatedMatchingKeyValueToId[sObjectType][i][fieldName])) {
                        this.deltaCheckJobInfo.generatedMatchingKeyValueToId[sObjectType][i][fieldName] = this.deltaCheckJobInfo[this.deltaCheckJobInfo.generatedMatchingKeyValueToId[sObjectType][i][fieldName]];
                    }
                }
            }
        }
    }
};

/*
 * The last modified date will be used in query for sObjects. First time all records will be queried.
 */
DeltaCheck.prototype.getLastModifiedDate = function() {
    var srcpath = path.join(__dirname, '..', '..', 'test', 'deltaCheckJobInfo');
    var files = this.vlocity.datapacksutils.loadFilesAtPath(srcpath);
    var newLastModifiedDate = new Date().toISOString();
    
    if (files.deltaCheckJobInfo
        && files.deltaCheckJobInfo[this.vlocity.organizationId]) {
        this.lastModifiedDate = files.deltaCheckJobInfo[this.vlocity.organizationId];
    }

    fs.outputFileSync(path.join('test', 'deltaCheckJobInfo', this.vlocity.organizationId), newLastModifiedDate, 'utf8');
};