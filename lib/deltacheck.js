var stringify = require('json-stable-stringify');

var DeltaCheck = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};
};

DeltaCheck.prototype.runDeltaCheck = async function(jobInfo, currentContextData) {
    
    this.jobInfo = jobInfo;
    this.jobInfo.deltaCheckResults = {};

    currentContextData = this.vlocity.utilityservice.checkNamespacePrefix(currentContextData);
    this.sObjectInfo = {};
    this.querySObjectsInfo = {};
    this.deltaCheckJobInfo = {
        deltaQueryChildrenDefinition: {},
        deltaCheckMatchingKeyNotQueryable: {},
        queryForChildren: {},
        childToParentLookupField: {},
        contextDataToCompareAgainst: {},
        unhashableFields: {},
        recordSourceKeyToId: {},
        recordSourceKeyToDataPack: {},
        replaceRecordSourceKeyWithId: {},
        recordSourceKeyToDataPackKey: {},
        whereClauseHashToVlocityRecordSourceKey: {}
    };

    var matchingKeys = await this.vlocity.utilityservice.getAllDRMatchingKeys();
    this.vlocityMatchingKeys = this.vlocity.utilityservice.checkNamespacePrefix(matchingKeys);
    
    await this.getAllRecordsToQueryFor(currentContextData);

    var queryResultsMap = {};

    if (!this.vlocity.utilityservice.isEmptyObject(this.querySObjectsInfo)) {
        do {
            if (!this.vlocity.utilityservice.isEmptyObject(this.deltaCheckJobInfo.replaceRecordSourceKeyWithId)) {
                await this.buildQueryMap(this.deltaCheckJobInfo.replaceRecordSourceKeyWithId, false);
            }

            if (!this.vlocity.utilityservice.isEmptyObject(this.deltaCheckJobInfo.queryForChildren)) {
                await this.buildQueryMap(this.deltaCheckJobInfo.queryForChildren, true);
            }

            var queryResult = await this.executeQueries(this.querySObjectsInfo);

            for (var sObjectType in queryResult) {
                if (!queryResultsMap.hasOwnProperty(sObjectType)) {
                    queryResultsMap[sObjectType] = {};
                }

                for (var whereClauseKey in queryResult[sObjectType]) {
                    queryResultsMap[sObjectType][whereClauseKey] = queryResult[sObjectType][whereClauseKey];
                    
                    var sourcekey = this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[sObjectType][whereClauseKey];     
                    await this.addChildrenQuery(sObjectType, queryResult[sObjectType][whereClauseKey], sourcekey);
                }
            }

            this.querySObjectsInfo = {};

            var queryResultIsEmpty = this.vlocity.utilityservice.isEmptyObject(queryResult);
            
            if (queryResultIsEmpty && !this.vlocity.utilityservice.isEmptyObject(this.deltaCheckJobInfo.replaceRecordSourceKeyWithId)) {
                for (var sObjectType in this.deltaCheckJobInfo.replaceRecordSourceKeyWithId) {
                    var lookupDataPacks = this.deltaCheckJobInfo.replaceRecordSourceKeyWithId[sObjectType];

                    for (var i = 0; i < lookupDataPacks.length; i++) {
                        var vlocityDataPackKey = lookupDataPacks[i].vlocityDataPackKey;
                        this.jobInfo.deltaCheckResults[vlocityDataPackKey] = { status: 'Unknown' };
                    }
                }
            }
        } while (!queryResultIsEmpty);
    }

    await this.compareQueryResultWithDataPacks(this.jobInfo, queryResultsMap, this.deltaCheckJobInfo.contextDataToCompareAgainst);
};

