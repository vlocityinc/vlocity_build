var stringify = require('fast-json-stable-stringify');

var DeltaCheck = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};
};

DeltaCheck.prototype.deltaCheck = async function(jobName, jobInfo, currentContextData) {
    
    this.jobInfo = jobInfo;
    
    this.jobInfo[jobName] = true;

    this.jobInfo.deltaCheckResults = {};

    this.querySObjectsInfo = {};

    this.metadataCheckInfo = {};

    this.checkStaleObjectsInfo = {
        recordSourceKeyToDataPackKey : {}
    };

    this.autoFixPicklistsInfo = {
        restrictedPicklists : {},
        deployPicklistValues: {}
    };

    this.deltaCheckJobInfo = {
        deltaQueryChildrenDefinition: {},
        queryForChildren: {},
        childObjectsForQueries: {},
        childToParentInfos: {},
        contextDataToCompareAgainst: {},
        unhashableFields: {},
        recordSourceKeyToId: {},
        recordSourceKeyToDataPack: {},
        sObjectsToQueryFor: {},
        recordSourceKeyToDataPackKey: {},
        whereClauseHashToVlocityRecordSourceKey: {},
        childHashToParentVlocityRecordSourceKey: {}
    };

    this.vlocityMatchingKeys = await this.vlocity.utilityservice.getDRMatchingKeyFields();
    
    await this.getAllRecordsToQueryFor(currentContextData);

    await this['execute' + jobName]();
};

DeltaCheck.prototype.runAutoFixPicklists = async function(jobInfo, currentContextData) {
    return this.deltaCheck('AutoFixPicklists', jobInfo, currentContextData);
};

DeltaCheck.prototype.runCheckStaleObjects = async function(jobInfo, currentContextData) {
    return this.deltaCheck('CheckStaleObjects', jobInfo, currentContextData);
};

DeltaCheck.prototype.runMetadataCheck = async function(jobInfo, currentContextData) {
    return this.deltaCheck('MetadataCheck', jobInfo, currentContextData);
};

DeltaCheck.prototype.runDeltaCheck = async function(jobInfo, currentContextData) {
    return this.deltaCheck('DeltaCheck', jobInfo, currentContextData);
};

DeltaCheck.prototype.executeAutoFixPicklists = async function() {
    
    var retrievedCustomObjects = {};
    
    for (var sObjectType in this.autoFixPicklistsInfo.deployPicklistValues) {
        var customObject = retrievedCustomObjects[sObjectType];
        var globalValueSet = [];

        if (!customObject) {
            customObject = await this.vlocity.utilityservice.retrieveCustomObject(sObjectType);
            retrievedCustomObjects[sObjectType] = customObject;
        }

        for (var i = 0; i < customObject.fields.length; i++) {
            var fieldDefinition = customObject.fields[i];
            var fieldName = customObject.fields[i].fullName;

            if (this.autoFixPicklistsInfo.deployPicklistValues[sObjectType].hasOwnProperty(fieldName)) {
                var dataPackPicklistValues = this.autoFixPicklistsInfo.deployPicklistValues[sObjectType][fieldName];

                if (fieldDefinition.valueSet
                    && fieldDefinition.valueSet.valueSetName
                    && !fieldDefinition.valueSet.valueSetDefinition) {
                    var updatedGlobalValueSet = await this.updateGlobalValueSet(fieldDefinition.valueSet.valueSetName, dataPackPicklistValues);
                    globalValueSet.push(updatedGlobalValueSet);
                    continue;
                }

                if (!(fieldDefinition.valueSet.valueSetDefinition.value instanceof Array)) {
                    fieldDefinition.valueSet.valueSetDefinition.value = [fieldDefinition.valueSet.valueSetDefinition.value];
                }

                var fieldValues = fieldDefinition.valueSet.valueSetDefinition.value;

                for (var y = 0; y < dataPackPicklistValues.length; y++) {
                    var valueFound = false;

                    if (dataPackPicklistValues[y].includes(';')) {
                        dataPackPicklistValues[y] = dataPackPicklistValues[y].split(';');
                    } else {
                        dataPackPicklistValues[y] = [dataPackPicklistValues[y]];
                    }

                    for (var dataPackPickListValue of dataPackPicklistValues[y]) {
                        var valueFound = false;

                        for (var fieldValue of fieldValues) {
                            if (fieldValue.fullName === dataPackPickListValue) {
                                valueFound = true;
                                break;
                            }
                        }

                        if (!valueFound) {
                            fieldValues.push({fullName: dataPackPickListValue, default: false, isActive: true, label: dataPackPickListValue});
                        }
                    }
                }
            }
        }

        await this.vlocity.utilityservice.updateCustomObject(customObject);
        await this.vlocity.utilityservice.updateGlobalValueSet(globalValueSet);
    }
};

