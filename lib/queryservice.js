var fs = require("fs-extra");
const VLOCITY_NAMESPACE = '%vlocity_namespace%';

var QueryService = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};
};

QueryService.prototype.query = async function(query) {

    query = this.vlocity.utilityservice.setNamespaceToOrg(query);

    VlocityUtils.verbose('Running Query', query);

    try {
        var result = { records: [] };
        await this.queryWrapper(query, result);
        return this.vlocity.utilityservice.setNamespaceToDefault(result);
    } catch (err) {
        VlocityUtils.error('Query Error', query, err.message);

        return null;
    } 
};

QueryService.prototype.queryWrapper = async function(query, result) {
    return new Promise(resolve => {
     this.vlocity.jsForceConnection.query(query)
        .on("record", (record) => {
            result.records.push(record);
        })
        .on("end", () => {
            VlocityUtils.verbose('Query Records Found', query, result.records.length);
            resolve();
        })
        .on("error", (err) => {
            VlocityUtils.error('Query Error', query, err.message);
            resolve();
        })
        .run({ autoFetch : true, maxFetch : 1000000 });
    });
}

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

QueryService.prototype.queryAllFields = async function(sObjectType, whereClause, additionalFields) {
    let sObjectDescribe = await this.vlocity.utilityservice.describeSObject(sObjectType);
    let queryBuild = 'SELECT ';

    for (var field of sObjectDescribe.fields) {
        queryBuild += field.name + ',';
    }

    if (additionalFields) {
        for (var field of additionalFields) {
            queryBuild += field + ',';
        }
    }

    queryBuild = queryBuild.substring(0,queryBuild.length-1);

    queryBuild += ` FROM ${sObjectType} WHERE ${whereClause}`;

   return await this.query(queryBuild);
}

