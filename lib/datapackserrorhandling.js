var fs = require("fs-extra");
var path = require('path');
var yaml = require('js-yaml');

var DataPacksErrorHandling = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};
    this.errorHandlingDefinition = yaml.safeLoad(fs.readFileSync(path.join(__dirname, "datapackserrorhandling.yaml"), 'utf8'));
};

DataPacksErrorHandling.prototype.getSanitizedErrorMessage = async function(jobInfo, dataPack) {
    var self = this;

    try {
        if (dataPack
            && jobInfo
            && jobInfo.errorHandling) {
            
            self.getRelationshipKeyToChildKeys(jobInfo, dataPack.dataPacks);

            for (var key in jobInfo.errorHandling) {
                if (!jobInfo.errorHandling[key].processed) {
                    var errHandlingObj = jobInfo.errorHandling[key];
                    var errorMessage = errHandlingObj.dataPack.VlocityDataPackMessage;

                    var matchingErrorKey = self.getMatchingError(errorMessage, errHandlingObj.dataPack);
                    var newErrorMessage;
        
                    if (matchingErrorKey) {
                        newErrorMessage = await self['handle' + matchingErrorKey](errHandlingObj.dataPack, jobInfo);
                    }
        
                    if (!newErrorMessage) {
                        if (errorMessage) {
                            newErrorMessage = `${dataPack.VlocityDataPackKey} - ${errorMessage}`; 
                        } else {
                            newErrorMessage = `${dataPack.VlocityDataPackKey} - Unknown Error`; 
                        }  
                    } else {
                        newErrorMessage = this.vlocity.utilityservice.setNamespaceToOrg(newErrorMessage);

                        VlocityUtils.verbose('Changing', errorMessage, '>>', newErrorMessage);

                        self.updateOriginalErrorMessage(jobInfo, errHandlingObj.dataPack.VlocityDataPackKey, newErrorMessage);
                    }
        
                    jobInfo.errorHandling[key].processed = true;
                    VlocityUtils.error('Error', newErrorMessage);
                }
            }
        }
    } catch (e) {
        VlocityUtils.error('Error Getting Sanitized Message', e);
    }
};

DataPacksErrorHandling.prototype.getMatchingError = function(errorMessage, dataPackWithError) {

    if (!errorMessage) {
        return;
    }
    
    for (var key in this.errorHandlingDefinition) {
        var obj = this.errorHandlingDefinition[key];
        var dataPackTypeMatch = false;

        if (obj.DataPackTypes) {
            for (var y = 0; y < obj.DataPackTypes.length; y++) {
                if (dataPackWithError.VlocityDataPackType.includes(obj.DataPackTypes[y])) {
                    dataPackTypeMatch = true;
                }
            }
        } else {
            dataPackTypeMatch = true;
        }

        if (dataPackTypeMatch && obj.SearchStrings) {
            for (var i = 0; i < obj.SearchStrings.length; i++) {
                if (errorMessage.includes(obj.SearchStrings[i])) {
                    return key;
                }
            }
        }
    }
};

// ---------- EXPORT ERRORS ----------
DataPacksErrorHandling.prototype.handleWereNotProcessed = function(dataPackWithError) {
    if (dataPackWithError) {
        return this.formatErrorMessageWereNotProcessed(dataPackWithError);
    }
};

/*
 * Example Error Format:
 * 1) OmniScript/Type_subtypeme_English references DataRaptor/test which was not found.
 * 2) OmniScript/Type_subtypeme_English and OmniScript/second_os_English references VlocityUITemplate/blah which was not found.
 */
