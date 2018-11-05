var fs = require("fs-extra");
const VLOCITY_NAMESPACE = '%vlocity_namespace%';

var UtilityService = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};
};

UtilityService.prototype.replaceInStringOrArray = function(value, valueToReplace, replaceWith) {
    var tempVal = value;
    var arrayOrObject = false;

    if (tempVal && tempVal instanceof Object) {
        tempVal = JSON.stringify(tempVal);
        arrayOrObject = true;
    }

    tempVal = this.replaceAll(tempVal, valueToReplace, replaceWith);
    return arrayOrObject ? JSON.parse(tempVal) : tempVal;
};

UtilityService.prototype.replaceAll = function(str, find, replace) {
    return str.replace(new RegExp(find, 'g'), replace);
};

UtilityService.prototype.checkNamespacePrefix = function(value) {
    return this.vlocity.utilityservice.replaceInStringOrArray(value, VLOCITY_NAMESPACE, this.vlocity.namespace);
};

UtilityService.prototype.replaceNamespaceWithDefault = function(value) {
    return this.vlocity.utilityservice.replaceInStringOrArray(value, this.vlocity.namespace, VLOCITY_NAMESPACE);
};

UtilityService.prototype.buildHashMap = function(fields, records) {
    records = this.checkNamespacePrefix(records);
    var fieldsValuesMap = {};

    for (var i = 0; i < records.length; i++) {
        for (var key in fields) {
            if (records[i].hasOwnProperty(key)) {
                var uniqueKey = key + records[i][key];
                uniqueKey = uniqueKey.toLowerCase();
                
                if (!fieldsValuesMap[uniqueKey]) {
                    fieldsValuesMap[uniqueKey] = [];
                    fieldsValuesMap[uniqueKey].field = key;
                    fieldsValuesMap[uniqueKey].value = records[i][key];
                }
                
                fieldsValuesMap[uniqueKey].push(records[i]);
            }
        }
    }

    return fieldsValuesMap;
};

UtilityService.prototype.getDataPackData = function(dataPack) {
    if (dataPack) {
        for (var key in dataPack.VlocityDataPackData) {
            if (dataPack.VlocityDataPackData[key] 
                && dataPack.VlocityDataPackData[key] instanceof Array) {
                    return dataPack.VlocityDataPackData[key][0];
                }
        }
    }

    return {};
};

UtilityService.prototype.isEmptyObject = function(obj) {
    for (var name in obj) {
        return false;
    }
    return true;
};

UtilityService.prototype.mergeMaps = function(firstMap, secondMap) {
    for (var key in secondMap) {
        firstMap[key] = secondMap[key];
    }

    return firstMap;
};

UtilityService.prototype.getAllDRMatchingKeys = async function() {
    var self = this;
    var matchingKeysMap = {};
    var objectAPIName = self.checkNamespacePrefix('%vlocity_namespace%__ObjectAPIName__c');
    var matchingKeyField = self.checkNamespacePrefix('%vlocity_namespace%__MatchingKeyFields__c');
    var queryResult = await self.vlocity.queryservice.query('SELECT Id,NamespacePrefix,%vlocity_namespace%__ObjectAPIName__c,%vlocity_namespace%__MatchingKeyFields__c FROM %vlocity_namespace%__DRMatchingKey__mdt');

    if (queryResult && queryResult.records) {
        for (var i = 0; i < queryResult.records.length; i++) {
            if (matchingKeysMap[queryResult.records[i][objectAPIName]]) {
                if (queryResult.records[i]['NamespacePrefix'] !== null) {
                    continue;
                }
            }

            matchingKeysMap[queryResult.records[i][objectAPIName]] = queryResult.records[i][matchingKeyField];
        }
    }

    return matchingKeysMap;
};



UtilityService.prototype.runInputMap = async function(inputList, status, allLimitPromiseThreads) {
    try {
        while (inputList.length > 0 && !status.cancel) {
            var inputMap = inputList.shift();
            await inputMap.context[inputMap.func](inputMap.argument);

            if (allLimitPromiseThreads == null) {
                debugger;
            }
        }
    } catch (e) {
        status.cancel = true;
        status.errors.push(e);
    }
}

UtilityService.prototype.parallelLimit = async function(inputList, limit = 50) {

    var allLimitPromiseThreads = [];
    var status = { cancel: false, errors: [] };

    for (var i = 0; i < limit; i++) {
        allLimitPromiseThreads.push(this.runInputMap(inputList, status, allLimitPromiseThreads));
    }

   
    do {
        try {
            await Promise.all(allLimitPromiseThreads);
        } catch (e) {
            status.errors.push(e);
        }
    } while (inputList.length > 0 && !status.cancel) 

    if (status.errors.length > 0) {
        throw status.errors;
    }
};

UtilityService.prototype.forceFinish = async function(inFlight, errors) {
    try {
        await Promise.all(inFlight);
    } catch (e) {
        errors.push(e);
        await this.forceFinish(inFlight, errors);
    }
}

UtilityService.prototype.createSObject = async function(sObjectType, sObject) {
    var self = this;
    return await new Promise(function(resolve, reject) {
        self.vlocity.jsForceConnection.sobject(sObjectType).create(sObject, function(err, result) {
            if (err || !result.success) {
                VlocityUtils.error('Create Opetation Failed', sObject, err.message);
                reject(err.message);
            }

            resolve(result);
        });
    });
};
