var fs = require('fs-extra');
var path = require('path');

var DeltaCheck = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};
};

DeltaCheck.prototype.runDeltaCheck = async function(jobInfo, currentContextData) {
    var self = this;
    self.jobInfo = jobInfo;
    jobInfo.deltaCheckResults = {};
    // self.getLastModifiedDate();

    currentContextData = self.vlocity.utilityservice.checkNamespacePrefix(currentContextData);
    self.vlocityMatchingKeys = self.vlocity.utilityservice.checkNamespacePrefix(await self.vlocity.utilityservice.getAllDRMatchingKeys());
    self.sObjectInfo = {};
    self.querySObjectsInfo = {};
    self.queryFieldsInfo = {};
    self.deltaCheckJobInfo = {
        deltaQueryChildrenDefinition : {},
        queryForChildren : {},
        contextDataToCompareAgainst : {},
        generatedMatchingKeyValueToId : {},
        replaceMatchingKeyValueWithId : {},
        matchingKeyFieldToDataPack: {},
        whereClauseHashToVlocityDataPackKey: {},
        unhashableFields: {},
        childToParentLookupField: {},
        matchingKeyFieldValueToWhereClauseHash: {}
    };

    await self.getAllRecordsToQueryFor(currentContextData);
    await self.executeQueries(self.queryFieldsInfo);
    var queryResult = await self.executeQueries(self.querySObjectsInfo);

    if (queryResult && !this.vlocity.utilityservice.isEmptyObject(queryResult)) {
        for (var sObjectType in queryResult) {
            for (var whereClauseKey in queryResult[sObjectType]) {
                await this.addChildrenQueryIfExist(sObjectType, queryResult[sObjectType][whereClauseKey], whereClauseKey);
            }
        }

        self.querySObjectsInfo = {};

        if (!this.vlocity.utilityservice.isEmptyObject(self.deltaCheckJobInfo.generatedMatchingKeyValueToId)) {
            await this.buildQueryMap(self.deltaCheckJobInfo.generatedMatchingKeyValueToId, true, true);
        }
    
        if (!this.vlocity.utilityservice.isEmptyObject(self.deltaCheckJobInfo.queryForChildren)) {
            await this.buildQueryMap(self.deltaCheckJobInfo.queryForChildren, true, false);
        }
    
        var secondQueryResult = await self.executeQueries(self.querySObjectsInfo);
    
        if (secondQueryResult) {
            for (sObjectType in secondQueryResult) {
                if (!queryResult.hasOwnProperty(sObjectType)) {
                    queryResult[sObjectType] = {};
                }
    
                for (whereClauseKey in secondQueryResult[sObjectType]) {
                    queryResult[sObjectType][whereClauseKey] = secondQueryResult[sObjectType][whereClauseKey];
                }
            }
        }
    }

    await self.compareQueryResultWithDataPacks(jobInfo, queryResult, this.deltaCheckJobInfo.contextDataToCompareAgainst);
};

DeltaCheck.prototype.compareQueryResultWithDataPacks = async function(jobInfo, queryResult, dataPacks) {
    for (var sObjectType in queryResult) {
        for (var whereClauseHashKey in queryResult[sObjectType]) {
            if (!(dataPacks[sObjectType][whereClauseHashKey])) {
                var vlocityDataPackKey = this.deltaCheckJobInfo.whereClauseHashToVlocityDataPackKey[whereClauseHashKey];
                jobInfo.deltaCheckResults[vlocityDataPackKey] = { status: 'Changed' };
            }
        }
    }

    for (var sObjectType in dataPacks) {
        for (var whereClauseHashKey in dataPacks[sObjectType]) {
            if (!queryResult[sObjectType] || !(queryResult[sObjectType][whereClauseHashKey])) {
                var vlocityDataPackKey = this.deltaCheckJobInfo.whereClauseHashToVlocityDataPackKey[whereClauseHashKey];
                jobInfo.deltaCheckResults[vlocityDataPackKey] = { status: 'Changed' };
            } else {
                var firstSObject = dataPacks[sObjectType][whereClauseHashKey];
                var secondSObject = queryResult[sObjectType][whereClauseHashKey];

                await this.compareDataPackWithSObject(jobInfo, firstSObject, secondSObject, whereClauseHashKey);
            }
        }
    }
};

