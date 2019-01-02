var fs = require("fs-extra");
const VLOCITY_NAMESPACE = '%vlocity_namespace%';

var QueryService = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};
};

QueryService.prototype.query = async function(query) {
    query = this.vlocity.utilityservice.setNamespaceToOrg(query);

    VlocityUtils.verbose('Running Query', query);

    try {
        var result =  await this.vlocity.jsForceConnection.query(query);
        VlocityUtils.verbose('Query Records Found', query, result.records.length);
        return this.vlocity.utilityservice.setNamespaceToDefault(result);
    } catch (err) {
        VlocityUtils.error('Query Error', query, err.message);
    }
};

QueryService.prototype.buildSOQL = function(fields, from, where) {
    var queryString = 'SELECT ' + fields + ' FROM ' + from;

    if (where) {
        queryString += ' WHERE ' + where;
    }

    return this.vlocity.utilityservice.setNamespaceToOrg(queryString); 
};

/**
 * @param fieldsValuesMap A map which contains a key-value pair where key is a field name. 
 *                        A single field can have an array of values.
 * 
 * @param fieldsDefinition A map which contains fields definitions for SObject where key is a name of the field.
 */
QueryService.prototype.buildWhereClause = function(fieldsValuesMap, fieldsDefinition, seperator) {
    var whereClause = '';
    var orderBy = '';

    for (var fieldName in fieldsValuesMap) {

        if (fieldName == 'OrderBy') {
            orderBy = ' ' + fieldsValuesMap[fieldName];
        } else if (fieldsDefinition[fieldName]) {
            var type = fieldsDefinition[fieldName].type;
            var value = fieldsValuesMap[fieldName];

            if (type && value) {
                if (whereClause) {
                    whereClause += ` ${seperator} `;
                }

                whereClause += this.buildWhereClauseValueByType(fieldName, fieldsValuesMap[fieldName], type);
            }
        }
    }
    
    return whereClause + orderBy;
};

QueryService.prototype.buildWhereClauseValueByType = function(fieldName, value, fieldType) {
    
    if (value == null) {
        return fieldName + " = null";;
    }
    
    switch(fieldType) {
        case 'boolean':
            return fieldName + " = " + value;
        case 'double': 
            var tempVal = value;
            
            if (typeof(tempVal) === 'string') {
                tempVal = Number(tempVal);
            }

            return fieldName + " = " + tempVal;
        default:
            return fieldName + " = '" + value + "'";
    }
};