DataPacksErrorHandling.prototype.handleNotFound = function(dataPackWithError, jobInfo) {
    if (dataPackWithError && jobInfo) {
        var relKeyToChildKeys = jobInfo.relationshipKeyToChildKeys[dataPackWithError.VlocityDataPackKey];
        var parentKeys = '';

        for (var i = 0; i < relKeyToChildKeys.length; i++) {
            var parentDataPackKey = jobInfo.vlocityKeysToNewNamesMap[relKeyToChildKeys[i]];

            if (parentDataPackKey) {
                if (parentKeys) {
                    parentKeys = parentKeys + ' and ' + parentDataPackKey;
                } else {
                    parentKeys += parentDataPackKey;
                }
            } else if (!parentKeys) {
                parentKeys = dataPackWithError.VlocityDataPackKey;
            }
        }

        var dataPackWithErrorKey = jobInfo.vlocityKeysToNewNamesMap[dataPackWithError.VlocityDataPackKey];
        
        if (!dataPackWithErrorKey) {
            dataPackWithErrorKey = dataPackWithError.VlocityDataPackType + '/' + dataPackWithError.VlocityDataPackName;
        }

        return parentKeys + ' references ' + dataPackWithErrorKey + ' which was not found.';
    }
};

// ---------- DEPLOY ERRORS ----------
DataPacksErrorHandling.prototype.handleIncorrectImportData = function(dataPackWithError) {
    return this.formatErrorMessageIncorrectImportData(dataPackWithError);
};

DataPacksErrorHandling.prototype.handleSObjectUniqueness = async function(dataPackWithError, jobInfo) {
    var sObject = await this.getSObject(dataPackWithError, jobInfo);
    var uniqueFieldsValuesMap = await this.getDataPackFieldsValues(dataPackWithError, sObject.uniqueFields);
    var dataPack = this.vlocity.utilityservice.getDataPackData(dataPackWithError);
    var passedDataMap = this.vlocity.utilityservice.buildHashMap(sObject.uniqueFields, [dataPack]);
    
    var whereClause = this.vlocity.queryservice.buildWhereClause(uniqueFieldsValuesMap, sObject.uniqueFields, 'OR');
    var fields = Object.keys(sObject.uniqueFields).join();
    var queryString = this.vlocity.queryservice.buildSOQL('Id,Name,' + fields, sObject.name, whereClause);
    var queryResult = await this.vlocity.queryservice.query(queryString);

    if (queryResult.records.length == 0) {
        return null;
    }

    var resultMap = this.vlocity.utilityservice.buildHashMap(sObject.uniqueFields, queryResult.records);

    var result = this.compareFieldsValues(passedDataMap, resultMap);
    var options = {'fieldsMap' : result};

    return this.formatErrorMessageSObjectUniqueness(dataPackWithError, jobInfo, options);
};

DataPacksErrorHandling.prototype.handleMissingReference = function(dataPackWithError, jobInfo) {
    var searchPathMap = this.parseMissingReferenceErrorMessage(dataPackWithError.VlocityDataPackMessage);
    var missingReferenceHashKey = JSON.stringify(dataPackWithError.VlocityDataPackMessage);
    var dataPack = this.vlocity.utilityservice.getDataPackData(dataPackWithError);
    var vlocityLookupRecordSourceKey;
    var errorMessage;

    if (!jobInfo.handleMissingReferenceMap) {
        jobInfo.handleMissingReferenceMap = {};
    }

    if (jobInfo.handleMissingReferenceMap.hasOwnProperty(missingReferenceHashKey)) {
        vlocityLookupRecordSourceKey = jobInfo.handleMissingReferenceMap[missingReferenceHashKey];
    } else {
        vlocityLookupRecordSourceKey = this.findMatchingLookupRecordSourceKey(dataPack, searchPathMap);
        jobInfo.handleMissingReferenceMap[missingReferenceHashKey] = vlocityLookupRecordSourceKey;
    }
    
    if (vlocityLookupRecordSourceKey) {
        var options = {};
        options.vlocityLookupRecordSourceKey = vlocityLookupRecordSourceKey;
        errorMessage = this.formatErrorMessageMissingReference(dataPackWithError, options);
    }

    return errorMessage;
};