DeltaCheck.prototype.compareDataPackWithSObject = async function(jobInfo, dataPackData, sObject, whereClauseHashKey) {
        var vlocityDataPackKey = this.deltaCheckJobInfo.whereClauseHashToVlocityDataPackKey[whereClauseHashKey];

        if (!(jobInfo.deltaCheckResults[vlocityDataPackKey]
            && jobInfo.deltaCheckResults[vlocityDataPackKey].status === 'Changed')) {
                var recordSObjectType = this.vlocity.utilityservice.replaceNamespaceWithDefault(dataPackData.VlocityRecordSObjectType);
                var unhashableFields = this.deltaCheckJobInfo.unhashableFields[recordSObjectType];

                if (!unhashableFields) {
                    unhashableFields = this.vlocity.datapacksutils.getUnhashableFields(null, recordSObjectType);

                    if (unhashableFields) {
                        unhashableFields = JSON.parse(this.vlocity.utilityservice.checkNamespacePrefix(JSON.stringify(unhashableFields)));
                        this.deltaCheckJobInfo.unhashableFields[recordSObjectType] = unhashableFields;
                    }
                }

                this.removeUnhashableFields(unhashableFields, dataPackData);
                this.removeUnhashableFields(unhashableFields, sObject);

                for (var fieldName in dataPackData) {
                    var dataPackValue = dataPackData[fieldName];
                    var sObjectValue = sObject[fieldName];
                    dataPackValue = this.formatIfDate(dataPackValue);
                    sObjectValue = this.formatIfDate(sObjectValue);

                    if (dataPackValue instanceof Array) {
                        continue;
                    }
                    
                    if (dataPackValue instanceof Object) {
                        if (!dataPackValue.VlocityRecordSObjectType || dataPackValue.VlocityRecordSObjectType == 'RecordType') {
                            continue;
                        }

                        var recordSObjectType = dataPackValue.VlocityRecordSObjectType;
                        var matchingKeyFieldValue = this.getMatchingKeyFieldValue(recordSObjectType, dataPackValue);
                        dataPackValue = this.deltaCheckJobInfo[matchingKeyFieldValue];
                    }

                    if (sObject.hasOwnProperty(fieldName)) {
                        if (sObjectValue == null) {
                            sObjectValue = "";
                        }

                        if (dataPackValue !== sObjectValue) {
                            if (!jobInfo.deltaCheckResults[vlocityDataPackKey] || jobInfo.deltaCheckResults[vlocityDataPackKey].status !== 'Not Found') {
                                jobInfo.deltaCheckResults[vlocityDataPackKey] = {
                                    status: 'Changed',
                                    records: []
                                }
                            }

                            jobInfo.deltaCheckResults[vlocityDataPackKey].records.push({ 
                                fieldName : [fieldName],
                                'sObjectValue': sObjectValue,
                                dataPackValue: dataPackValue,
                                recordType: dataPackData.VlocityRecordSObjectType
                            });
                        }
                    }
                }

            if (!jobInfo.deltaCheckResults[vlocityDataPackKey]) {
                jobInfo.deltaCheckResults[vlocityDataPackKey] = { status: 'Not Changed' };
            }
        }
};

DeltaCheck.prototype.removeUnhashableFields = function(unhashableFields, dataPackData) {
    if (unhashableFields) {
        unhashableFields.forEach(function(field) {
            delete dataPackData[field];
        });
    }
};

