var fs = require("fs-extra");
var path = require('path');
var yaml = require('js-yaml');

var OmniStudio = module.exports = function (vlocity) {
    this.vlocity = vlocity;
    this.platformObjectMappings = this.vlocity.datapacksutils.updateExpandedDefinitionNamespace(
        yaml.safeLoad(fs.readFileSync(
            path.join(__dirname, 'platformObjectMappings.yaml'),
            'utf8'
        ))
    );
    this.elementNewFieldNames = [];
    Object.keys(this.platformObjectMappings['OmniScript']['%vlocity_namespace%__Element__c'].fieldNames).forEach(key => {
        this.elementNewFieldNames.push(this.platformObjectMappings['OmniScript']['%vlocity_namespace%__Element__c'].fieldNames[key]);
    });
};

OmniStudio.prototype.updateQuery = function (query) {
    if (this.vlocity.isOmniStudioInstalled) {
        query = query.split(this.vlocity.namespacePrefix).join('%vlocity_namespace%__');
        Object.keys(this.platformObjectMappings).forEach(dataPackType => {
            Object.keys(this.platformObjectMappings[dataPackType]).forEach(key => {
                if (query.includes(key)) {
                    Object.keys(this.platformObjectMappings[dataPackType][key].fieldNames).forEach(field => {
                        query = query.replace(field, this.platformObjectMappings[dataPackType][key].fieldNames[field]);
                    });
                    query = query.replace(key, this.platformObjectMappings[dataPackType][key].objectName)
                        .split('%vlocity_namespace%__').join('')
                        .split('__c').join('');
                }
            });
        });
        query = query.replace(/%vlocity_namespace%__/g, this.vlocity.namespacePrefix);
    }
    return query;
}

OmniStudio.prototype.getNewObjectName = function (vlocityDataPackType, sObjectName) {
    if (this.vlocity.isOmniStudioInstalled) {
        return this.platformObjectMappings[vlocityDataPackType][sObjectName.replace(this.vlocity.namespacePrefix, '%vlocity_namespace%__')].objectName;
    } else {
        return sObjectName;
    }
}

OmniStudio.prototype.getNewFieldName = function (vlocityDataPackType, sObjectName, fieldName, isNewFieldsRequired) {
    if (this.vlocity.isOmniStudioInstalled || isNewFieldsRequired) {
        if (!fieldName.includes('%vlocity_namespace%__') && fieldName !== 'Name') {
            fieldName = '%vlocity_namespace%__' + fieldName;
        }
        return this.platformObjectMappings[vlocityDataPackType][sObjectName.replace(this.vlocity.namespacePrefix, '%vlocity_namespace%__')].fieldNames[fieldName];
    } else {
        return fieldName;
    }
}