DataPacksErrorHandling.prototype.parseMissingReferenceErrorMessage = function(errorMessage) {
    var errMessageArray = errorMessage.split(' ');
    var searchPathMap = {searchPath:[], compareValues:[]};
    var pathFound = false;

    for (var i = 0; i < errMessageArray.length; i++) {
        if (errMessageArray[i]) {
            var tempVal = errMessageArray[i];

            if (!pathFound && tempVal.includes('.')) {
                tempVal = tempVal.split('.');
                
                for (var z = 0; z < tempVal.length; z++) {
                    searchPathMap.searchPath.push(tempVal[z]);
                }

                pathFound = true;
            } else if (tempVal.includes('=')) {
                tempVal = tempVal.split('=');
                var tempMap = {};
                tempMap[tempVal[0]] = tempVal[1];

                searchPathMap.compareValues.push(tempMap);
            }
        }
    }

    return searchPathMap;
};

// ------------ FORMAT ERROR MESSAGE ------------
DataPacksErrorHandling.prototype.formatErrorMessageStart = function(dataPackWithError) {
    var errorMessage;

    if (dataPackWithError) {
        errorMessage = `${dataPackWithError.VlocityDataPackKey} -- DataPack >> ${dataPackWithError.VlocityDataPackName} -- Error Message -- `;
    }

    return errorMessage;
};

/*
 * Original Error Format:
 * No match found for %vlocity_namespace%__ProductChildItem__c.%vlocity_namespace%__ChildProductId__c 
 * - %vlocity_namespace%__GlobalKey__c=2bf166dd-0a5b-4634-4bcb-ff73b5747935
 * 
 * New Error Format: 
 * "Product2/bde15892-31df-ef61-53e7-de1b20505e6a -- DataPack >> parent with child product reference issue -- 
 *  Error Message -- This DataPack has a reference to another object which was not found 
 * -- Product2/2bf166dd-0a5b-4634-4bcb-ff73b5747935"
 */
DataPacksErrorHandling.prototype.formatErrorMessageMissingReference = function(dataPackWithError, options) {
    var errorMessage = this.formatErrorMessageStart(dataPackWithError);
    errorMessage += 'This DataPack has a reference to another object which was not found -- ' + options.vlocityLookupRecordSourceKey;   
    return errorMessage;
};

/*
 * Original Error Format:
 * Incorrect Import Data. Multiple Imported Records will incorrecty create the same Saleforce Record. %vlocity_namespace%__CatalogRelationship__c: Deals2
 * 
 * New Error Format:
 * Catalog/Root -- DataPack >> Root -- Error Message -- Incorrect Import Data. 
 * Multiple Imported Records will incorrecty create the same Saleforce Record. 
 * dev_core__CatalogRelationship__c: Deals2
 */
DataPacksErrorHandling.prototype.formatErrorMessageIncorrectImportData = function(dataPackWithError) {
    var errorMessage = this.formatErrorMessageStart(dataPackWithError);
    errorMessage += dataPackWithError.VlocityDataPackMessage;
    return errorMessage;
};

/*
 * Original Error Format:
 * "DataPack contains data that was not deployed due to setting mismatch between source and target orgs. 
 * Please run packUpdateSettings in both orgs to ensure the settings are the same."
 * 
 * New Error Format:
 * Product2/bde15892-31df-ef61-53e7-de1b20505e6a -- DataPack >> parent with child product reference issue -- Error Message 
 * -- DataPack contains data that was not deployed due to setting mismatch between source and target orgs. 
 * Please run packUpdateSettings in both orgs to ensure the settings are the same.
 */
DataPacksErrorHandling.prototype.formatErrorMessageWereNotProcessed = function(dataPackWithError) {
    var errorMessage = this.formatErrorMessageStart(dataPackWithError);
    errorMessage += 'DataPack contains data that was not deployed due to setting mismatch between source and target orgs. Please run packUpdateSettings in both orgs to ensure the settings are the same.';   
    return errorMessage;
};