DeltaCheck.prototype.formatIfDate = function(date) {
    if (date && new Date(date.toString()) !== 'Invalid Date' && !isNaN(new Date(date.toString()))) {
        date = date.toString();
        date = date.substring(0, date.indexOf('.'));
    }

    return date;
};

DeltaCheck.prototype.buildQueryMap = async function(sObjects, replaceMatchingKeys, compare) {
    if (sObjects && !this.vlocity.utilityservice.isEmptyObject(sObjects)) {
        if (replaceMatchingKeys) {
            sObjects = this.replaceMatchingKeyValueWithId(sObjects);
        }

        var sObjectsWithMatchingFieldValues = this.replaceIdWithMatchingKeyValue(sObjects);
        
        for (sObjectType in sObjects) {
            for (var i = 0; i < sObjects[sObjectType].length; i++) {
                var sObject = sObjects[sObjectType][i];
                var fieldsDefinitionsMap = this.sObjectInfo[sObjectType].fieldsDefinitionsMap;
                var sObjectDescribe = this.sObjectInfo[sObjectType].sObjectDescribe;

                if (typeof sObject === 'undefined') {
                    continue;
                }

                var vlocityDataPackKey = sObject.vlocityDataPackKey;

                delete sObjects[sObjectType][i].vlocityDataPackKey;

                if (!sObjectDescribe) {
                    sObjectDescribe = await this.vlocity.utilityservice.describeSObject(sObjectType);
                    this.sObjectInfo[sObjectType].sObjectDescribe = sObjectDescribe;
                }

                if (!fieldsDefinitionsMap) {
                    fieldsDefinitionsMap = this.vlocity.utilityservice.getFieldsDefinitionsMap(sObjectDescribe);
                    this.sObjectInfo[sObjectType].fieldsDefinitionsMap = fieldsDefinitionsMap;
                }

                var matchingKeyFields = [];

                for (var field in sObject) {
                    matchingKeyFields.push(field);
                }
                
                var whereClauseMatchingFieldValue = this.buildWhereClauseHash(matchingKeyFields, sObjectsWithMatchingFieldValues[sObjectType][i], fieldsDefinitionsMap);
                var dataPack = sObject;

                if (this.deltaCheckJobInfo.matchingKeyFieldToDataPack[sObjectType]
                    && this.deltaCheckJobInfo.matchingKeyFieldToDataPack[sObjectType][whereClauseMatchingFieldValue]) {
                    dataPack = this.deltaCheckJobInfo.matchingKeyFieldToDataPack[sObjectType][whereClauseMatchingFieldValue];
                }
                
                var whereClause = this.buildWhereClauseHash(matchingKeyFields, sObject, fieldsDefinitionsMap);
                this.deltaCheckJobInfo.whereClauseHashToVlocityDataPackKey[whereClause] = vlocityDataPackKey;

                if (compare) {
                    if (!this.deltaCheckJobInfo.contextDataToCompareAgainst[sObjectType]) {
                        this.deltaCheckJobInfo.contextDataToCompareAgainst[sObjectType] = {};
                    }
                    
                    this.deltaCheckJobInfo.contextDataToCompareAgainst[sObjectType][whereClause] = dataPack; 
                }

                if (!this.querySObjectsInfo[sObjectType]) {
                    this.querySObjectsInfo[sObjectType] = {};
                }

                this.querySObjectsInfo[sObjectType][whereClause] = dataPack;
            }
        }
    }

    return this.querySObjectsInfo;
};

DeltaCheck.prototype.replaceIdWithMatchingKeyValue = function(sObjects) {
    return this.replaceMatchingKeyValueWithId(sObjects);
};

