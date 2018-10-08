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