/*
 * Original Error Format:
 * duplicate value found: <unknown> duplicates value on record with id: <unknown> 
 * 
 * New Error Format:
 * "AttributeCategory/549f657a-7831-2860-b602-2d569f3d4054 -- DataPack >> test -- Error Message --  duplicate field value found: 2 on the field: dev_core__DisplaySequence__c on record with id: a086A000003vcxUQAQ -- Change the dev_core__DisplaySequence__c field value of the dev_core__AttributeCategory__c on record with id: a086A000003vcxUQAQ in the target org to resolve the issue."
 */
DataPacksErrorHandling.prototype.formatErrorMessageSObjectUniqueness = function(dataPackWithError, jobInfo, options) {
    var errorMessage = this.formatErrorMessageStart(dataPackWithError);
    var actionMessage = '';
    var sObjectType = jobInfo.allDataSummary[dataPackWithError.VlocityDataPackKey].VlocityRecordSObjectType;

    if (options && options.fieldsMap) {
        if (options.fieldsMap.matchingFields) {
            for (var key in options.fieldsMap.matchingFields) {
                if (actionMessage) {
                   errorMessage += ' AND';
                   actionMessage += ' AND';
                }
                
                var field = options.fieldsMap.matchingFields[key].field;
                var value = options.fieldsMap.matchingFields[key].value;
                var dataPacks = options.fieldsMap.matchingFields[key].dataPacks;
                var sObjectIds = [];

                for (var i = 0; i < dataPacks.length; i++) {
                    sObjectIds.push(dataPacks[i].Id);
                }

                errorMessage += ' duplicate field value found: ' + value;
                errorMessage += ' on the field: ' + field;
                errorMessage += ' on record with id: ' + sObjectIds.join();
                
                actionMessage += ' -- Change the ' + field + ' field value of the ' + sObjectType;
                actionMessage += ' on record with id: ' + sObjectIds.join();
            }
        }

        if (options.fieldsMap.notMatchingFields) {
            for (var key in options.fieldsMap.notMatchingFields) {
                if (actionMessage) {
                    errorMessage += ' AND';
                    actionMessage += ' AND';
                 }
                
                var field = options.fieldsMap.notMatchingFields[key].field;
                var value = options.fieldsMap.notMatchingFields[key].value;
                var originalValue = options.fieldsMap.notMatchingFields[key].originalValue;
                var dataPacks = options.fieldsMap.notMatchingFields[key].dataPacks;
                var sObjectIds = [];

                for (var i = 0; i < dataPacks.length; i++) {
                    sObjectIds.push(dataPacks[i].Id);
                }

                errorMessage += ' not matching field value found: ' + originalValue;
                errorMessage += ' on DataPack field: ' + field;
                errorMessage += ' which does not match a target org field value: ' + value;
                errorMessage += ' on the field: ' + field;
                errorMessage += ' on record with id: ' + sObjectIds.join();

                actionMessage += ' -- Change the ' + field + ' field value of the ' + sObjectType;
                actionMessage += ' on record with id: ' + sObjectIds.join();
            }
        }

        errorMessage += actionMessage +  ' in the target org to resolve the issue.';
    }

    return errorMessage;
};

// ---------- GENERIC METHODS ----------
DataPacksErrorHandling.prototype.getSObject = async function(dataPackWithError, jobInfo) {
    var uniqueFields = {};
    
    var sObjectApiName = jobInfo.allDataSummary[dataPackWithError.VlocityDataPackKey].VlocityRecordSObjectType;
    var sObject = await this.vlocity.utilityservice.describeSObject(sObjectApiName);

    if (sObject && sObject.fields) {
        for (var i = 0; i < sObject.fields.length; i++) {
            if (sObject.fields[i].unique === true) {
                uniqueFields[sObject.fields[i].name] = sObject.fields[i]; 
            }
        }
    }

    sObject.uniqueFields = uniqueFields;
    return sObject;
};