DeltaCheck.prototype.replaceMatchingKeyValueWithId = function(sObjects) {
    var replacedKeyMap = {};

    for (var sObjectType in sObjects) {
        for (var i = 0; i < sObjects[sObjectType].length; i++) {
            if (!replacedKeyMap[sObjectType]) {
                replacedKeyMap[sObjectType] = [];
            }

            var sObjectMap = {};

            for (var fieldName in sObjects[sObjectType][i]) {
                if (fieldName === 'vlocityDataPackKey') {
                    sObjectMap[fieldName] = sObjects[sObjectType][i][fieldName];
                    continue;
                }

                if (this.deltaCheckJobInfo.hasOwnProperty(sObjects[sObjectType][i][fieldName])) {
                    sObjectMap[fieldName] = this.deltaCheckJobInfo[sObjects[sObjectType][i][fieldName]];
                } else {
                    sObjectMap = {};
                    break;
                }
            }

            if (!this.vlocity.utilityservice.isEmptyObject(sObjectMap)) {
                replacedKeyMap[sObjectType][i] = sObjectMap;
            }
        }
    }

    return replacedKeyMap;
};

DeltaCheck.prototype.getAllRecordsToQueryFor = async function(currentContextData) {
    for (var i = 0; i < currentContextData.length; i++) {
        var dataPack = this.vlocity.utilityservice.getDataPackData(currentContextData[i]);
        var vlocityDataPackKey = currentContextData[i].VlocityDataPackKey;
        await this.findAllRecords(dataPack, vlocityDataPackKey);
    }

    return this.querySObjectsInfo;
};

DeltaCheck.prototype.buildQueries = async function(queriesMap) {
    var queries = {};

    for (var sObjectType in queriesMap) {
        var querySelect = queriesMap[sObjectType].querySelect;

        if (!querySelect) {
            querySelect = this.buildQuerySelect(this.sObjectInfo[sObjectType].sObjectDescribe);
            queriesMap[sObjectType].querySelect = querySelect;
        }

        var whereClause = '';

        for (var whereClauseHash in queriesMap[sObjectType]) {
            if (whereClauseHash === 'querySelect') {
                continue;
            }

            var whereClauseTemp = whereClauseHash; 

            if (queriesMap[sObjectType][whereClauseHash].whereClause) {
                whereClauseTemp = queriesMap[sObjectType][whereClauseHash].whereClause;
            }

            if (whereClause) {
                whereClause += ' OR ';
            }

            whereClause += '(' + whereClauseTemp + ')';
        }

        var fullQuery = 'SELECT ' + querySelect + ' FROM '+ sObjectType + ' WHERE ' + whereClause;

        if (!queries[sObjectType]) {
            queries[sObjectType] = {};
        }

        queries[sObjectType][fullQuery] = '';
    
        if (queriesMap[sObjectType] &&
            queriesMap[sObjectType].querySelect) {
            delete queriesMap[sObjectType].querySelect;
        }
    }

    return queries;
};

DeltaCheck.prototype.buildQuerySelect = function(sObjectDescribe) {
    return Object.keys(this.vlocity.utilityservice.getFieldsDefinitionsMap(sObjectDescribe));
};

DeltaCheck.prototype.executeQueries = async function(queriesMap) {
    var queriesMap = await this.buildQueries(queriesMap);
    var queriedRecordsMap = {};
    var queryPromises = [];

    for (var sObjectType in queriesMap) {
        for (var query in queriesMap[sObjectType]) {
            queryPromises.push({context: this, argument: {sObjectType: sObjectType, query: query, queriedRecordsMap: queriedRecordsMap}, func: 'runQuery'});
        }
    }

    await this.vlocity.utilityservice.parallelLimit(queryPromises);
    this.processQueryResult(queriedRecordsMap);
    return queriedRecordsMap;
};

DeltaCheck.prototype.runQuery = async function(inputMap) {
    var sObjectType = inputMap.sObjectType;
    var query = inputMap.query;
    var queriedRecordsMap = inputMap.queriedRecordsMap;
    var result = await this.vlocity.queryservice.query(query);
    
    if (result && result.records.length > 0) {
        if (!queriedRecordsMap[sObjectType]) {
            queriedRecordsMap[sObjectType] = {};
        }
            
        for (var i = 0; i < result.records.length; i++) {
            var whereClauseHash = await this.buildUniqueKey(sObjectType, null, result.records[i], null);
            queriedRecordsMap[sObjectType][whereClauseHash] = result.records[i];
        }
    }
};