DeltaCheck.prototype.findAllRecords = async function(dataPack, vlocityDataPackKey) {
    
    await this.processDataPack(dataPack, vlocityDataPackKey);

    for (var dataPackField in dataPack) {
        if (dataPack[dataPackField]) {
            if (dataPack[dataPackField] instanceof Array) {
                for (var i = 0; i < dataPack[dataPackField].length; i++) {
                    await this.findAllRecords(dataPack[dataPackField][i], vlocityDataPackKey);
                }
            } else if (dataPack[dataPackField][0]
                && dataPack[dataPackField][0] instanceof Object
                && dataPack[dataPackField][0].VlocityRecordSObjectType) {
                await this.findAllRecords(dataPack[dataPackField][0], vlocityDataPackKey);
            } else if (dataPack[dataPackField].VlocityDataPackType === 'VlocityLookupMatchingKeyObject') {
                await this.processDataPack(dataPack[dataPackField], vlocityDataPackKey);
            }
        }
    }
};

DeltaCheck.prototype.processDataPack = async function(dataPackData, vlocityDataPackKey) {
    
    var sObjectType = dataPackData.VlocityRecordSObjectType;

    var whereClauseHash = await this.buildUniqueKey(sObjectType, vlocityDataPackKey, dataPackData);

    if (whereClauseHash) {
        var vlocityRecordSourceKey;

        if (dataPackData.VlocityDataPackType === 'SObject') {
            vlocityRecordSourceKey = dataPackData.VlocityRecordSourceKey;

            if (!this.deltaCheckJobInfo.contextDataToCompareAgainst[sObjectType]) {
                this.deltaCheckJobInfo.contextDataToCompareAgainst[sObjectType] = {};
            }

            this.deltaCheckJobInfo.contextDataToCompareAgainst[sObjectType][whereClauseHash] = dataPackData;
            this.deltaCheckJobInfo.recordSourceKeyToDataPackKey[vlocityRecordSourceKey] = vlocityDataPackKey;
        } else if (dataPackData.VlocityDataPackType === 'VlocityLookupMatchingKeyObject') {
            vlocityRecordSourceKey = dataPackData.VlocityLookupRecordSourceKey;
        }

        if (!this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[sObjectType]) {
            this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[sObjectType] = {};    
        }

        this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[sObjectType][whereClauseHash] = vlocityRecordSourceKey;

        if (!this.querySObjectsInfo[sObjectType]) {
            this.querySObjectsInfo[sObjectType] = {};
        }

        if (!this.querySObjectsInfo[sObjectType][whereClauseHash]) {
            this.querySObjectsInfo[sObjectType][whereClauseHash] = {};
            this.querySObjectsInfo[sObjectType][whereClauseHash].whereClause = whereClauseHash;
        }
    } else if (whereClauseHash === "") {
        this.jobInfo.deltaCheckResults[vlocityDataPackKey] = { status: 'Unknown' };
    }
};

DeltaCheck.prototype.compareQueryResultWithDataPacks = async function(jobInfo, queryResult, dataPacks) {
    for (var sObjectType in queryResult) {
        for (var whereClauseHashKey in queryResult[sObjectType]) {
            if (!dataPacks[sObjectType] || !dataPacks[sObjectType][whereClauseHashKey]) {
                var recordSourceKey = this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[sObjectType][whereClauseHashKey];
                var vlocityDataPackKey = this.deltaCheckJobInfo.recordSourceKeyToDataPackKey[recordSourceKey];
                jobInfo.deltaCheckResults[vlocityDataPackKey] = { status: 'Changed' };
            }
        }
    }

    for (var sObjectType in dataPacks) {
        for (var whereClauseHashKey in dataPacks[sObjectType]) {
            if (!queryResult[sObjectType] || !(queryResult[sObjectType][whereClauseHashKey])) {
                var recordSourceKey = this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[sObjectType][whereClauseHashKey];
                var vlocityDataPackKey = this.deltaCheckJobInfo.recordSourceKeyToDataPackKey[recordSourceKey];
                jobInfo.deltaCheckResults[vlocityDataPackKey] = { status: 'Changed' };
            } else {
                var dataPackData = dataPacks[sObjectType][whereClauseHashKey];
                var secondSObject = queryResult[sObjectType][whereClauseHashKey];

                if (!dataPackData.VlocityRecordSObjectType) {
                    dataPackData.VlocityRecordSObjectType = sObjectType;
                }
                
                await this.compareDataPackWithSObject(jobInfo, dataPackData, secondSObject, whereClauseHashKey);
            }
        }
    }
};