DataPacksErrorHandling.prototype.getDataPackFieldsValues = async function(dataPackWithError, fields) {
    var fieldValuesMap = {};
    var dataPack = this.vlocity.utilityservice.getDataPackData(dataPackWithError);
    var tempFields = this.vlocity.utilityservice.setNamespaceToDefault(fields);
    
    for (var key in tempFields) {
        if (dataPack.hasOwnProperty(key)) {
            fieldValuesMap[key] = dataPack[key];
        }
    }

    return fieldValuesMap;
};

DataPacksErrorHandling.prototype.getRelationshipKeyToChildKeys = function(jobInfo, dataPacks) {
    if (jobInfo && dataPacks) {
        for (var i = 0; i < dataPacks.length; i++) {
            if (dataPacks[i].VlocityDataPackAllRelationships) {
                for (var key in dataPacks[i].VlocityDataPackAllRelationships) {

                    if (!jobInfo.relationshipKeyToChildKeys[key]) {
                        jobInfo.relationshipKeyToChildKeys[key] = [];
                    }

                    if (!jobInfo.relationshipKeyToChildKeys[key].includes(dataPacks[i].VlocityDataPackKey)) {
                        jobInfo.relationshipKeyToChildKeys[key].push(dataPacks[i].VlocityDataPackKey)
                    }   
                }
            };
        }
    }
};

DataPacksErrorHandling.prototype.updateOriginalErrorMessage = function(jobInfo, dataPackKey, newErrorMessage) {
    var originalError = jobInfo.currentErrors[dataPackKey];
                
    if (jobInfo.errors.includes(originalError)) {
        var errorIndex = jobInfo.errors.indexOf(originalError);
        jobInfo.errors[errorIndex] = newErrorMessage;
    };
};

DataPacksErrorHandling.prototype.findMatchingLookupRecordSourceKey = function(dataPack, searchPathMap) {
    for (var i = 0; i < searchPathMap.searchPath.length; i++) {
        if (dataPack.hasOwnProperty(searchPathMap.searchPath[i])) {
            var nodeVal = dataPack[searchPathMap.searchPath[i]]; 
            if (searchPathMap.compareValues) {
                var match = 0;
                for (var z = 0; z < searchPathMap.compareValues.length; z++) {
                    for (var key in searchPathMap.compareValues[z]) {
                        if (nodeVal.hasOwnProperty(key)) {
                            if (nodeVal[key] === searchPathMap.compareValues[z][key]) {
                                match++;
                                //return nodeVal.VlocityLookupRecordSourceKey;
                            }
                        }
                    }

                }
                if(match == searchPathMap.compareValues.length){
                    return nodeVal.VlocityLookupRecordSourceKey;
                }
            }

            if (nodeVal && nodeVal instanceof Array) {
               for (var y = 0; y < nodeVal.length; y++) { 
                    var result = this.findMatchingLookupRecordSourceKey(nodeVal[y], searchPathMap);
                    
                    if (result) {
                        return result;
                    }
               }
            }

            if (nodeVal && nodeVal instanceof Object) {
                searchPathMap.searchPath.shift();
                return this.findMatchingLookupRecordSourceKey(nodeVal, searchPathMap);
            }
        }
    }
};

DataPacksErrorHandling.prototype.compareFieldsValues = function(compareMap, compareMapWith) {
    var fieldsMap = {};
    fieldsMap.matchingFields = {};
    fieldsMap.notMatchingFields = {};

    for (var key in compareMap) {
        var uniqueKey = key;

        if (compareMapWith.hasOwnProperty(key)) {
            var field = compareMapWith[key].field;
            var value = compareMapWith[key].value;

            if (compareMap[key].value === value) {
                fieldsMap.matchingFields[uniqueKey] = {
                    'field' : field, 
                    'value' : value, 
                    'dataPacks': compareMapWith[key]};
            } else {
                fieldsMap.notMatchingFields[uniqueKey] = {
                    'field' : field, 
                    'originalValue' : compareMap[key].value,
                    'value' : value, 
                    'dataPacks': compareMapWith[key]};
            }
        }
    }

    return fieldsMap;
};