DeltaCheck.prototype.processQueryResult = function(queryResultMap) {
    if (queryResultMap) {
        for (var sObjectType in queryResultMap) {
            for (var whereClauseHash in queryResultMap[sObjectType]) {
                var sObject = queryResultMap[sObjectType][whereClauseHash];
                var matchingKeyFieldValue = this.getMatchingKeyFieldValue(sObjectType, sObject);

                this.deltaCheckJobInfo[matchingKeyFieldValue] = sObject.Id;
                this.deltaCheckJobInfo[sObject.Id] = matchingKeyFieldValue;

                if (this.deltaCheckJobInfo.childToParentLookupField[sObjectType]) {
                    var parentRecordId = sObject[this.deltaCheckJobInfo.childToParentLookupField[sObjectType].fieldName];
                    var parentRecordMatchingKeyValue = this.deltaCheckJobInfo[parentRecordId];
                    var parentRecordSObjectType = this.deltaCheckJobInfo.childToParentLookupField[sObjectType].sObjectType;
                    var parentRecordWhereClauseHash = this.deltaCheckJobInfo.matchingKeyFieldValueToWhereClauseHash[parentRecordSObjectType][parentRecordMatchingKeyValue]; 
                    var vlocityDataPackKey = this.deltaCheckJobInfo.whereClauseHashToVlocityDataPackKey[parentRecordWhereClauseHash];

                    this.deltaCheckJobInfo.whereClauseHashToVlocityDataPackKey[whereClauseHash] = vlocityDataPackKey;
                }
            }
        }
    }
};

DeltaCheck.prototype.findAllRecords = async function(dataPack, vlocityDataPackKey) {
    await this.processDataPack(dataPack, vlocityDataPackKey, true, null);

    for (var dataPackField in dataPack) {
        if (dataPack[dataPackField]) {
            var matchingKeyFieldValue;
            var dataPackData;
            var isSObject = false;

            if (dataPack[dataPackField] instanceof Array) {
                for (var i = 0; i < dataPack[dataPackField].length; i++) {
                    await this.findAllRecords(dataPack[dataPackField][i], vlocityDataPackKey);
                }
            }
            else if (dataPack[dataPackField][0]
                && dataPack[dataPackField][0] instanceof Object
                && dataPack[dataPackField][0].VlocityRecordSObjectType) {
                isSObject = true;
                dataPackData = dataPack[dataPackField][0];
            } else if (dataPack[dataPackField].VlocityLookupRecordSourceKey
                && dataPack[dataPackField].VlocityRecordSObjectType !== 'RecordType') {
                dataPackData = dataPack[dataPackField];
                matchingKeyFieldValue = dataPackData.VlocityLookupRecordSourceKey.substring(dataPackData.VlocityLookupRecordSourceKey.indexOf('/')+1);
            } else if (dataPack[dataPackField].VlocityMatchingRecordSourceKey) {
                dataPackData = dataPack[dataPackField];
                matchingKeyFieldValue = dataPackData.VlocityMatchingRecordSourceKey.substring(dataPackData.VlocityMatchingRecordSourceKey.indexOf('/')+1);
            } else {
                continue;
            }

            if (isSObject) {
                await this.findAllRecords(dataPackData, vlocityDataPackKey);
            } else if (matchingKeyFieldValue) {
                await this.processDataPack(dataPackData, vlocityDataPackKey, false, matchingKeyFieldValue);
            }
        }
    }
};