DeltaCheck.prototype.compareDataPackWithSObject = async function(jobInfo, dataPackData, sObject, whereClauseHashKey) {
    var vlocityRecordSObjectType = dataPackData.VlocityRecordSObjectType;
    var recordSourceKey = this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[vlocityRecordSObjectType][whereClauseHashKey];
    var vlocityDataPackKey = this.deltaCheckJobInfo.recordSourceKeyToDataPackKey[recordSourceKey];
    var textIdFields = this.vlocity.datapacksutils.getDeltaCheckTextIdField(this.vlocity.utilityservice.replaceNamespaceWithDefault(vlocityRecordSObjectType));

    if (textIdFields) {
        textIdFields = this.vlocity.utilityservice.checkNamespacePrefix(textIdFields);
    }

    if (!(jobInfo.deltaCheckResults[vlocityDataPackKey]
        && jobInfo.deltaCheckResults[vlocityDataPackKey].status 
        && jobInfo.deltaCheckResults[vlocityDataPackKey].status === 'Changed')) {

        this.removeUnhashableFields(dataPackData);
        this.removeUnhashableFields(sObject, recordSObjectType);

        for (var fieldName in dataPackData) {
            var dataPackValue = dataPackData[fieldName];
            var sObjectValue = sObject[fieldName];

            if (dataPackValue instanceof Array) {
                continue;
            }
                
            if (dataPackValue instanceof Object) {
                if (!dataPackValue.VlocityRecordSObjectType) {
                    continue;
                }

                var recordSObjectType = dataPackValue.VlocityRecordSObjectType;
                var matchingKeyFieldValue = dataPackValue.VlocityLookupRecordSourceKey ?  dataPackValue.VlocityLookupRecordSourceKey : dataPackValue.VlocityMatchingRecordSourceKey;

                if (this.deltaCheckJobInfo.recordSourceKeyToId[recordSObjectType]) {
                    dataPackValue = this.deltaCheckJobInfo.recordSourceKeyToId[recordSObjectType][matchingKeyFieldValue];
                } else {
                    dataPackValue = null;
                }
            }

            if (sObjectValue && dataPackValue
                && this.sObjectInfo[vlocityRecordSObjectType].fieldsDefinitionsMap[fieldName]
                && this.sObjectInfo[vlocityRecordSObjectType].fieldsDefinitionsMap[fieldName].type === 'datetime') {
                dataPackValue = dataPackValue.substring(0, dataPackValue.indexOf('.'));
                sObjectValue = sObjectValue.substring(0, sObjectValue.indexOf('.'));
            }

            var textIdFieldFound = false;

            if (textIdFields) {
                for (var i = 0; i < textIdFields.length; i++) {
                    if (textIdFields[i] === fieldName) {
                        textIdFieldFound = true;
                    }
                }
            }

            if (dataPackValue && sObjectValue
                && this.sObjectInfo[vlocityRecordSObjectType].fieldsDefinitionsMap[fieldName]
                && (this.sObjectInfo[vlocityRecordSObjectType].fieldsDefinitionsMap[fieldName].type == 'reference')
                    || textIdFieldFound) {
                    sObjectValue = sObjectValue.substring(0, 15);
                    dataPackValue = dataPackValue.substring(0, 15);
            }

            if (sObject.hasOwnProperty(fieldName)) {
                if (sObjectValue == null) {
                    sObjectValue = "";
                }

                if (dataPackValue !== sObjectValue) {
                    if (!jobInfo.deltaCheckResults[vlocityDataPackKey]
                        || (jobInfo.deltaCheckResults[vlocityDataPackKey] && !jobInfo.deltaCheckResults[vlocityDataPackKey].records)) {
                        jobInfo.deltaCheckResults[vlocityDataPackKey] = { status: 'Changed', records: []}
                    }

                    jobInfo.deltaCheckResults[vlocityDataPackKey].records.push({ 
                        fieldName : [fieldName],
                        sObjectValue: sObjectValue,
                        dataPackValue: dataPackValue,
                        recordType: dataPackData.VlocityRecordSObjectType
                    });
                }
            }
        }

        if (!jobInfo.deltaCheckResults[vlocityDataPackKey]) {
            jobInfo.deltaCheckResults[vlocityDataPackKey] = { status: 'Unchanged' };
            jobInfo.currentStatus[vlocityDataPackKey] = 'Success';
        }
    }
};