DeltaCheck.prototype.updateGlobalValueSet = async function(valueSetName, dataPackPicklistValues) {
    retrievedMetadata = await this.vlocity.utilityservice.retrieveGlobalValueSet(valueSetName);

    if (retrievedMetadata) {
        if (!(retrievedMetadata.customValue instanceof Array)) {
            retrievedMetadata.customValue = [retrievedMetadata.customValue];
        }

        for (var y = 0; y < dataPackPicklistValues.length; y++) {
            if (dataPackPicklistValues[y].includes(';')) {
                dataPackPicklistValues[y] = dataPackPicklistValues[y].split(';');
            } else {
                dataPackPicklistValues[y] = [dataPackPicklistValues[y]];
            }
                
            for (var dataPackPickListValue of dataPackPicklistValues[y]) {
                var valueFound = false;

                for (var orgValue of retrievedMetadata.customValue) {
                    if (orgValue.fullName === dataPackPickListValue) {
                        valueFound = true;
                        break;
                    }
                }

                if (!valueFound) {
                    retrievedMetadata.customValue.push({default: false, fullName: dataPackPickListValue, label: dataPackPickListValue});
                }
            }
        }

        return retrievedMetadata;
    }
};

DeltaCheck.prototype.executeMetadataCheck = async function() {

    for (var sObject in this.metadataCheckInfo) {
        var fieldName = this.metadataCheckInfo[sObject].fieldName;
        var query = 'SELECT ' + fieldName + ' FROM ' + sObject;

        var result = await this.vlocity.queryservice.query(query);   
            
        if (!result) {
            for (var i = 0; i < this.metadataCheckInfo[sObject].vlocityDataPackKey.length; i++) {
                var vlocityDataPackKey = this.metadataCheckInfo[sObject].vlocityDataPackKey[i];
                
                var errorMessage = 'Error Message -- Object Field Attribute references a field that does not exist in the target Org. ' + sObject + '.' + fieldName;

                this.jobInfo.deltaCheckResults[vlocityDataPackKey] = { 
                    status: 'Error',
                    errorMessage: errorMessage
                };   
            }

            delete this.metadataCheckInfo[sObject];
        }
    }

    for (var sObject in this.metadataCheckInfo) {
        for (var i = 0; i < this.metadataCheckInfo[sObject].vlocityDataPackKey.length; i++) {
            this.jobInfo.deltaCheckResults[this.metadataCheckInfo[sObject].vlocityDataPackKey[i]] = { status: 'Ready' };   
        }
    }
};

DeltaCheck.prototype.executeCheckStaleObjects = async function() {

    if (!this.vlocity.utilityservice.isEmptyObject(this.querySObjectsInfo)) {
        for (var sObjectType in this.querySObjectsInfo) {
            for (var whereClauseHash in this.querySObjectsInfo[sObjectType]) {
                var vlocityRecordSourceKey = this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[sObjectType][whereClauseHash];
                var vlocityDataPackKeys = this.checkStaleObjectsInfo.recordSourceKeyToDataPackKey[vlocityRecordSourceKey]; 

                if (this.deltaCheckJobInfo.recordSourceKeyToDataPackKey[vlocityRecordSourceKey]) {
                    for (var vlocityDataPackKey in vlocityDataPackKeys) {
                        this.jobInfo.deltaCheckResults[vlocityDataPackKey] = { status: 'Ready' };
                    }

                    delete this.querySObjectsInfo[sObjectType][whereClauseHash];
                }
            }
        }

        var queryResult = await this.executeQueries(this.querySObjectsInfo);

        for (var sObjectType in this.querySObjectsInfo) {
            for (var whereClauseHash in this.querySObjectsInfo[sObjectType]) {
                if (whereClauseHash === 'querySelect') {
                    delete this.querySObjectsInfo[sObjectType][whereClauseHash];
                    continue;
                }

                var vlocityRecordSourceKey = this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[sObjectType][whereClauseHash];
                var vlocityDataPackKeys = this.checkStaleObjectsInfo.recordSourceKeyToDataPackKey[vlocityRecordSourceKey]; 

                if (!queryResult[sObjectType] || !queryResult[sObjectType][whereClauseHash]) {
                    for (var vlocityDataPackKey in vlocityDataPackKeys) {
                        var errorMessage = vlocityDataPackKey + ' -- DataPack -- Error Message -- This DataPack has a reference to another object which was not found -- ' + vlocityRecordSourceKey;

                        this.jobInfo.deltaCheckResults[vlocityDataPackKey] = { 
                            status: 'Error',
                            errorMessage: errorMessage
                        };
                    }

                    delete this.querySObjectsInfo[sObjectType][whereClauseHash];
                }
            }
        }

        for (var sObjectType in this.querySObjectsInfo) {
            for (var whereClauseHash in this.querySObjectsInfo[sObjectType]) {
                if (whereClauseHash === 'querySelect') {
                    continue;
                }

                var vlocityRecordSourceKey = this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[sObjectType][whereClauseHash];
                var vlocityDataPackKeys = this.checkStaleObjectsInfo.recordSourceKeyToDataPackKey[vlocityRecordSourceKey];  

                for (var vlocityDataPackKey in vlocityDataPackKeys) {
                    if (!this.jobInfo.deltaCheckResults[vlocityDataPackKey]) {
                        this.jobInfo.deltaCheckResults[vlocityDataPackKey] = { status: 'Ready' };
                    }
                }
            }
        }
    }
};