DeltaCheck.prototype.processDataPack = async function(dataPackData, vlocityDataPackKey, addLastModifiedDate, matchingKeyFieldValue) {
    var sObjectType = dataPackData.VlocityRecordSObjectType;

    var vlocityDataPackType = dataPackData.VlocityDataPackType;
    var whereClauseHash = await this.buildUniqueKey(sObjectType, vlocityDataPackKey, dataPackData, matchingKeyFieldValue);

    if (whereClauseHash) {
        var whereClauseHashWithoutLastModifieDate = whereClauseHash;
        this.deltaCheckJobInfo.whereClauseHashToVlocityDataPackKey[whereClauseHashWithoutLastModifieDate] = vlocityDataPackKey;

        if (addLastModifiedDate && this.lastModifiedDate) {
            // whereClauseHash = '((' + whereClauseHash + ') AND LastModifiedDate > ' + this.lastModifiedDate + ')';
        }

        if (vlocityDataPackType === 'SObject') {
            if (!this.querySObjectsInfo[sObjectType]) {
                this.querySObjectsInfo[sObjectType] = {};
            }
    
            if (!this.querySObjectsInfo[sObjectType][whereClauseHashWithoutLastModifieDate]) {
                this.querySObjectsInfo[sObjectType][whereClauseHashWithoutLastModifieDate] = {};
                this.querySObjectsInfo[sObjectType][whereClauseHashWithoutLastModifieDate].dataPack = dataPackData;
                this.querySObjectsInfo[sObjectType][whereClauseHashWithoutLastModifieDate].whereClause = whereClauseHash;
            }

            if (!this.deltaCheckJobInfo.contextDataToCompareAgainst[sObjectType]) {
                this.deltaCheckJobInfo.contextDataToCompareAgainst[sObjectType] = {};
            }

            this.deltaCheckJobInfo.contextDataToCompareAgainst[sObjectType][whereClauseHashWithoutLastModifieDate] = dataPackData;
        } else {
            if (!this.queryFieldsInfo[sObjectType]) {
                this.queryFieldsInfo[sObjectType] = {};
            }
    
            if (!this.queryFieldsInfo[sObjectType][whereClauseHashWithoutLastModifieDate]) {
                this.queryFieldsInfo[sObjectType][whereClauseHashWithoutLastModifieDate] = {};
                this.queryFieldsInfo[sObjectType][whereClauseHashWithoutLastModifieDate].dataPack = dataPackData;
                this.queryFieldsInfo[sObjectType][whereClauseHashWithoutLastModifieDate].whereClause = whereClauseHash;
            }
        }
    } else if (whereClauseHash === ""){
        this.jobInfo.deltaCheckResults[vlocityDataPackKey] = { status: 'Unknown' };
    }
};

DeltaCheck.prototype.addChildrenQueryIfExist = async function(sObjectType, sObject, vlocityDataPackKey) {
    if (sObject) {
        var queryForChildren = this.deltaCheckJobInfo.deltaQueryChildrenDefinition[sObjectType];

        if (!queryForChildren) {
            queryForChildren = this.vlocity.datapacksutils.getDeltaQueryChildren(null, sObjectType);
        }

        if (queryForChildren) {
            this.deltaCheckJobInfo.deltaQueryChildrenDefinition[sObjectType] = queryForChildren;

            queryForChildren = this.vlocity.utilityservice.checkNamespacePrefix(queryForChildren);

            for (var querySObjectType in queryForChildren) {
                var lookupField = queryForChildren[querySObjectType];
                var matchingKeyFieldValue = this.getMatchingKeyFieldValue(sObjectType, sObject);

                if (!this.deltaCheckJobInfo.queryForChildren[querySObjectType]) {
                    this.deltaCheckJobInfo.queryForChildren[querySObjectType] = [];
                }

                var queryRecord = {[lookupField] : matchingKeyFieldValue};
                queryRecord.vlocityDataPackKey = vlocityDataPackKey;

                this.deltaCheckJobInfo.queryForChildren[querySObjectType].push(queryRecord);
                this.deltaCheckJobInfo.childToParentLookupField[querySObjectType] = {fieldName : lookupField, sObjectType : sObjectType};
            }
        }
    }
};