DeltaCheck.prototype.removeUnhashableFields = function(dataPackData, recordSObjectType) {

    if (!recordSObjectType) {
        recordSObjectType = dataPackData.VlocityRecordSObjectType;
    }

    if (recordSObjectType) {
        recordSObjectType = this.vlocity.utilityservice.replaceNamespaceWithDefault(recordSObjectType);

        var unhashableFields = this.deltaCheckJobInfo.unhashableFields[recordSObjectType];

        if (!unhashableFields) {
            unhashableFields = this.vlocity.datapacksutils.getUnhashableFields(null, recordSObjectType);
    
            if (unhashableFields) {
                unhashableFields = JSON.parse(this.vlocity.utilityservice.checkNamespacePrefix(JSON.stringify(unhashableFields)));
                this.deltaCheckJobInfo.unhashableFields[recordSObjectType] = unhashableFields;
            }
        }
    
        if (unhashableFields) {
            unhashableFields.forEach(function(field) {
                delete dataPackData[field];
            });
        }
    }
};

DeltaCheck.prototype.buildQueryMap = async function(sObjects, queryChildren) {
    sObjects = await this.processSObjectsForQuery(sObjects);
        
    for (sObjectType in sObjects) {
        for (var i = 0; i < sObjects[sObjectType].length; i++) {
            
            var sObject = sObjects[sObjectType][i];
            var dataPack = sObject;
            var vlocityRecordSourceKey = sObject.vlocityRecordSourceKey;
            var whereClause;

            if (!this.sObjectInfo[sObjectType]) {
                this.sObjectInfo[sObjectType] = {};
            }

            var sObjectDescribe = this.sObjectInfo[sObjectType].sObjectDescribe;

            if (!sObjectDescribe) {
                sObjectDescribe = await this.vlocity.utilityservice.describeSObject(sObjectType);
                this.sObjectInfo[sObjectType].sObjectDescribe = sObjectDescribe;
            }

            var fieldsDefinitionsMap = this.sObjectInfo[sObjectType].fieldsDefinitionsMap;
            
            if (!fieldsDefinitionsMap) {
                fieldsDefinitionsMap = this.vlocity.utilityservice.getFieldsDefinitionsMap(sObjectDescribe);
                this.sObjectInfo[sObjectType].fieldsDefinitionsMap = fieldsDefinitionsMap;
            }

            if (this.deltaCheckJobInfo.recordSourceKeyToDataPack[sObjectType]
                && this.deltaCheckJobInfo.recordSourceKeyToDataPack[sObjectType][vlocityRecordSourceKey]) {
                dataPack = this.deltaCheckJobInfo.recordSourceKeyToDataPack[sObjectType][vlocityRecordSourceKey];
            }

            delete sObjects[sObjectType][i].vlocityDataPackKey;
            delete sObjects[sObjectType][i].vlocityRecordSourceKey;
                    
            whereClause = this.buildWhereClauseHash(Object.keys(sObject), sObject, fieldsDefinitionsMap, sObjectType);

            if (!this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[sObjectType]) {
                this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[sObjectType] = {};    
            }

            this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[sObjectType][whereClause] = vlocityRecordSourceKey;

            if (!queryChildren && !this.deltaCheckJobInfo.contextDataToCompareAgainst[sObjectType]) {
                this.deltaCheckJobInfo.contextDataToCompareAgainst[sObjectType] = {};
            }

            if (!queryChildren) {
                this.deltaCheckJobInfo.contextDataToCompareAgainst[sObjectType][whereClause] = dataPack; 
            }

            var querySObject = this.deltaCheckJobInfo.deltaCheckMatchingKeyNotQueryable[sObjectType];

            if (typeof querySObject === 'undefined') {
                querySObject = this.vlocity.datapacksutils.getDeltaCheckMatchingKeyNotQueryable(sObjectType) ? false: true;
                this.deltaCheckJobInfo.deltaCheckMatchingKeyNotQueryable[sObjectType] = querySObject;
            }

            if (!querySObject && !queryChildren) {
                continue;
            }

            if (!this.querySObjectsInfo[sObjectType]) {
                this.querySObjectsInfo[sObjectType] = {};
            }

            this.querySObjectsInfo[sObjectType][whereClause] = {};
            this.querySObjectsInfo[sObjectType][whereClause].whereClause = whereClause;
        }
    }
};

