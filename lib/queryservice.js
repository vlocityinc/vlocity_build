var fs = require("fs-extra");
const VLOCITY_NAMESPACE = '%vlocity_namespace%';

var QueryService = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};
};

QueryService.prototype.query = async function(query) {
    var self = this;
    return await new Promise(function(resolve, reject) {
        self.vlocity.jsForceConnection.query(query, function(err, result) {
            if (err) {
                VlocityUtils.error('Not found', query, err.message);
            }
            
            resolve(result);
        });
    });
};

QueryService.prototype.describeSObject = async function(sObjectName) {
    var self = this;
    return await new Promise(function(resolve, reject) {
        self.vlocity.jsForceConnection.sobject(sObjectName).describe(function(err, result) {
            if (err) {
                VlocityUtils.error('Not found', err.message);
            }

            resolve(result);
        });
    });
};

QueryService.prototype.getCustomMetadata = async function() {
    var self = this;
    var types = [{type: 'CustomMetadata', folder: null}];
    return await new Promise(function(resolve, reject) {
        self.vlocity.jsForceConnection.metadata.list(types, '42.0' ,function(err, meta) {
            if (err) {
                VlocityUtils.error('Not found', err.message);
            }

            resolve(meta);
        });
    });
};

QueryService.prototype.getDRMatchingKeys = async function() {
    var customMetadataComponents = await this.getCustomMetadata();
    
    var components = {};

    if (customMetadataComponents) {
        components['DRMatchingKey'] = [];

        for (var i = 0; i < customMetadataComponents.length; i++) {
            if (customMetadataComponents[i].fullName.includes('DRMatchingKey')) {
                components['DRMatchingKey'].push(customMetadataComponents[i]);
            }
        }
    }

    return components;
};

QueryService.prototype.getDRMatchingKey = async function(fullName) {
    var self = this; 
    var namespace = self.vlocity.namespacePrefix;

    if (fullName) {
        fullName = fullName.split('.');

        for (var i = 0; i < fullName.length; i++) {
            fullName[i] = namespace + fullName[i];
        }

        fullName = fullName.join('.');
    }

    var fullNames = [fullName];
    return await new Promise(function(resolve, reject) {
        self.vlocity.jsForceConnection.metadata.read('CustomMetadata', fullNames ,function(err, meta) {
            if (err) {
                VlocityUtils.error('Not found', err.message);
            }

            resolve(meta);
        });
    });
};

QueryService.prototype.buildSOQL = function(fields, from, where) {
    from = this.checkNamespacePrefix(from);
    fields = this.checkNamespacePrefix(fields);
    
    var queryString = 'SELECT ' + fields + ' FROM ' + from;

    if (where) {
        where = this.checkNamespacePrefix(where);
        queryString += ' WHERE ' + where;
    }

    return queryString; 
};

QueryService.prototype.replaceInStringOrArray = function(value, valueToReplace, replaceWith) {
    var tempVal = value;
    var arrayOrObject = false;

    if (tempVal && tempVal instanceof Object) {
        tempVal = JSON.stringify(tempVal);
        arrayOrObject = true;
    }

    tempVal = this.replaceAll(tempVal, valueToReplace, replaceWith);
    return arrayOrObject ? JSON.parse(tempVal) : tempVal;
};

QueryService.prototype.replaceNamespaceWithDefault = function(value) {
    return this.replaceInStringOrArray(value, this.vlocity.namespace, VLOCITY_NAMESPACE);
};

QueryService.prototype.checkNamespacePrefix = function(value) {
    return this.replaceInStringOrArray(value, VLOCITY_NAMESPACE, this.vlocity.namespace);
};

QueryService.prototype.replaceAll = function(str, find, replace) {
    return str.replace(new RegExp(find, 'g'), replace);
};

QueryService.prototype.buildWhereClause = function(fieldsValuesMap, fieldsDefinition) {
    var whereClause = '';

    for (var key in fieldsValuesMap) {
        var type;

        if (fieldsDefinition[key]) {
            type = fieldsDefinition[key].type;
        }

        if (whereClause) {
            whereClause += ' OR ';
        }

        switch(type) {
            case 'string': 
                whereClause += key + " = '" + fieldsValuesMap[key] + "'";
                break;
            case 'double': 
                var tempVal = fieldsValuesMap[key];
                if (typeof(tempVal) === 'string') {
                    tempVal = Number(tempVal);
                }
                whereClause += key + " = " + tempVal;
                break;
            default:
                whereClause += fieldsValuesMap[key];
                break;
        }
    }
    
    return whereClause;
};

QueryService.prototype.buildHashMap = function(fields, records) {
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

QueryService.prototype.getDataPackData = function(dataPack, dataPackType) {
    var dataPackTypeMatched = true;
    if (dataPackType && dataPack.VlocityDataPackType !== dataPackType) {
        dataPackTypeMatched = false;
    }
    
    if (dataPackTypeMatched) {
        for (var key in dataPack.VlocityDataPackData) {
            if (dataPack.VlocityDataPackData[key] 
                && dataPack.VlocityDataPackData[key] instanceof Array) {
                    return dataPack.VlocityDataPackData[key][0];
                }
        }
    }
};