DeltaCheck.prototype.buildUniqueKey = async function(sObjectType, vlocityDataPackKey, sObject, matchingKeyFieldValue) {
    if (!this.sObjectInfo[sObjectType]) {
        this.sObjectInfo[sObjectType] = {};
    }

    var sObjectDescribe = this.sObjectInfo[sObjectType].sObjectDescribe;
    var matchingKeyField = this.sObjectInfo[sObjectType].matchingKeyField;
    var fieldsDefinitionsMap = this.sObjectInfo[sObjectType].fieldsDefinitionsMap;

    if (!matchingKeyField) {
        matchingKeyField = this.vlocityMatchingKeys[sObjectType];
        this.sObjectInfo[sObjectType].matchingKeyField = matchingKeyField;   
    }

    if (!sObjectDescribe) {
        sObjectDescribe = await this.vlocity.utilityservice.describeSObject(sObjectType);
        this.sObjectInfo[sObjectType].sObjectDescribe = sObjectDescribe;
    }

    if (!fieldsDefinitionsMap) {
        fieldsDefinitionsMap = this.vlocity.utilityservice.getFieldsDefinitionsMap(sObjectDescribe);
        this.sObjectInfo[sObjectType].fieldsDefinitionsMap = fieldsDefinitionsMap;
    }

    if (matchingKeyField && matchingKeyField.includes(',')) {
        matchingKeyField = matchingKeyField.split(',');
        var referenceMatchingFieldFound = false;
        var sObjectRecord = {};

        for (var i = 0; i < matchingKeyField.length; i++) {
            if (fieldsDefinitionsMap[matchingKeyField[i]]) {
                var referenceSObject = sObject[matchingKeyField[i]];

                if (referenceSObject instanceof Object) {
                    referenceMatchingFieldFound = true;

                    if (referenceSObject.VlocityLookupRecordSourceKey) {
                        matchingKeyFieldValue = referenceSObject.VlocityLookupRecordSourceKey.substring(referenceSObject.VlocityLookupRecordSourceKey.indexOf('/')+1);
                    } else if (referenceSObject.VlocityMatchingRecordSourceKey) {
                        matchingKeyFieldValue = referenceSObject.VlocityMatchingRecordSourceKey.substring(referenceSObject.VlocityMatchingRecordSourceKey.indexOf('/')+1);
                    }

                    sObjectRecord[matchingKeyField[i]] = matchingKeyFieldValue;
                    matchingKeyFieldValue = '';
                } else {
                    sObjectRecord[matchingKeyField[i]] = referenceSObject;
                }
            }
        }

        if (!this.vlocity.utilityservice.isEmptyObject(sObjectRecord)) {
            if (!this.deltaCheckJobInfo.generatedMatchingKeyValueToId
                [sObjectType]) {
                this.deltaCheckJobInfo.generatedMatchingKeyValueToId[sObjectType] = [];
            }

            var whereClause = this.buildWhereClauseHash(matchingKeyField, sObject, fieldsDefinitionsMap);

            if (!this.deltaCheckJobInfo.matchingKeyFieldToDataPack[sObjectType]) {
                this.deltaCheckJobInfo.matchingKeyFieldToDataPack[sObjectType] = {};
            }

            this.deltaCheckJobInfo.matchingKeyFieldToDataPack[sObjectType][whereClause] = sObject;
            sObjectRecord.vlocityDataPackKey = vlocityDataPackKey;
            this.deltaCheckJobInfo.generatedMatchingKeyValueToId[sObjectType].push(sObjectRecord);
        }

        if (referenceMatchingFieldFound) {
            return;
        }
    }

    if (matchingKeyFieldValue) {
        sObject[matchingKeyField] = matchingKeyFieldValue;
    }

    if (!(matchingKeyField instanceof Array)) {
        matchingKeyField = [matchingKeyField];
    }

    return this.buildWhereClauseHash(matchingKeyField, sObject, fieldsDefinitionsMap, sObjectType);
};