DeltaCheck.prototype.processSObjectsForQuery = async function(sObjects) {
    var replacedKeyMap = {};

    for (var sObjectType in sObjects) {
        
        var sObjectsLength = sObjects[sObjectType].length-1;

        for (var i = sObjectsLength; i >= 0; i--) {
            if (!replacedKeyMap[sObjectType]) {
                replacedKeyMap[sObjectType] = [];
            }
            
            var sObjectRecord = sObjects[sObjectType][i];
            var sObjectMap = {};
            var lookupSObjectNotFound = false;

            for (var fieldName in sObjectRecord) {
                if (!lookupSObjectNotFound) {
                    var fieldValue = sObjectRecord[fieldName];

                    if (fieldValue instanceof Object) {   
                        for (var key in fieldValue) {
                            if (this.deltaCheckJobInfo.recordSourceKeyToId[fieldName]
                                && this.deltaCheckJobInfo.recordSourceKeyToId[fieldName].hasOwnProperty(fieldValue[key])) {
                                sObjectMap[key] = this.deltaCheckJobInfo.recordSourceKeyToId[fieldName][fieldValue[key]];
                            } else {
                                lookupSObjectNotFound = true;
                                break;
                            }       
                        }
                    } else if (fieldName === 'vlocityDataPackKey' || fieldName === 'vlocityRecordSourceKey') {
                        sObjectMap[fieldName] = fieldValue;
                        continue;
                    } else {
                        sObjectMap[fieldName] = fieldValue;
                    }
                }
            }

            if (!lookupSObjectNotFound && !this.vlocity.utilityservice.isEmptyObject(sObjectMap)) {
                replacedKeyMap[sObjectType][i] = sObjectMap;

                sObjects[sObjectType].splice(i, 1);

                if (this.vlocity.utilityservice.isEmptyObject(sObjects[sObjectType])) {
                    delete sObjects[sObjectType];
                    break;
                }
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

DeltaCheck.prototype.executeQueries = async function(queriesMap) {
    var queriesList = await this.buildQueries(queriesMap);
    var queriedRecordsMap = {};
    var queryPromises = [];

    for (var query of queriesList) {
        queryPromises.push({ context: this, argument: { sObjectType: query.sObjectType, query: query.fullQuery, queriedRecordsMap: queriedRecordsMap }, func: 'runQuery' });
    }

    await this.vlocity.utilityservice.parallelLimit(queryPromises);
    return queriedRecordsMap;
};

DeltaCheck.prototype.runQuery = async function(inputMap) {
    var query = inputMap.query;
    var queryResult = await this.vlocity.queryservice.query(query);

    if (queryResult && queryResult.records.length > 0) {
        await this.processQueryResult(queryResult, inputMap.sObjectType, inputMap.queriedRecordsMap);
    }
};

DeltaCheck.prototype.processQueryResult = async function(queryResult, sObjectType, queriedRecordsMap) {
    if (!queriedRecordsMap[sObjectType]) {
        queriedRecordsMap[sObjectType] = {};
    }
            
    for (var i = 0; i < queryResult.records.length; i++) {
         
        var sObject = queryResult.records[i];
        var whereClauseHash = await this.buildUniqueKey(sObjectType, null, sObject, null);
        var recordSourceKey;

        if (this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[sObjectType]
            && this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[sObjectType][whereClauseHash]) {
            
            recordSourceKey = this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[sObjectType][whereClauseHash];

            if (!this.deltaCheckJobInfo.recordSourceKeyToId[sObjectType]) {
                this.deltaCheckJobInfo.recordSourceKeyToId[sObjectType] = {};
            }
                
            this.deltaCheckJobInfo.recordSourceKeyToId[sObjectType][recordSourceKey] = sObject.Id;
            this.deltaCheckJobInfo.recordSourceKeyToId[sObjectType][sObject.Id] = recordSourceKey;
        }

        if (this.deltaCheckJobInfo.childToParentLookupField[sObjectType]) {
            var parentField = this.deltaCheckJobInfo.childToParentLookupField[sObjectType].idField;
            var parentValue = sObject[parentField];
            var parentType = this.deltaCheckJobInfo.childToParentLookupField[sObjectType].sObjectType;
            var parentSourceKey = this.deltaCheckJobInfo.recordSourceKeyToId[parentType][parentValue];

            if (!recordSourceKey) {
                recordSourceKey = parentSourceKey;
            }
            
            if (!this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[sObjectType]) {
                this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[sObjectType] = {};
            }

            this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[sObjectType][whereClauseHash] = parentSourceKey;
        }

        if (this.deltaCheckJobInfo.recordSourceKeyToDataPackKey[recordSourceKey]) {
            queriedRecordsMap[sObjectType][whereClauseHash] = sObject;
        }
    }

    if (this.vlocity.utilityservice.isEmptyObject(queriedRecordsMap[sObjectType])) {
        delete queriedRecordsMap[sObjectType];
    }
};

DeltaCheck.prototype.buildQueries = async function(queriesMap) {
    var queries = [];

    for (var sObjectType in queriesMap) {
        var query = { sObjectType: sObjectType };

        query.querySelect = queriesMap[sObjectType].querySelect;

        if (!query.querySelect) {
            query.querySelect = this.buildQuerySelect(this.sObjectInfo[sObjectType].sObjectDescribe);
            queriesMap[sObjectType].querySelect = query.querySelect;
        }

        query.whereClause = '';
        query.queryBase = 'SELECT ' + query.querySelect + ' FROM '+ query.sObjectType;

        for (var whereClauseHash in queriesMap[sObjectType]) {
            if (whereClauseHash === 'querySelect') {
                continue;
            }

            var whereClauseTemp = whereClauseHash; 

            if (queriesMap[sObjectType][whereClauseHash].whereClause) {
                whereClauseTemp = queriesMap[sObjectType][whereClauseHash].whereClause;
            }

            if (query.whereClause) {
                query.whereClause += ' OR ';
            }

            query.whereClause += '(' + whereClauseTemp + ')';

            if (query.whereClause.length > 10000) {
                queries.push(JSON.parse(JSON.stringify(query)));
                query.whereClause = '';
            }
        }

        if (query.whereClause) {
            queries.push(query);
        }

        for (var query of queries) {
            query.fullQuery = query.queryBase + ' WHERE ' + query.whereClause;
        }
    }

    return queries;
};

DeltaCheck.prototype.buildQuerySelect = function(sObjectDescribe) {
    return Object.keys(this.vlocity.utilityservice.getFieldsDefinitionsMap(sObjectDescribe));
};

DeltaCheck.prototype.addChildrenQuery = async function(sObjectType, sObject, vlocityRecordSourceKey) {
    
    var queryForChildren = this.deltaCheckJobInfo.deltaQueryChildrenDefinition[sObjectType];

    if (!queryForChildren) {
        queryForChildren = this.vlocity.datapacksutils.getDeltaQueryChildren(null, this.vlocity.utilityservice.replaceNamespaceWithDefault(sObjectType));
    }

    if (queryForChildren) {
        queryForChildren = this.vlocity.utilityservice.checkNamespacePrefix(queryForChildren);
        this.deltaCheckJobInfo.deltaQueryChildrenDefinition[sObjectType] = queryForChildren;

        for (var childSObjectType in queryForChildren) {
            if (!this.deltaCheckJobInfo.queryForChildren[childSObjectType]) {
                this.deltaCheckJobInfo.queryForChildren[childSObjectType] = [];
        }

        var queryRecord = { vlocityRecordSourceKey: vlocityRecordSourceKey };
        var idField;

        for (var fieldName in queryForChildren[childSObjectType]) {
            var lookupField = queryForChildren[childSObjectType][fieldName];
            var lookupFieldValue;

            if (typeof(lookupField) === 'boolean') {
                lookupFieldValue = lookupField;
            } else {
                lookupFieldValue = sObject[lookupField];
                idField = fieldName;
            }
                queryRecord[fieldName] = lookupFieldValue;
            }

            this.deltaCheckJobInfo.queryForChildren[childSObjectType].push(queryRecord);
                
            this.deltaCheckJobInfo.childToParentLookupField[childSObjectType] = { 
                idField: idField,
                sObjectType : sObjectType
            };
        }
    }
};

DeltaCheck.prototype.buildUniqueKey = async function(sObjectType, vlocityDataPackKey, sObject) {
    
    var vlocityRecordSourceKey = sObject.VlocityRecordSourceKey;
    var errorHappen = false;

    if (!this.sObjectInfo[sObjectType]) {
        this.sObjectInfo[sObjectType] = {};
    }

    if (!this.sObjectInfo[sObjectType].sObjectDescribe) {
        this.sObjectInfo[sObjectType].sObjectDescribe = await this.vlocity.utilityservice.describeSObject(sObjectType);

        if (!this.sObjectInfo[sObjectType].sObjectDescribe) {
            errorHappen = true;
        }
    }
    
    if (!errorHappen) {
        if (!this.sObjectInfo[sObjectType].matchingKeyField) {
            this.sObjectInfo[sObjectType].matchingKeyField = this.vlocityMatchingKeys[sObjectType];   
        }
    
        if (!this.sObjectInfo[sObjectType].fieldsDefinitionsMap) {
            this.sObjectInfo[sObjectType].fieldsDefinitionsMap = this.vlocity.utilityservice.getFieldsDefinitionsMap(this.sObjectInfo[sObjectType].sObjectDescribe);
        }
    
        var matchingKeyField = this.sObjectInfo[sObjectType].matchingKeyField;

        if (!matchingKeyField) {
            matchingKeyField = this.getDeltaCheckMatchingKeyFields(sObjectType, sObject);
        }
        
        if (matchingKeyField && (matchingKeyField instanceof Array || matchingKeyField.includes(','))) { 

            if (matchingKeyField.includes(',')) {
                matchingKeyField = matchingKeyField.split(',');
            }
            
            var lookupSObjectFound = false;
            var sObjectRecord = {};
            
            for (var i = 0; i < matchingKeyField.length; i++) {
                if (this.sObjectInfo[sObjectType].fieldsDefinitionsMap[matchingKeyField[i]]) {
                    var referenceSObject = sObject[matchingKeyField[i]];  
    
                    if (referenceSObject instanceof Object) {
                        lookupSObjectFound = true;
    
                        if (referenceSObject.VlocityLookupRecordSourceKey) {
                            matchingKeyFieldValue = referenceSObject.VlocityLookupRecordSourceKey;
                        } else if (referenceSObject.VlocityMatchingRecordSourceKey) {
                            matchingKeyFieldValue = referenceSObject.VlocityMatchingRecordSourceKey;
                        }
                        
                        sObjectRecord[referenceSObject.VlocityRecordSObjectType] = {};
                        sObjectRecord[referenceSObject.VlocityRecordSObjectType][matchingKeyField[i]] = matchingKeyFieldValue;
                        matchingKeyFieldValue = '';
                    } else {
                        sObjectRecord[matchingKeyField[i]] = referenceSObject;
                    }
                }
            }
    
            if (lookupSObjectFound
                && vlocityDataPackKey 
                && !this.vlocity.utilityservice.isEmptyObject(sObjectRecord)) {
                    if (sObjectType !== 'RecordType') {
                        sObjectRecord.vlocityDataPackKey = vlocityDataPackKey;
                        sObjectRecord.vlocityRecordSourceKey = vlocityRecordSourceKey;
        
                        if (!this.deltaCheckJobInfo.replaceRecordSourceKeyWithId[sObjectType]) {
                            this.deltaCheckJobInfo.replaceRecordSourceKeyWithId[sObjectType] = [];
                        }
                        
                        this.deltaCheckJobInfo.replaceRecordSourceKeyWithId[sObjectType].push(sObjectRecord);   
                        this.deltaCheckJobInfo.recordSourceKeyToDataPackKey[vlocityRecordSourceKey] = vlocityDataPackKey;
                        
                        if (!this.deltaCheckJobInfo.recordSourceKeyToDataPack[sObjectType]) {
                            this.deltaCheckJobInfo.recordSourceKeyToDataPack[sObjectType] = {};
                        }

                        this.deltaCheckJobInfo.recordSourceKeyToDataPack[sObjectType][vlocityRecordSourceKey] = sObject;
                    }

                    return;
            }
        }
    
        if (!(matchingKeyField instanceof Array)) {
            matchingKeyField = [matchingKeyField];
        }
    
        return this.buildWhereClauseHash(matchingKeyField, sObject, this.sObjectInfo[sObjectType].fieldsDefinitionsMap, sObjectType);
    }

    return "";
};

DeltaCheck.prototype.getDeltaCheckMatchingKeyFields = function(sObjectType, sObject) {
    var deltaCheckMatchingKey = this.vlocity.datapacksutils.getDeltaCheckMatchingKey(sObjectType);

    if (deltaCheckMatchingKey) {
        var matchingKeyField = [];
        
        for (var matchField of deltaCheckMatchingKey) {
            if (typeof matchField  === 'string') {
                matchingKeyField.push(this.vlocity.utilityservice.checkNamespacePrefix(matchField));
            } else {
                var fieldKey = Object.keys(matchField)[0];
                matchingKeyField.push(this.vlocity.utilityservice.checkNamespacePrefix(fieldKey));

                sObject[this.vlocity.utilityservice.checkNamespacePrefix(fieldKey)] = matchField[fieldKey];
            }
        }

        return matchingKeyField;
    }

    return null;
}

DeltaCheck.prototype.buildWhereClauseHash = function(matchingKeyField, sObject, fieldsDefinitionsMap, sObjectType) {
    var fieldsValuesMap = {};
    var fieldsDefinitionsMapReduced = {};
    
    if (matchingKeyField instanceof Array) {
        for (var i = 0; i < matchingKeyField.length; i++) {
            var matchingFieldValue = sObject[matchingKeyField[i]];

            if (!matchingFieldValue && typeof(matchingFieldValue) !== 'boolean') {
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
        }
    }

    return this.vlocity.queryservice.buildWhereClause(fieldsValuesMap, fieldsDefinitionsMapReduced);
};