/**
 * The method will query all sObjects in the org and determine the state of DataPack by comparison queried with local context data.
 */
DeltaCheck.prototype.executeDeltaCheck = async function() {
    if (!this.vlocity.utilityservice.isEmptyObject(this.querySObjectsInfo)) {
        var queryResultsMap = {};

        do {
            if (!this.vlocity.utilityservice.isEmptyObject(this.deltaCheckJobInfo.sObjectsToQueryFor)) {
                await this.buildQueryMap(this.deltaCheckJobInfo.sObjectsToQueryFor, false);
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
            
            if (queryResultIsEmpty && !this.vlocity.utilityservice.isEmptyObject(this.deltaCheckJobInfo.sObjectsToQueryFor)) {
                for (var sObjectType in this.deltaCheckJobInfo.sObjectsToQueryFor) {
                    var lookupDataPacks = this.deltaCheckJobInfo.sObjectsToQueryFor[sObjectType];
    
                    for (var i = 0; i < lookupDataPacks.length; i++) {
                        var vlocityDataPackKey = lookupDataPacks[i].vlocityDataPackKey;
                        this.jobInfo.deltaCheckResults[vlocityDataPackKey] = { status: 'Unknown' };
                    }
                }
            }
        } while (!queryResultIsEmpty);
    
        await this.compareQueryResultWithDataPacks(this.jobInfo, queryResultsMap, this.deltaCheckJobInfo.contextDataToCompareAgainst);
    }
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

DeltaCheck.prototype.getSObjectMetadata = async function(sObjectType) {
    if (sObjectType == 'RecordType') {
        return null;
    }
    
    if (!this.sObjectInfo) {
        this.sObjectInfo = {};
    }

    if (!this.sObjectInfo[sObjectType]) {
        this.sObjectInfo[sObjectType] = {};
    }

    if (sObjectType && !this.sObjectInfo[sObjectType].sObjectDescribe) {
        this.sObjectInfo[sObjectType].sObjectDescribe = this.vlocity.utilityservice.describeSObject(sObjectType);

       
    } 
    
    this.sObjectInfo[sObjectType].sObjectDescribe = await this.sObjectInfo[sObjectType].sObjectDescribe;

    if (!this.sObjectInfo[sObjectType].sObjectDescribe) {
        if (!this.vlocity.isOmniStudioInstalled) {
            VlocityUtils.error('Error', 'SObject Does Not Exist', sObjectType);
        }
        return null;
    }

    if (!this.sObjectInfo[sObjectType].fieldsDefinitionsMap) {
        this.sObjectInfo[sObjectType].fieldsDefinitionsMap = this.vlocity.utilityservice.getFieldsDefinitionsMap(this.sObjectInfo[sObjectType].sObjectDescribe);
    }

    if (!this.sObjectInfo[sObjectType].matchingKeyField && this.vlocityMatchingKeys) {
        this.sObjectInfo[sObjectType].matchingKeyField = this.vlocityMatchingKeys[sObjectType];
    }

    return this.sObjectInfo[sObjectType]
}

DeltaCheck.prototype.processDataPack = async function(dataPackData, vlocityDataPackKey) {
    
    var sObjectType = dataPackData.VlocityRecordSObjectType;
    var vlocityLookupRecordSourceKey = dataPackData.VlocityLookupRecordSourceKey;
    var vlocityDataPackType = dataPackData.VlocityDataPackType;

    if (this.jobInfo.AutoFixPicklists) {
        await this.getSObjectMetadata(sObjectType);

        var restrictedPicklistValuesMap = {};

        if (this.sObjectInfo[sObjectType] && this.sObjectInfo[sObjectType].fieldsDefinitionsMap) {
            for (var fieldName in this.sObjectInfo[sObjectType].fieldsDefinitionsMap) {
                if (this.sObjectInfo[sObjectType].fieldsDefinitionsMap[fieldName].restrictedPicklist) {

                    if (!this.autoFixPicklistsInfo.restrictedPicklists[sObjectType]) {
                        this.autoFixPicklistsInfo.restrictedPicklists[sObjectType] = {};
                    }
                    
                    restrictedPicklistValuesMap[fieldName] = this.sObjectInfo[sObjectType].fieldsDefinitionsMap[fieldName].picklistValues;
                    this.autoFixPicklistsInfo.restrictedPicklists[sObjectType][fieldName] = this.sObjectInfo[sObjectType].fieldsDefinitionsMap[fieldName].picklistValues;
                }
            }

            for (var fieldName in restrictedPicklistValuesMap) { 

                if (!dataPackData[fieldName]) continue;

                var picklistValueFound = false;

                for (var i = 0; i < restrictedPicklistValuesMap[fieldName].length; i++) {
                    if (dataPackData[fieldName] === restrictedPicklistValuesMap[fieldName][i].value) {
                        picklistValueFound = true;
                        break;
                    }
                }

                if (!picklistValueFound) {
                    if (dataPackData[fieldName]) {
                        if (!this.autoFixPicklistsInfo.deployPicklistValues[sObjectType]) {
                            this.autoFixPicklistsInfo.deployPicklistValues[sObjectType] = {};
                        }
        
                        if (!this.autoFixPicklistsInfo.deployPicklistValues[sObjectType][fieldName]) {
                            this.autoFixPicklistsInfo.deployPicklistValues[sObjectType][fieldName] = [];
                        }
        
                        this.autoFixPicklistsInfo.deployPicklistValues[sObjectType][fieldName].push(dataPackData[fieldName]);   
                    }
                }
            }
        }

        return;  
    }

    if (this.jobInfo.MetadataCheck) {
        var deltaMetadata = this.vlocity.datapacksutils.getMetadataCheck(sObjectType);

        if (deltaMetadata) {
            var objectType = dataPackData[deltaMetadata.SObjectType];

            if (!this.metadataCheckInfo[objectType]) {
                var fieldName = dataPackData[deltaMetadata.FieldApiName];
                
                if (fieldName) {
                    this.metadataCheckInfo[objectType] = { fieldName : fieldName, vlocityDataPackKey : []};
                    this.metadataCheckInfo[objectType].vlocityDataPackKey.push(vlocityDataPackKey);
                }
            }

            return;
        }
    }

    if (this.jobInfo.CheckStaleObjects) {

        var errorFound = false;
        
        if (vlocityDataPackType === 'SObject') {
            var vlocityRecordSourceKey = dataPackData.VlocityRecordSourceKey;
            this.deltaCheckJobInfo.recordSourceKeyToDataPackKey[vlocityRecordSourceKey] = vlocityDataPackKey;

            if (!this.jobInfo.deltaCheckResults[vlocityDataPackKey]) {
                this.jobInfo.deltaCheckResults[vlocityDataPackKey] = { status: 'Ready' };
            }
        } else if (vlocityLookupRecordSourceKey) {

            var matchingKeys = this.vlocityMatchingKeys[sObjectType];

            for (var i = 0; i < matchingKeys.length; i++) {
                if (!this.checkIfMatchingKeyPresent(dataPackData,matchingKeys[i])) {
                    var errorMessage = vlocityDataPackKey + ` -- DataPack -- Error Message -- Vlocity Matching Key for ${sObjectType}`
                        + ` is different than what is being deployed. Please ensure that the Matching Key Fields are ${matchingKeys} for -- ${sObjectType}`;

                    this.jobInfo.deltaCheckResults[vlocityDataPackKey] = {
                        status: 'Error',
                        errorMessage: errorMessage
                    };

                    errorFound = true;
                    break;
                }
            }

            if (!this.checkStaleObjectsInfo.recordSourceKeyToDataPackKey[vlocityLookupRecordSourceKey]) {
                this.checkStaleObjectsInfo.recordSourceKeyToDataPackKey[vlocityLookupRecordSourceKey] = {};
            }
    
            this.checkStaleObjectsInfo.recordSourceKeyToDataPackKey[vlocityLookupRecordSourceKey][vlocityDataPackKey] = '';
        }

        if (errorFound || !vlocityLookupRecordSourceKey) {
            return;
        }
    }

    var whereClauseHash = await this.buildUniqueKey(sObjectType, vlocityDataPackKey, dataPackData);

    if (whereClauseHash) {
        var vlocityRecordSourceKey;

        if (vlocityDataPackType === 'SObject') {
            vlocityRecordSourceKey = dataPackData.VlocityRecordSourceKey;

            if (!this.deltaCheckJobInfo.contextDataToCompareAgainst[sObjectType]) {
                this.deltaCheckJobInfo.contextDataToCompareAgainst[sObjectType] = {};
            }

            this.deltaCheckJobInfo.contextDataToCompareAgainst[sObjectType][whereClauseHash] = dataPackData;
            this.deltaCheckJobInfo.recordSourceKeyToDataPackKey[vlocityRecordSourceKey] = vlocityDataPackKey;
        } else if (vlocityDataPackType === 'VlocityLookupMatchingKeyObject') {
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

DeltaCheck.prototype.checkIfMatchingKeyPresent = function(dataPackData,matchingKey) {
    return dataPackData.hasOwnProperty(matchingKey) || dataPackData.hasOwnProperty(matchingKey.replace("__c","__r.Name"));
};

DeltaCheck.prototype.compareQueryResultWithDataPacks = async function(jobInfo, queryResult, dataPacks) {
    for (var sObjectType in queryResult) {
        for (var whereClauseHashKey in queryResult[sObjectType]) {
            if (!dataPacks[sObjectType] || !dataPacks[sObjectType][whereClauseHashKey]) {
                var recordSourceKey = this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[sObjectType][whereClauseHashKey];

                if (!recordSourceKey && this.deltaCheckJobInfo.childHashToParentVlocityRecordSourceKey[sObjectType]) {
                    recordSourceKey = this.deltaCheckJobInfo.childHashToParentVlocityRecordSourceKey[sObjectType][whereClauseHashKey];
                }
                var vlocityDataPackKey = this.deltaCheckJobInfo.recordSourceKeyToDataPackKey[recordSourceKey];
                jobInfo.deltaCheckResults[vlocityDataPackKey] = { status: 'Changed' };
            }
        }
    }

    for (var sObjectType in dataPacks) {
        for (var whereClauseHashKey in dataPacks[sObjectType]) {

            var recordSourceKey = this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[sObjectType][whereClauseHashKey];
            var vlocityDataPackKey = this.deltaCheckJobInfo.recordSourceKeyToDataPackKey[recordSourceKey];

            if (jobInfo.deltaCheckResults[vlocityDataPackKey] 
            && jobInfo.deltaCheckResults[vlocityDataPackKey].status == 'Changed') {
                continue;
            }

            if (!queryResult[sObjectType] || !(queryResult[sObjectType][whereClauseHashKey])) {
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
    
    var textIdFields = this.vlocity.datapacksutils.getDeltaCheckTextIdField(vlocityRecordSObjectType);

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
                dataPackValue = this.deltaCheckJobInfo.recordSourceKeyToId[matchingKeyFieldValue];
            }

            if (sObjectValue && dataPackValue
                && this.sObjectInfo[vlocityRecordSObjectType].fieldsDefinitionsMap[fieldName]
                && this.sObjectInfo[vlocityRecordSObjectType].fieldsDefinitionsMap[fieldName].type === 'datetime') {
                dataPackValue = dataPackValue.substring(0, dataPackValue.indexOf('.'));
                sObjectValue = sObjectValue.substring(0, sObjectValue.indexOf('.'));
            }

            if (dataPackValue 
            && sObjectValue
            && this.sObjectInfo[vlocityRecordSObjectType].fieldsDefinitionsMap[fieldName]
            && (this.sObjectInfo[vlocityRecordSObjectType].fieldsDefinitionsMap[fieldName].type == 'reference')
            || textIdFields.includes(fieldName)) {

                if (typeof sObjectValue == 'string') {
                    sObjectValue = sObjectValue.substring(0, 15);
                }

                if (typeof dataPackValue == 'string') {
                    dataPackValue = dataPackValue.substring(0, 15);
                }
            }

            if (sObject.hasOwnProperty(fieldName)) {
                if (sObjectValue == null) {
                    sObjectValue = "";
                }

                try {
                    dataPackValue = stringify(JSON.parse(dataPackValue));
                    sObjectValue = stringify(JSON.parse(sObjectValue));
                } catch (e) {
                    // Can ignore
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
        var unhashableFields = this.vlocity.datapacksutils.getUnhashableFields(null, recordSObjectType);
    
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

            if (!sObject) {
                continue;
            }
            
            var vlocityRecordSourceKey = sObject.vlocityRecordSourceKey;
            var whereClause;

            if (this.deltaCheckJobInfo.recordSourceKeyToDataPack[sObjectType]
                && this.deltaCheckJobInfo.recordSourceKeyToDataPack[sObjectType][vlocityRecordSourceKey]) {
                dataPack = this.deltaCheckJobInfo.recordSourceKeyToDataPack[sObjectType][vlocityRecordSourceKey];
            }

            delete sObjects[sObjectType][i].vlocityDataPackKey;
            delete sObjects[sObjectType][i].vlocityRecordSourceKey;

            var result = await this.getSObjectMetadata(sObjectType);

            if (!result) {
                continue;
            }            

            whereClause = this.buildWhereClauseHash(Object.keys(sObject), sObject, this.sObjectInfo[sObjectType].fieldsDefinitionsMap, sObjectType);

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

            var notQueryable = this.vlocity.datapacksutils.getDeltaCheckMatchingKeyNotQueryable(sObjectType);

            if (notQueryable && !queryChildren) {
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

                    if (fieldName === 'vlocityDataPackKey' || fieldName === 'vlocityRecordSourceKey' || fieldName === 'lookupFields') {
                        sObjectMap[fieldName] = fieldValue;
                    } else if (sObjectRecord.lookupFields && sObjectRecord.lookupFields.includes(fieldName)) { 
                    
                        if (this.deltaCheckJobInfo.recordSourceKeyToId[fieldValue]) {
                            sObjectMap[fieldName] = this.deltaCheckJobInfo.recordSourceKeyToId[fieldValue];
                        } else {
                            lookupSObjectNotFound = true;
                            break;
                        }  
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
    var allFinds = [];
    for (var i = 0; i < currentContextData.length; i++) {
        var dataPack = this.vlocity.utilityservice.getDataPackData(currentContextData[i]);
        var vlocityDataPackKey = currentContextData[i].VlocityDataPackKey;
        allFinds.push(this.findAllRecords(dataPack, vlocityDataPackKey));
    }

    await Promise.all(allFinds);

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

    var queryResult = await this.vlocity.queryservice.query(inputMap.query);

    if (queryResult && queryResult.records.length > 0) {
        var sObjectType =  inputMap.sObjectType;
        var queriedRecordsMap = inputMap.queriedRecordsMap;

        if (!queriedRecordsMap[sObjectType]) {
            queriedRecordsMap[sObjectType] = {};
        }
                
        for (var i = 0; i < queryResult.records.length; i++) {
            
            var sObject = queryResult.records[i];
            var whereClauseHash = await this.buildUniqueKey(sObjectType, null, sObject);
            var recordSourceKey;

            if (this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[sObjectType]
                && this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[sObjectType][whereClauseHash]) {
                
                recordSourceKey = this.deltaCheckJobInfo.whereClauseHashToVlocityRecordSourceKey[sObjectType][whereClauseHash];
                    
                this.deltaCheckJobInfo.recordSourceKeyToId[recordSourceKey] = sObject.Id;
                this.deltaCheckJobInfo.recordSourceKeyToId[sObject.Id] = recordSourceKey;
            }

            var childQueries = this.deltaCheckJobInfo.childObjectsForQueries[sObjectType];

            if (childQueries) {

                for (var queryInfo of childQueries) {

                    var whereHashInfo = {};
                    var parentKey;

                    for (var fieldName in queryInfo) {
                    
                        var configVal = queryInfo[fieldName];

                        if (fieldName == 'vlocityRecordSourceKey') {
                            parentKey = configVal;
                        } else if (fieldName == 'OrderBy') {
                            whereHashInfo[fieldName] = configVal;
                        } else if (configVal === 'null') {
                            whereHashInfo[fieldName] = null;
                        } else {
                            whereHashInfo[fieldName] = sObject[fieldName];
                        }
                    }
                    
                    var childWhereHash = this.buildWhereClauseHash(Object.keys(whereHashInfo), whereHashInfo, this.sObjectInfo[sObjectType].fieldsDefinitionsMap);

                    var parentWhereHash = this.buildWhereClauseHash(Object.keys(whereHashInfo), queryInfo, this.sObjectInfo[sObjectType].fieldsDefinitionsMap);

                    if (childWhereHash == parentWhereHash) {

                        if (!this.deltaCheckJobInfo.childHashToParentVlocityRecordSourceKey[sObjectType]) {
                            this.deltaCheckJobInfo.childHashToParentVlocityRecordSourceKey[sObjectType] = {};
                        }

                        this.deltaCheckJobInfo.childHashToParentVlocityRecordSourceKey[sObjectType][whereClauseHash] = parentKey;
                    }
                }
            }

            if (this.jobInfo.checkStaleObjects || this.deltaCheckJobInfo.recordSourceKeyToDataPackKey[recordSourceKey]) {
                queriedRecordsMap[sObjectType][whereClauseHash] = sObject;
            }
        }

        if (this.vlocity.utilityservice.isEmptyObject(queriedRecordsMap[sObjectType])) {
            delete queriedRecordsMap[sObjectType];
        }
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
        query.queryBase = 'SELECT ' + query.querySelect + ' FROM ' + query.sObjectType;

        for (var whereClauseHash in queriesMap[sObjectType]) {
            if (whereClauseHash === 'querySelect') {
                continue;
            }

            var whereClauseTemp = whereClauseHash; 

            if (queriesMap[sObjectType][whereClauseHash].whereClause) {
                whereClauseTemp = queriesMap[sObjectType][whereClauseHash].whereClause;
            }

            if (whereClauseTemp.includes('ORDER BY')) {

                if (query.whereClause) {
                    queries.push(JSON.parse(JSON.stringify(query)));
                }
                
                query.whereClause = whereClauseTemp;
                queries.push(JSON.parse(JSON.stringify(query)));
                query.whereClause = '';
            } else {
                if (query.whereClause) {
                    query.whereClause += ' OR ';
                }

                query.whereClause += '(' + whereClauseTemp + ')';
                
                if (query.whereClause.length > 10000) {
                    queries.push(JSON.parse(JSON.stringify(query)));
                    query.whereClause = '';
                }
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
    
    var childQueries = this.vlocity.datapacksutils.getDeltaQueryChildren(sObjectType);

    if (childQueries) {
        this.deltaCheckJobInfo.deltaQueryChildrenDefinition[sObjectType] = childQueries;

        for (var childSObjectType in childQueries) {
            if (!this.deltaCheckJobInfo.queryForChildren[childSObjectType]) {
                this.deltaCheckJobInfo.queryForChildren[childSObjectType] = [];
            }

            var queryRecord = { vlocityRecordSourceKey: vlocityRecordSourceKey };
           
            for (var fieldName in childQueries[childSObjectType]) {
                var configVal = childQueries[childSObjectType][fieldName];
                var lookupFieldValue;

                if (fieldName == 'OrderBy' 
                || typeof configVal === 'boolean') {
                    lookupFieldValue = configVal;
                } else if (configVal === 'null') {
                    lookupFieldValue = null;
                } else if (configVal.indexOf('_') == 0) {
                    lookupFieldValue = configVal.substring(1);
                } else {
                    lookupFieldValue = sObject[configVal];
                }
                
                queryRecord[fieldName] = lookupFieldValue;
            }

            this.deltaCheckJobInfo.queryForChildren[childSObjectType].push(queryRecord);

            if (!this.deltaCheckJobInfo.childObjectsForQueries[childSObjectType]) {
                this.deltaCheckJobInfo.childObjectsForQueries[childSObjectType] = [];
            }

            this.deltaCheckJobInfo.childObjectsForQueries[childSObjectType].push(queryRecord);
        }
    }
};

DeltaCheck.prototype.getDeltaCheckMatchingKeyFields = function(sObjectType, sObject) {
    var deltaCheckMatchingKey = this.vlocity.datapacksutils.getDeltaCheckMatchingKey(sObjectType);

    if (deltaCheckMatchingKey) {
        var matchingKeyField = [];
        
        for (var matchField of deltaCheckMatchingKey) {
            if (typeof matchField  === 'string') {
                matchingKeyField.push(matchField);
            } else {
                var fieldKey = Object.keys(matchField)[0];
                matchingKeyField.push(fieldKey);

                sObject[fieldKey] = matchField[fieldKey];
            }
        }

        return matchingKeyField;
    }

    return null;
}

DeltaCheck.prototype.buildUniqueKey = async function(sObjectType, vlocityDataPackKey, sObject) {
    
    var vlocityRecordSourceKey = sObject.VlocityRecordSourceKey;

    await this.getSObjectMetadata(sObjectType);

    var matchingKeyFields = this.sObjectInfo[sObjectType].matchingKeyField;

    if (!matchingKeyFields) {
        matchingKeyFields = this.getDeltaCheckMatchingKeyFields(sObjectType, sObject);
    }
    
    if (matchingKeyFields) { 

        if (matchingKeyFields.includes(',')) {
            matchingKeyFields = matchingKeyFields.split(',');
        }
        
        var lookupSObjectFound = false;
        var sObjectRecord = {};
        
        for (var matchingKeyField of matchingKeyFields) {
            if (this.sObjectInfo[sObjectType].fieldsDefinitionsMap && this.sObjectInfo[sObjectType].fieldsDefinitionsMap[matchingKeyField]) {
                var referenceSObject = sObject[matchingKeyField];  

                if (referenceSObject instanceof Object) {
                    lookupSObjectFound = true;
                    var matchingKeyFieldValue = '';

                    if (referenceSObject.VlocityLookupRecordSourceKey) {
                        matchingKeyFieldValue = referenceSObject.VlocityLookupRecordSourceKey;
                    } else if (referenceSObject.VlocityMatchingRecordSourceKey) {
                        matchingKeyFieldValue = referenceSObject.VlocityMatchingRecordSourceKey;
                    }
                    
                    if (!sObjectRecord.lookupFields) {
                        sObjectRecord.lookupFields = [];
                    }                    
                   
                    sObjectRecord[matchingKeyField] = matchingKeyFieldValue;
                    sObjectRecord.lookupFields.push(matchingKeyField)

                } else {
                    sObjectRecord[matchingKeyField] = referenceSObject;
                }
            }
        }

        if (lookupSObjectFound
            && vlocityDataPackKey 
            && !this.vlocity.utilityservice.isEmptyObject(sObjectRecord)) {
                if (sObjectType !== 'RecordType') {
                    sObjectRecord.vlocityDataPackKey = vlocityDataPackKey;
                    sObjectRecord.vlocityRecordSourceKey = vlocityRecordSourceKey;

                    if (!this.deltaCheckJobInfo.sObjectsToQueryFor[sObjectType]) {
                        this.deltaCheckJobInfo.sObjectsToQueryFor[sObjectType] = [];
                    }
                        
                    this.deltaCheckJobInfo.sObjectsToQueryFor[sObjectType].push(sObjectRecord); 
                    this.deltaCheckJobInfo.recordSourceKeyToDataPackKey[vlocityRecordSourceKey] = vlocityDataPackKey;
                    
                    if (!this.deltaCheckJobInfo.recordSourceKeyToDataPack[sObjectType]) {
                        this.deltaCheckJobInfo.recordSourceKeyToDataPack[sObjectType] = {};
                    }

                    this.deltaCheckJobInfo.recordSourceKeyToDataPack[sObjectType][vlocityRecordSourceKey] = sObject;
                }

                return null;
        }
    
        return this.buildWhereClauseHash(matchingKeyFields, sObject, this.sObjectInfo[sObjectType].fieldsDefinitionsMap);
    }

    return null;
};

DeltaCheck.prototype.buildWhereClauseHash = function(matchingKeyFields, sObject, fieldsDefinitionsMap) {
    var fieldsValuesMap = {};
    
    if (matchingKeyFields) {
        for (var i = 0; i < matchingKeyFields.length; i++) {
            var matchingField = matchingKeyFields[i];
            var matchingFieldValue = sObject[matchingField];

            if (!matchingFieldValue && typeof(matchingFieldValue) !== 'boolean') {
                matchingFieldValue = null;
            }

            fieldsValuesMap[matchingField] = matchingFieldValue;
        }
    }

    return this.vlocity.queryservice.buildWhereClause(fieldsValuesMap, fieldsDefinitionsMap, 'AND');
};
