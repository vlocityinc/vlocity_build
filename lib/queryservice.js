var fs = require("fs-extra");
const VLOCITY_NAMESPACE = '%vlocity_namespace%';

var QueryService = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};
};

QueryService.prototype.query = async function(query) {
    query = this.vlocity.utilityservice.checkNamespacePrefix(query);

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

QueryService.prototype.buildSOQL = function(fields, from, where) {
    from = this.vlocity.utilityservice.checkNamespacePrefix(from);
    fields = this.vlocity.utilityservice.checkNamespacePrefix(fields);
    
    var queryString = 'SELECT ' + fields + ' FROM ' + from;

    if (where) {
        where = this.vlocity.utilityservice.checkNamespacePrefix(where);
        queryString += ' WHERE ' + where;
    }

    return queryString; 
};

/**
 * @param fieldsValuesMap A map which contains a key-value pair where key is a field name. 
 *                        A single field can have an array of values.
 * 
 * @param fieldsDefinition A map which contains fields definitions for SObject where key is a name of the field.
 */
QueryService.prototype.buildWhereClause = function(fieldsValuesMap, fieldsDefinition) {
    var whereClause = '';

    for (var fieldName in fieldsValuesMap) {
        if (fieldsDefinition[fieldName]) {
            var type = fieldsDefinition[fieldName].type;
            var value = fieldsValuesMap[fieldName];

            if (type && value) {
                if (whereClause) {
                    whereClause += ' AND ';
                }

                if (fieldsValuesMap[fieldName] instanceof Array) {
                    for (var i = 0; i < fieldsValuesMap[fieldName].length; i++) {
                        if (whereClause && i < fieldsValuesMap[fieldName].length-1) {
                            whereClause += ' AND ';
                        }

                        whereClause += this.buildWhereClauseValueByType(fieldName, fieldsValuesMap[fieldName][i], type);
                    }
                } else {
                    whereClause += this.buildWhereClauseValueByType(fieldName, fieldsValuesMap[fieldName][i], type);
                }
            }
        }
    }
    
    return whereClause;
};

QueryService.prototype.buildWhereClauseValueByType = function(fieldName, value, fieldType) {
    var whereClause = '';

    if (value == null) {
        fieldType = '';
    }
    
    switch(fieldType) {
        case 'string': 
            whereClause += fieldName + " = '" + value + "'";
            break;
        case 'double': 
            var tempVal = value;
            
            if (typeof(tempVal) === 'string') {
                tempVal = Number(tempVal);
            }

            whereClause += fieldName + " = " + tempVal;
            break;
        case 'reference':
            whereClause += fieldName + " = '" + value + "'";
            break;
        default:
            whereClause += fieldName + " = " + value;
            break;
    }

    return whereClause;
};