DeltaCheck.prototype.buildWhereClauseHash = function(matchingKeyField, sObject, fieldsDefinitionsMap, sObjectType) {
    var fieldsValuesMap = {};
    var fieldsDefinitionsMapReduced = {};
    var matchingKeyFieldValue = '';

    if (matchingKeyField instanceof Array) {
        for (var i = 0; i < matchingKeyField.length; i++) {
            var matchingFieldValue = sObject[matchingKeyField[i]];

            if (!matchingFieldValue) {
                matchingFieldValue = null;
            }

            if (matchingFieldValue instanceof Object) {
                if (matchingFieldValue.VlocityLookupRecordSourceKey) {
                    matchingFieldValue = matchingFieldValue.VlocityLookupRecordSourceKey.substring(matchingFieldValue.VlocityLookupRecordSourceKey.indexOf('/')+1);
                } else if (matchingFieldValue.VlocityMatchingRecordSourceKey) {
                    matchingFieldValue = matchingFieldValue.VlocityMatchingRecordSourceKey.substring(matchingFieldValue.VlocityMatchingRecordSourceKey.indexOf('/')+1);
                }
            }
            
            if (!fieldsValuesMap[matchingKeyField[i]]) {
                fieldsValuesMap[matchingKeyField[i]] = [];
            }

            fieldsDefinitionsMapReduced[matchingKeyField[i]] = fieldsDefinitionsMap[matchingKeyField[i]];
            fieldsValuesMap[matchingKeyField[i]].push(matchingFieldValue);

            matchingKeyFieldValue += matchingFieldValue;
        }
    }

    var whereClauseHash = this.vlocity.queryservice.buildWhereClause(fieldsValuesMap, fieldsDefinitionsMapReduced);

    if (!this.deltaCheckJobInfo.matchingKeyFieldValueToWhereClauseHash[sObjectType]) {
        this.deltaCheckJobInfo.matchingKeyFieldValueToWhereClauseHash[sObjectType] = {};
    }

    this.deltaCheckJobInfo.matchingKeyFieldValueToWhereClauseHash[sObjectType][matchingKeyFieldValue] = whereClauseHash;

    return whereClauseHash;
};

DeltaCheck.prototype.getLastModifiedDate = function() {
    var srcpath = path.join(__dirname, '..', '..', 'vlocity-temp', 'deltaCheckJobInfo');
    var files = this.vlocity.datapacksutils.loadFilesAtPath(srcpath);
    var newLastModifiedDate = new Date().toISOString();
    
    if (files.deltaCheckJobInfo
        && files.deltaCheckJobInfo[this.vlocity.utilityservice.organizationId]) {
        this.lastModifiedDate = files.deltaCheckJobInfo[this.vlocity.utilityservice.organizationId];
    }
    
    fs.outputFileSync(path.join('vlocity-temp', 'deltaCheckJobInfo', this.vlocity.utilityservice.organizationId), newLastModifiedDate, 'utf8');
};

DeltaCheck.prototype.getMatchingKeyFieldValue = function(sObjectType, sObject) {
    var matchingKeyField = this.vlocityMatchingKeys[sObjectType];

    if (matchingKeyField.includes(',')) {
        matchingKeyField = matchingKeyField.split(',');
    }

    var matchingKeyFieldValue = '';

    if (matchingKeyField instanceof Array) {
        for (var i = 0; i < matchingKeyField.length; i++) {
            matchingKeyFieldValue += sObject[matchingKeyField[i]] ? sObject[matchingKeyField[i]] : null;
        }
    } else {
        matchingKeyFieldValue  = sObject[matchingKeyField];
    }

    return matchingKeyFieldValue;
};