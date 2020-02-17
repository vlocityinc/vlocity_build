var yaml = require("js-yaml");
var fs = require("fs-extra");
var path  = require("path");
var stringify = require('json-stable-stringify');
var unidecode = require('unidecode'); 
var datapackutils = require('./datapacksutils'); 

var DataPacksExpand = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};
};

DataPacksExpand.prototype.generateFolderPath = function(dataPackType, parentName) {
    //Replace spaces with dash (-) to have a valid file name for cards
    var validParentName = this.generateFolderOrFilename(parentName);
    return path.normalize(path.join(this.targetPath, dataPackType, validParentName, path.sep));
};

DataPacksExpand.generateFolderOrFilename = function(filename, extension) {
    if (!filename) return 'MissingName-' + datapackutils.guid();
    
    var sanitizedFilename = unidecode(filename)
        .replace(/%vlocity_namespace%__/g,"")
        .replace("\\","-") // Regex / also matches \ on windows ..
        .replace(/[^A-Za-z0-9/_\-]+/g, "-")
        .replace(/[-]+/g, "-")
        .replace(/[-_]+_/g, "_")
        .replace(/[-]+\/[-]+/g, "/")   
        .replace(/^[-_\\/]+/, "")
        .replace(/[-_\\/]+$/, "");
        
    if (extension && 
        extension != "base64"  && 
        !DataPacksExpand.endsWith(sanitizedFilename, "." + extension)) {
        sanitizedFilename += "." + extension;
    }
    return sanitizedFilename;
};

DataPacksExpand.endsWith = function(str, suffix) {
    return str.indexOf(suffix, str.length - suffix.length) !== -1;
}

DataPacksExpand.prototype.generateFolderOrFilename = function(filename, extension) {
    
    return DataPacksExpand.generateFolderOrFilename(filename, extension);
};

DataPacksExpand.prototype.sanitizeDataPackKey = function(key) {
    return this.generateFolderOrFilename(key);
};

//Generate the full file path
DataPacksExpand.prototype.generateFilepath = function(dataPackType, parentName, filename, extension) {
    var validFileName = this.generateFolderOrFilename(filename, extension);
    return this.generateFolderPath(dataPackType, parentName) + validFileName; 
};

DataPacksExpand.prototype.getNameWithFields = function(nameFields, dataPackData) {
    var self = this;
    var processedNames = (nameFields || []).map(function(key) {
        if(dataPackData && !dataPackData[key]){
            if(key.includes('%vlocity_namespace%__')){
                key = key.replace(/%vlocity_namespace%__/g,'');
            }
        }
        // If key references a field adds that otherwise is literal string
        if (key.indexOf('_') == 0) {
            return key.substring(1);
        } else if (key == '/' || key == '\\'){
            return '/';
        } else if (dataPackData[key] && typeof dataPackData[key] === "number") {
            return dataPackData[key].toString();
        } else if (dataPackData[key] && typeof dataPackData[key] === "string") {
            return dataPackData[key].replace(/[/\\]+/g,' '); // do not allow directory slashes in names
        } else if (dataPackData[key] != null && typeof dataPackData[key] === "object") {
            return self.getDataPackFolder(null, dataPackData[key].VlocityRecordSObjectType, dataPackData[key]);
        }
    });    

    if (processedNames.length == 0 || !processedNames[0]) {
        if (dataPackData.Name && typeof dataPackData.Name === "string")
            return dataPackData.Name;
    } else {
        var name = processedNames.join('_').replace(/_(\/|\\)_/g, '/').trim('_', '/', '\\');
        return name;
    }
    return null;
};

DataPacksExpand.prototype.getDataPackName = function(dataPackType, sObjectType, dataPackData) {
    var name = this.getNameWithFields(this.vlocity.datapacksutils.getFileName(dataPackType, sObjectType), dataPackData);
    return name ? name : dataPackType;
};

DataPacksExpand.prototype.getListFileName = function(dataPackType, sObjectType, dataPackData) {
    var name = this.getNameWithFields(this.vlocity.datapacksutils.getListFileName(dataPackType, sObjectType), dataPackData);
    return name ? name : dataPackType;
};

DataPacksExpand.prototype.getDataPackFolder = function(dataPackType, sObjectType, dataPackData) {
    return this.getNameWithFields(this.vlocity.datapacksutils.getFolderName(dataPackType, sObjectType), dataPackData);
}; 

DataPacksExpand.prototype.buildHierarchyKey = function(listDataBySourceKey, sortFields, listRec, depth) {
    var self = this;

    if (!listRec.HierarchyKey) {
        
        var parentField = sortFields[1];
        var keyField = sortFields[2];
        if(!self.vlocity.namespace){
            parentField = parentField.replace(/%vlocity_namespace%__/g,'');
            keyField = keyField.replace(/%vlocity_namespace%__/g,'');
        }
        var thisKey = listRec[keyField].toString().padStart(10, '0');

        if (!listRec[parentField]) {
            listRec.HierarchyKey = thisKey;
        } else {
            var parentRecKey = listRec[parentField].VlocityMatchingRecordSourceKey;

            if (depth > 3) {
                VlocityUtils.error('Error Getting Hierarchy Key - Circular Reference found on object with Id', parentRecKey);
                return '999999999';
            } else if (listDataBySourceKey[parentRecKey]) {
                var parentHierarchyKey = self.buildHierarchyKey(listDataBySourceKey, sortFields, listDataBySourceKey[parentRecKey], depth ? depth + 1 : 1);
                listRec.HierarchyKey = parentHierarchyKey + thisKey;
            }
        }
    }

    return listRec.HierarchyKey ? listRec.HierarchyKey : '999999999';
};

DataPacksExpand.prototype.sortList = function(listData, dataPackType) {
    var self = this;

    if (listData.length > 0 && typeof listData[0] === "object" && listData[0].VlocityRecordSObjectType) {
        var sObjectType = listData[0].VlocityRecordSObjectType;
        
        var sortFields = self.vlocity.datapacksutils.getSortFields(dataPackType, sObjectType);

        listData = self.removeDuplicates(listData);

        if (sortFields.indexOf('HierarchicalKey') == 0) {
            var listDataBySourceKey = {}
            listData.forEach(function(listRec) {
                if (listRec.VlocityRecordSourceKey) {
                   
                    listDataBySourceKey[listRec.VlocityRecordSourceKey] = listRec;
                }
            });

            listData.forEach(function(listRec) {
                self.buildHierarchyKey(listDataBySourceKey, sortFields, listRec);
            });

            sortFields = ['HierarchyKey'];
        }

        listData.sort(function(a, b) {
            return self.listSortBy(a, b, sortFields, 0);
        });

        listData.forEach(item => {
            if (item) {
                delete item.HierarchyKey;
            }
        });
    }

    return listData;
};


DataPacksExpand.prototype.removeDuplicates = function(listData) {
    var newList = [];
    var alreadyExisting = {};

    for (var i = 0; i < listData.length; i++) {
        var asJSON = stringify(listData[i]);

        if (!alreadyExisting[asJSON]) {
            newList.push(listData[i]);
            alreadyExisting[asJSON] = true;
        }
    }

    return newList;
}

DataPacksExpand.prototype.processList = async function(dataPackType, parentName, filename, listData, isPagination) {
    var self = this;

    if (listData.length > 0) {

        var sObjectType = listData[0].VlocityRecordSObjectType;
      
        listData.forEach(function(dataPack) {
            self.processObjectEntry(dataPackType, dataPack, isPagination);
        });

        var fileType = self.vlocity.datapacksutils.getFileType(dataPackType, sObjectType);

        listData = self.sortList(listData, dataPackType);

        var dataPackName = self.getListFileName(dataPackType, sObjectType);
        var packName;

        if (!parentName) {
            parentName = dataPackName;
        }
    
        if (filename) {
            packName = filename + "_" + dataPackName;
        } else {
            packName = dataPackName;
        }

        return await this.writeFile(dataPackType, parentName, packName, fileType, listData, isPagination);
    }
};

DataPacksExpand.prototype.listSortBy = function(obj1, obj2, fieldsArray, fieldsArrayIndex) {
    var self = this;

    var obj1Data = obj1[fieldsArray[fieldsArrayIndex]];
    var obj2Data = obj2[fieldsArray[fieldsArrayIndex]];

    if (fieldsArray[fieldsArrayIndex] == 'Hash') {
        obj1Data = stringify(obj1);
        obj2Data = stringify(obj2);
    } else if (fieldsArray[fieldsArrayIndex].indexOf('=') >= 0) {
        var equalsIndex = fieldsArray[fieldsArrayIndex].indexOf('=');
        var beforeEquals = fieldsArray[fieldsArrayIndex].substring(0, equalsIndex);
        var afterEquals = fieldsArray[fieldsArrayIndex].substring(equalsIndex+1);

        // Move to front of sort order
        if (obj1[beforeEquals] == afterEquals) {
            obj1Data = '!';
        }

        if (obj2[beforeEquals] == afterEquals) {
            obj2Data = '!';
        }
    }

    // Handle cases where data is null vs empty string
    if (obj1Data !== 0 && !obj1Data) {
        obj1Data = null;
    } else if (typeof obj1Data == 'object') {
        obj1Data = stringify(obj1Data);
    }

    if (obj2Data !== 0 && !obj2Data) {
        obj2Data = null;
    } else if (typeof obj2Data == 'object') {
        obj2Data = stringify(obj2Data);
    }

    if (obj1Data !== 0 && obj1Data == null && obj2Data != null) {
        return 1;
    }

    if (obj1Data != null && obj2Data == null && obj2Data !== 0) {
        return -1;
    }

    if (obj1Data < obj2Data) {
        return -1;
    }
    
    if (obj1Data > obj2Data) {
        return 1;
    }

    if (fieldsArray[fieldsArrayIndex] == "Hash") {
        return 0;
    }

    if (fieldsArrayIndex == fieldsArray.length-1) {
        return this.listSortBy(obj1, obj2, ["Hash"], 0);
    }

    return this.listSortBy(obj1, obj2, fieldsArray, fieldsArrayIndex+1);
};

DataPacksExpand.prototype.processObjectEntry = function(dataPackType, dataPackData)
{
    var self = this;
    var sObjectType = dataPackData.VlocityRecordSObjectType;

    var jsonFields = self.vlocity.datapacksutils.getJsonFields(dataPackType, sObjectType);

    if (jsonFields) {
        jsonFields.forEach(function(field) {
            if (typeof dataPackData[field] === "string" && dataPackData[field] != "") {
                try {
                    dataPackData[field] = JSON.parse(dataPackData[field]);
                } catch (e) {
                    VlocityUtils.verbose(field, e);
                }
            }
        });
    }
};

DataPacksExpand.prototype.getSourceKeyData = function(currentData, jobInfo) {
    var self = this;

    var sourceKeyFields = self.vlocity.datapacksutils.getSourceKeyDefinitionFields(currentData.VlocityRecordSObjectType);

    var sourceKeyData = { 
        VlocityRecordSourceKeyOriginal: currentData.VlocityRecordSourceKey, 
        VlocityRecordSourceKeyNew: currentData.VlocityRecordSourceKey 
    };

    var isMatchingKey = currentData.VlocityDataPackType == 'VlocityLookupMatchingKeyObject' || currentData.VlocityDataPackType == 'VlocityMatchingKeyObject';

    if (isMatchingKey) {
        sourceKeyData.VlocityRecordSourceKeyOriginal = currentData.VlocityMatchingRecordSourceKey ? currentData.VlocityMatchingRecordSourceKey : currentData.VlocityLookupRecordSourceKey;

        sourceKeyData.VlocityRecordSourceKeyNew = sourceKeyData.VlocityRecordSourceKeyOriginal;

        var matchingSourceKeyFields = self.vlocity.datapacksutils.getMatchingSourceKeyDefinitionFields(currentData.VlocityRecordSObjectType);
    
        if (matchingSourceKeyFields) {
            sourceKeyFields = matchingSourceKeyFields;
        }
    }

    if (sourceKeyFields) {
        
        var newSourceKey = currentData.VlocityRecordSObjectType;
        var missingSourceKey = false;

        sourceKeyFields.forEach(function(keyField) {
            if (keyField == "Hash") {
                newSourceKey += "/" + self.vlocity.datapacksutils.guid();
            } else if (keyField.indexOf('_') == 0) {
                newSourceKey += "/" + keyField.substring(1);
            } else {
                if ((currentData[keyField] == null || currentData[keyField] == "") 
                    && (jobInfo.addSourceKeys && !isMatchingKey)) {
                    currentData[keyField] = self.vlocity.datapacksutils.guid();
                }

                var objectSourceData = currentData[keyField];

                if (objectSourceData == null || objectSourceData == "") {
                    missingSourceKey = true;
                } else if (typeof objectSourceData === "object") {

                    if (objectSourceData.VlocityMatchingRecordSourceKey && jobInfo.vlocityRecordSourceKeyMap[objectSourceData.VlocityMatchingRecordSourceKey]) {
                        newSourceKey += "/" + jobInfo.vlocityRecordSourceKeyMap[objectSourceData.VlocityMatchingRecordSourceKey].VlocityRecordSourceKeyNew;
                    } else if (objectSourceData.VlocityLookupRecordSourceKey && jobInfo.vlocityRecordSourceKeyMap[objectSourceData.VlocityLookupRecordSourceKey]) {

                        newSourceKey += "/" + jobInfo.vlocityRecordSourceKeyMap[objectSourceData.VlocityLookupRecordSourceKey].VlocityRecordSourceKeyNew;
                    } else {
                        newSourceKey += "/" + self.getSourceKeyData(objectSourceData, jobInfo).VlocityRecordSourceKeyNew;
                    }
                    
                    sourceKeyData[keyField] = JSON.parse(JSON.stringify(objectSourceData));
                } else {
                    newSourceKey += "/" + objectSourceData;
                    sourceKeyData[keyField] = currentData[keyField];
                }
            }
        });

        if (!missingSourceKey) {
            if (newSourceKey.length > 255 || newSourceKey.match(/[\"\[\{"]/)) {
                newSourceKey = `${currentData.VlocityRecordSObjectType}/Generated${this.vlocity.datapacksutils.hashCode(newSourceKey)}`;
            }

            sourceKeyData.VlocityRecordSourceKeyNew = newSourceKey;
        } else if (!isMatchingKey) {
            var generatedKey = this.vlocity.datapacksutils.getSingleSObjectHash(null, currentData);

            if (generatedKey) {
                sourceKeyData.VlocityRecordSourceKeyNew = `${currentData.VlocityRecordSObjectType}/Generated${generatedKey}`;
            }
        }
    } 
    // This is Vlocity trick to help unique objects with GlobalKeys not already added to DataPacks metadata
    else if (currentData['%vlocity_namespace%__GlobalKey__c']) {
        sourceKeyData.VlocityRecordSourceKeyNew = currentData.VlocityRecordSObjectType + "/" + currentData['%vlocity_namespace%__GlobalKey__c'];
    } else if (currentData['GlobalKey__c']) {
        sourceKeyData.VlocityRecordSourceKeyNew = currentData.VlocityRecordSObjectType + "/" + currentData['GlobalKey__c'];
    } else {
        var generatedKey = this.vlocity.datapacksutils.getSingleSObjectHash(null, currentData);

        if (generatedKey) {
            sourceKeyData.VlocityRecordSourceKeyNew = `${currentData.VlocityRecordSObjectType}/Generated${generatedKey}`;
        }
       
    }

    return sourceKeyData;
}

DataPacksExpand.prototype.filterNestedField = function(currentData, filterField) {
    if (!filterField.includes('.')) {
        delete currentData[filterField];
    } else {
        var splitFields = filterField.split('.');
        var primaryField = splitFields.shift();

        if (Array.isArray(currentData[primaryField])) {
            for (var nestedMore of currentData[primaryField]) {
                this.filterNestedField(nestedMore, splitFields.join('.'));
            } 
        } else {
            this.filterNestedField(currentData[primaryField], splitFields.join('.'));
        } 
    }
}

DataPacksExpand.prototype.getNestedDataPackReferences = async function(jobInfo, currentData, parentKeys, referencefield, referenceType) {

    if (!currentData) {
        return;
    }
    
    if (!referencefield.includes('.')) {

        if (currentData[referencefield]) {

            if (Array.isArray(currentData[referencefield])) {

                for (var refVal of currentData[referencefield]) {
                    var referenceDataPackKey = `${referenceType}/${refVal}`;
                    if (parentKeys.indexOf(referenceDataPackKey) == -1) {
                        parentKeys.push(referenceDataPackKey);
                    }
                }
                
            } else {
                if (jobInfo.maxDepth != 0) {
                    if (!jobInfo.referencedSalesforceMetadata) {
                        jobInfo.referencedSalesforceMetadata = [];
                    }

                    let referenceInfo = await this.vlocity.datapacksutils.handleDataPackEvent('onAutoExport', referenceType, { jobInfo: jobInfo, currentData: currentData });

                    if (referenceInfo && jobInfo.referencedSalesforceMetadata.indexOf(referenceInfo) === -1) {
                        jobInfo.referencedSalesforceMetadata.push(referenceInfo);
                       
                        if (parentKeys.indexOf(referenceInfo) == -1) {
                            parentKeys.push(referenceInfo);
                        }
                    }
                }

                var referenceDataPackKey = `${referenceType}/${currentData[referencefield]}`;
                if (parentKeys.indexOf(referenceDataPackKey) == -1) {
                    parentKeys.push(referenceDataPackKey);
                }
            }
        }
        
    } else {
        var splitFields = referencefield.split('.');
        var primaryField = splitFields.shift();

        if (Array.isArray(currentData[primaryField])) {
            for (var nestedMore of currentData[primaryField]) {
                await this.getNestedDataPackReferences(jobInfo, nestedMore, parentKeys, splitFields.join('.'), referenceType);
            } 
        } else {
            await this.getNestedDataPackReferences(jobInfo, currentData[primaryField], parentKeys, splitFields.join('.'), referenceType);
        } 
    }
}

DataPacksExpand.prototype.preprocessSObjects = async function(currentData, dataPackType, dataPackKey, jobInfo, parentKeys) {

    var self = this;

    if (currentData) {

        if (currentData.VlocityDataPackData) {
            var dataField = self.vlocity.datapacksutils.getDataField(currentData);

            if (dataField && currentData.VlocityDataPackData[dataField]) {
                for (var sobjectData of currentData.VlocityDataPackData[dataField]) {
                    await self.preprocessSObjects(sobjectData, dataPackType, dataPackKey, jobInfo, parentKeys);
                }
            }
        } else {
            
            if (Array.isArray(currentData)) {
                for (var childData of currentData) {
                    await self.preprocessSObjects(childData, dataPackType, dataPackKey, jobInfo, parentKeys);
                }

            } else {

                // Remove all Fields with . in them like AttributeId__r.CategoryName__c
                Object.keys(currentData).forEach(function(fieldKey) {
                    if (fieldKey.indexOf('.') != -1 && typeof currentData[fieldKey] === 'object') {
                        delete currentData[fieldKey];
                    }
                });
                
                var originalSourceKey = currentData.VlocityRecordSourceKey;

                var currentId = currentData.Id;

                if (typeof currentData.Name === "object") {
                    currentData.Name = currentData.Id ? currentData.Id : originalSourceKey;
                }

                if (currentData.Name 
                    && currentId 
                    && (currentData.Name == currentId 
                        || currentData.Name == currentId.substring(0, 15))) {

                    if (currentData['%vlocity_namespace%__GlobalKey__c']) {
                        currentData.Name = currentData['%vlocity_namespace%__GlobalKey__c'];
                    } else {
                        currentData.Name = currentData.VlocityRecordSObjectType.replace('%vlocity_namespace%__', '') + currentData.Name;
                    }
                }

                var keepOnlyFields = self.vlocity.datapacksutils.getKeepOnlyFields(dataPackType, currentData.VlocityRecordSObjectType);

                if (keepOnlyFields && currentData.VlocityDataPackType == 'SObject') {
                    keepOnlyFields = keepOnlyFields.concat(['VlocityDataPackType', 'VlocityRecordSObjectType', 'VlocityRecordSourceKey']);

                    for (var field in currentData) {
                        if (keepOnlyFields.indexOf(field) == -1 && !Array.isArray(currentData[field])) {
                            delete currentData[field];
                        }
                    }
                }
                
                var defaultFilterFields = self.vlocity.datapacksutils.getFilterFields(null, 'All');

                defaultFilterFields.forEach(function(field) {
                    delete currentData[field];
                });

                var filterFields = self.vlocity.datapacksutils.getFilterFields(dataPackType, currentData.VlocityRecordSObjectType);

                if (filterFields) {
                    filterFields.forEach(function(field) {
                        delete currentData[field];

                        if (field.indexOf('.') != -1) {
                            try {
                                var splitFields = field.split('.');

                                if (currentData[splitFields[0]]) {
                                    var nestedData = { [splitFields[0]]: JSON.parse(currentData[splitFields[0]]) };
                                    self.filterNestedField(nestedData, field);
                                    currentData[splitFields[0]] = stringify(nestedData[splitFields[0]]);
                                }
                            } catch (e) {
                                VlocityUtils.error('Failure in nested parsing', e);
                            }
                        }
                    });
                }

                var dataPackReferences = self.vlocity.datapacksutils.getDataPackReferences(dataPackType, currentData.VlocityRecordSObjectType);
                if (dataPackReferences) {
                    dataPackReferences.forEach(function(reference) {
                        if (reference.Field.indexOf('.') != -1) {
                            try {
                                var splitFields = reference.Field.split('.');
                                var primaryField = splitFields.shift();
                                if(!self.vlocity.namespace){
                                    primaryField = primaryField.replace(/%vlocity_namespace%__/g,'')
                                }
                                if (currentData[primaryField]) {
                                    self.getNestedDataPackReferences(jobInfo, JSON.parse(currentData[primaryField]), parentKeys, splitFields.join('.'), reference.Type);
                                }
                            } catch (e) {
                                VlocityUtils.error('Failure in nested parsing', e);
                            }
                        }
                    });
                }

                var allReferenceFields = await this.vlocity.datapacksutils.getAllReferenceFields(currentData.VlocityRecordSObjectType);

                if (allReferenceFields) {
                    for (var referenceField of allReferenceFields) {
                        if (currentData[referenceField] && typeof currentData[referenceField] === 'string') {
                            delete currentData[referenceField];
                        }
                    }
                }

                var replacementFields = self.vlocity.datapacksutils.getReplacementFields(dataPackType, currentData.VlocityRecordSObjectType);

                if (replacementFields 
                    && !currentData.VlocityMatchingRecordSourceKey 
                    && !currentData.VlocityLookupRecordSourceKey) {
                    Object.keys(replacementFields).forEach(function(field) {

                        if (replacementFields[field].indexOf('_') == 0) {
                            currentData[field] = replacementFields[field].substring(1);
                        } else {
                            
                            // Skip if already has GlobalKey
                            if (field == '%vlocity_namespace%__GlobalKey__c' && currentData[field]) {
                                return;
                            }

                            currentData[field] = currentData[replacementFields[field]];
                        }
                    });
                }

                // Non Unique SObjects are ones that will be deleted when they are imported, meaning the fields with only default / "" values are not useful to save.
                var isNonUniqueSObject = self.vlocity.datapacksutils.isNonUnique(dataPackType, currentData.VlocityRecordSObjectType);

                var removeNullValues = self.vlocity.datapacksutils.isRemoveNullValues(dataPackType, currentData.VlocityRecordSObjectType);

                if (isNonUniqueSObject || removeNullValues) {

                    Object.keys(currentData).forEach(function(sobjectField) {
                        if (currentData[sobjectField] === "") {
                           delete currentData[sobjectField];
                        }
                    });
                }      

                var sourceKeyData = self.getSourceKeyData(currentData, jobInfo);

                currentData.VlocityRecordSourceKey = sourceKeyData.VlocityRecordSourceKeyNew;
                currentData.VlocityRecordSourceKeyOriginal = sourceKeyData.VlocityRecordSourceKeyOriginal;

                if (currentData.VlocityDataPackType != 'VlocityLookupMatchingKeyObject' 
                    && currentData.VlocityDataPackType != 'VlocityMatchingKeyObject') {

                    if (sourceKeyData.VlocityRecordSourceKeyOriginal) {
                        jobInfo.vlocityRecordSourceKeyMap[sourceKeyData.VlocityRecordSourceKeyOriginal] = sourceKeyData;
                    }
                    
                    if (currentId) {
                        jobInfo.vlocityRecordSourceKeyMap[currentId] = sourceKeyData;
                        jobInfo.vlocityRecordSourceKeyMap[sourceKeyData.VlocityRecordSourceKeyOriginal] = sourceKeyData;
                        jobInfo.vlocityKeysToNewNamesMap[sourceKeyData.VlocityRecordSourceKeyOriginal] = sourceKeyData.VlocityRecordSourceKeyNew;
                    }

                    for (var sobjectField in currentData) {
                        if (typeof currentData[sobjectField] === "object") {
                            if (Array.isArray(currentData[sobjectField])) {
                                currentData[sobjectField] = self.sortList(currentData[sobjectField], dataPackType);
                            }

                            await self.preprocessSObjects(currentData[sobjectField], dataPackType, currentData.VlocityDataPackKey, jobInfo, parentKeys);
                        }
                    }
                } else if (currentData.VlocityLookupRecordSourceKey
                    || currentData.VlocityMatchingRecordSourceKey) {

                    var sKey = currentData.VlocityLookupRecordSourceKey ? currentData.VlocityLookupRecordSourceKey : currentData.VlocityMatchingRecordSourceKey;

                    // Inject Parent Keys for consistency
                    if (parentKeys.indexOf(sKey) == -1) {
                        parentKeys.push(sKey);

                        if (sourceKeyData.VlocityRecordSourceKeyNew) {
                            parentKeys.push(sourceKeyData.VlocityRecordSourceKeyNew);
                        }
                    }  
                }
            }
        }       
    }
}

DataPacksExpand.prototype.preprocessDataPack = async function(currentData, jobInfo) {

    var self = this;

    var dataField = self.vlocity.datapacksutils.getDataField(currentData);

    if (dataField) {

        if (currentData.VlocityDataPackType == 'SObject') {
            currentData.VlocityDataPackType = 'SObject_' + dataField.replace(/%vlocity_namespace%__|__c/g, '');
        }

        if (!currentData.VlocityDataPackParents) {
            currentData.VlocityDataPackParents = [];
        }

        var dataPackType = currentData.VlocityDataPackType;

        if (currentData.VlocityDataPackData && currentData.VlocityDataPackData[dataField]) {

            for (var sobjectData of currentData.VlocityDataPackData[dataField]) {
                if (sobjectData) {
                    await self.preprocessSObjects(sobjectData, currentData.VlocityDataPackType, currentData.VlocityDataPackKey, jobInfo, currentData.VlocityDataPackParents);
    
                    var parentName = self.getDataPackFolder(dataPackType, sobjectData.VlocityRecordSObjectType, sobjectData);
                    var generatedKey = dataPackType + "/" + parentName;
    
                    jobInfo.vlocityKeysToNewNamesMap[currentData.VlocityDataPackKey] = generatedKey;
    
                    if (currentData.Name) {
                        jobInfo.generatedKeysToNames[generatedKey] = currentData.Name;
                    }
    
                    // make sure we don't overwrite keys later
                    jobInfo.vlocityKeysToNewNamesMap[generatedKey] = generatedKey;
    
                    if (jobInfo.allParents.indexOf(generatedKey) == -1) {
                        jobInfo.allParents.push(generatedKey);
                    }
                }
            }

            if (jobInfo.maxDepth != 0) {
                await this.vlocity.datapacksutils.handleDataPackEvent('getAdditionalReferences', currentData.VlocityDataPackType, { jobInfo: jobInfo, currentData: currentData });
            }
        }
    }
}

DataPacksExpand.prototype.replaceAnySourceKeys = function(currentData, jobInfo) {
    var self = this;
    var backUpSourceKey = self.getSourceKeyData(currentData, jobInfo).VlocityRecordSourceKeyNew;

    [ 'VlocityLookupRecordSourceKey', 'VlocityRecordSourceKey', 'VlocityRecordMatchingKey' ].forEach(function(sourceField) {

        if (currentData[sourceField] 
            && typeof currentData[sourceField] == 'string' 
            && currentData[sourceField].indexOf('VlocityRecordSourceKey') == 0) {
            currentData[sourceField] = self.getSourceKeyData(currentData, jobInfo).VlocityRecordSourceKeyNew;
        }
    });
}

DataPacksExpand.prototype.updateSourceKeysInDataPack = function(currentData, jobInfo, allLocalKeys, parentKey) {

    var self = this;

    if (currentData) {

        if (currentData.VlocityDataPackData) {
            var dataField = self.vlocity.datapacksutils.getDataField(currentData);

            if (dataField && currentData.VlocityDataPackData[dataField]) {
                currentData.VlocityDataPackData[dataField].forEach(function(sobjectData) {
                    self.updateSourceKeysInDataPack(sobjectData, jobInfo, allLocalKeys, currentData.VlocityDataPackKey);
                });
            }
        } else { 
           
            if (Array.isArray(currentData)) {
                currentData.forEach(function(childData) {
                    self.updateSourceKeysInDataPack(childData, jobInfo, allLocalKeys, parentKey);
                });

            } else {       
                
                if (!jobInfo.sourceKeysByParent[currentData.VlocityRecordSourceKey]) {
                    jobInfo.sourceKeysByParent[currentData.VlocityRecordSourceKey] = [];
                }

                // This is meant to refix any broken links due to missing Matching Key Data.
                // Matching key in this situation must also be defined as a SourceKeyDefinitions
                // Future Enhancement - Get and Create Matching Keys through here
                if (currentData.VlocityDataPackType == 'VlocityLookupMatchingKeyObject' || currentData.VlocityDataPackType == 'VlocityMatchingKeyObject') {

                    var originalSourceKeyObject = jobInfo.vlocityRecordSourceKeyMap[currentData.VlocityRecordSourceKeyOriginal];

                    if (originalSourceKeyObject 
                        && originalSourceKeyObject.VlocityRecordSourceKeyNew) {
                        var clonedOriginalSourceKeyObject = JSON.parse(JSON.stringify(originalSourceKeyObject));

                        currentData.VlocityRecordSourceKey = originalSourceKeyObject.VlocityRecordSourceKeyNew;

                        if (self.vlocity.datapacksutils.endsWith(originalSourceKeyObject.VlocityRecordSourceKeyNew, '-VLSK')) {
                            Object.keys(clonedOriginalSourceKeyObject).forEach(function(sourceDataKey) {
                                currentData[sourceDataKey] = clonedOriginalSourceKeyObject[sourceDataKey]; 
                            });
                        }
                    } else { 

                        var matchingSourceKey = self.getSourceKeyData(currentData, jobInfo);
                        currentData.VlocityRecordSourceKey = matchingSourceKey.VlocityRecordSourceKeyNew;
                    }
                } else {

                    allLocalKeys.push(currentData.VlocityRecordSourceKey);

                    // Make as Array because can Export Multiple Keys due to the way dependencies are exported
                    if (jobInfo.sourceKeysByParent[currentData.VlocityRecordSourceKey].indexOf(parentKey) == -1) {
                        jobInfo.sourceKeysByParent[currentData.VlocityRecordSourceKey].push(parentKey);
                    }
                }

                Object.keys(currentData).forEach(function(sobjectField) {
                    
                    if (typeof currentData[sobjectField] === "object") {
                        self.updateSourceKeysInDataPack(currentData[sobjectField], jobInfo, allLocalKeys, parentKey);
                    } else if (jobInfo.vlocityRecordSourceKeyMap[currentData[sobjectField]]) {
                        // This attempts to replace any Id with a SourceKey
                        currentData[sobjectField] = jobInfo.vlocityRecordSourceKeyMap[currentData[sobjectField]].VlocityRecordSourceKeyNew;
                    }
                });

                if (currentData.VlocityDataPackType == 'VlocityLookupMatchingKeyObject') {

                    if (currentData.VlocityMatchingRecordSourceKey 
                        && allLocalKeys.indexOf(currentData.VlocityMatchingRecordSourceKey) != -1) {

                        currentData.VlocityDataPackType = 'VlocityMatchingKeyObject';

                        delete currentData.VlocityLookupRecordSourceKey;
                    } else if (currentData.VlocityLookupRecordSourceKey 
                        && allLocalKeys.indexOf(currentData.VlocityLookupRecordSourceKey) != -1) {
                        currentData.VlocityDataPackType = 'VlocityMatchingKeyObject';

                        currentData.VlocityMatchingRecordSourceKey = currentData.VlocityLookupRecordSourceKey;

                        delete currentData.VlocityLookupRecordSourceKey;
                    } else if (currentData.VlocityMatchingRecordSourceKey) {
                        currentData.VlocityLookupRecordSourceKey = currentData.VlocityMatchingRecordSourceKey;
                        delete currentData.VlocityMatchingRecordSourceKey;
                    }
                } 

                self.replaceAnySourceKeys(currentData, jobInfo);

                var isNonUniqueSObject = self.vlocity.datapacksutils.isNonUnique(currentData.VlocityDataPackType, currentData.VlocityRecordSObjectType);

                // Remove Data that is not needed and can't be generated in a repeatable way 
                if (isNonUniqueSObject 
                    || currentData.VlocityDataPackType == 'VlocityLookupMatchingKeyObject'
                    || currentData.VlocityDataPackType == 'VlocityMatchingKeyObject') {
                        delete currentData.VlocityRecordSourceKey;
                }

                delete currentData.VlocityRecordSourceKeyNew;
                delete currentData.VlocityRecordSourceKeyOriginal;
            }
        }
    }
};

DataPacksExpand.prototype.processDataPack = async function(dataPackData, jobInfo, isPagination) {

    var self = this;

    if (dataPackData.VlocityDataPackData) {

        var dataPackType = dataPackData.VlocityDataPackType;
        var dataPackKey = dataPackData.VlocityDataPackKey;

        var dataField = self.vlocity.datapacksutils.getDataField(dataPackData);

        if (dataField && !Array.isArray(dataPackData.VlocityDataPackData[dataField])) {
            VlocityUtils.error('No Data In DataPack', dataPackData.VlocityDataPackKey, dataPackData.VlocityDataPackName);        
            jobInfo.errors.push('error  - ' + dataPackData.VlocityDataPackKey + ' - ' + dataPackData.VlocityDataPackName);        
        }

        if (dataField && dataPackData.VlocityDataPackData[dataField]) {

            for (var sobjectData of dataPackData.VlocityDataPackData[dataField]) {

                if (!jobInfo.includeOrgUrl) {
                    delete dataPackData.VlocityDataPackData[dataField][0].sourceOrgUrl;
                    delete dataPackData.VlocityDataPackData[dataField][0].targetOrgUrl;
                }

                var parentName = self.getDataPackFolder(dataPackType, sobjectData.VlocityRecordSObjectType, sobjectData);
                var dataPackName = self.getDataPackName(dataPackType, sobjectData.VlocityRecordSObjectType, sobjectData);

                var labelData = JSON.parse(JSON.stringify(sobjectData));
                labelData.VlocityDataPackType = dataPackData.VlocityDataPackType;

                jobInfo.allDataSummary[dataPackData.VlocityDataPackKey] = {
                    VlocityDataPackDisplayLabel: self.vlocity.datapacksutils.getDisplayName(labelData),
                    VlocityDataPackType: dataPackData.VlocityDataPackType
                };

                var allParentKeys = [];
                var allRels = {};

                if (!dataPackData.VlocityDataPackParents) {
                    dataPackData.VlocityDataPackParents = [];
                }

                var parentFileNameFull = self.generateFilepath(dataPackType, parentName, dataPackName + "_ParentKeys", "json");

                try {
                    var loadedParentKeys = JSON.parse(await fs.readFile(parentFileNameFull, { "encoding": "utf8" }));
                    dataPackData.VlocityDataPackParents = dataPackData.VlocityDataPackParents.concat(loadedParentKeys);
                } catch (e) {

                }

                var relFileNameFull = self.generateFilepath(dataPackType, parentName, dataPackName + "_AllRelationshipKeys", "json");

                try {
                    allRels = JSON.parse(await fs.readFile(relFileNameFull, { "encoding": "utf8" }));
                    dataPackData.VlocityDataPackAllRelationships = allRels;
                } catch (e) {

                }
                    
                if (!isPagination) {
                    fs.emptyDirSync(self.generateFolderPath(dataPackType, parentName));
                }

                var localFileKey = dataPackType + "/" + parentName;

                dataPackData.VlocityDataPackParents.forEach((parentKey) => {
                    if (jobInfo.allParents.indexOf(parentKey) != -1) {
                        allParentKeys.push(parentKey);
                    } else if (jobInfo.sourceKeysByParent[parentKey]) {
                        jobInfo.sourceKeysByParent[parentKey].forEach((ultimateParent) => {
                            allParentKeys.push(ultimateParent);

                            if (jobInfo.vlocityKeysToNewNamesMap[ultimateParent] && allParentKeys.indexOf(jobInfo.vlocityKeysToNewNamesMap[ultimateParent]) == -1) {
                                allParentKeys.push(jobInfo.vlocityKeysToNewNamesMap[ultimateParent]);
                            }
                            
                        });
                    }
                });

                var finalParentKeys = [];

                await this.vlocity.datapacksutils.handleDataPackEvent('onGenerateParentKeys', dataPackData.VlocityDataPackType, { dataPackData: dataPackData, allParentKeys: allParentKeys });

                allParentKeys.forEach(function(parentKey) {
                    if (!parentKey || finalParentKeys.indexOf(parentKey) != -1) {
                        return;
                    }

                    if (localFileKey != parentKey
                        && dataPackKey != parentKey 
                        && parentKey.indexOf('|Page|') == -1
                        && !self.vlocity.datapacksutils.isGuaranteedParentKey(parentKey) 
                        && (jobInfo.allParents.indexOf(parentKey) != -1
                        || jobInfo.allParents.indexOf(self.sanitizeDataPackKey(parentKey)) != -1)) {
                        finalParentKeys.push(parentKey);
                    } else if (parentKey.startsWith('classes/')) {
                        finalParentKeys.push(parentKey);
                    }
                });

                if (finalParentKeys.length > 0) {
                    finalParentKeys.sort();
                    await this.writeFile(dataPackType, parentName, dataPackName + "_ParentKeys", "json", finalParentKeys, isPagination);
                }

                if (jobInfo.useAllRelationships !== false && dataPackData.VlocityDataPackAllRelationships) {
                    
                    Object.keys(dataPackData.VlocityDataPackAllRelationships).forEach(function(relKey) {
                        if (jobInfo.vlocityKeysToNewNamesMap[relKey]) {
                            allRels[jobInfo.vlocityKeysToNewNamesMap[relKey]] = dataPackData.VlocityDataPackAllRelationships[relKey];
                        }
                    });

                    if (Object.keys(allRels).length > 0) {
                        await self.writeFile(dataPackType, parentName, dataPackName + "_AllRelationshipKeys", "json", allRels, isPagination);
                    }
                }

                await this.processDataPackData(dataPackType, parentName, null, sobjectData, isPagination, jobInfo);
                jobInfo.expandedDataPacks.push(dataPackKey);
            }   
        }
    }
};

DataPacksExpand.prototype.processDataPackData = async function(dataPackType, parentName, filename, dataPackData, isPagination, jobInfo, listFileNames) {
    var self = this;

    if (dataPackData) {

        if (dataPackData.VlocityRecordSObjectType) {
            var sObjectType = dataPackData.VlocityRecordSObjectType;

            var currentObjectName = this.getDataPackName(dataPackType, sObjectType, dataPackData);
            
            var packName = null;
            var nameExtension = '';
            var fileType = null;

            if (filename) {
                packName = filename + "_" + currentObjectName;
                fileType = self.vlocity.datapacksutils.getFileType(dataPackType, sObjectType);
            } else {
                packName = currentObjectName;
                nameExtension = "_DataPack";
                fileType = "json";
            }

            var dataPackMetadata = {};

            this.processObjectEntry(dataPackType, dataPackData, isPagination);

            var doNotExpand = self.vlocity.datapacksutils.isDoNotExpand(dataPackType);

            for (var sobjectField in dataPackData) {

                var ignoreExpand = self.vlocity.datapacksutils.isIgnoreExpand(dataPackType, sobjectField);

                dataPackMetadata[sobjectField] = dataPackData[sobjectField];

                if (ignoreExpand) {
                    continue;
                }

                if (self.vlocity.datapacksutils.isBuildOnlyField(dataPackType, sObjectType, sobjectField)) {
                    delete dataPackMetadata[sobjectField];
                    continue;
                }

                var expansionType = self.vlocity.datapacksutils.getExpandedDefinition(dataPackType, sObjectType, sobjectField);

                var expansionData = dataPackData[sobjectField];

                if (!expansionType 
                    && Array.isArray(expansionData) 
                    && expansionData[0] 
                    && expansionData[0].VlocityRecordSObjectType) {
                    expansionType = "list";
                }

                if (expansionType && !doNotExpand) {

                    var extension = null;
                    var prefix = '';
                    var filenameKeys = null;

                    if (expansionType && typeof expansionType === "object") {
                        if (expansionType.FileName) {
                            filenameKeys = expansionType.FileName;
                        }

                        if (expansionType.FileExt == "null") {
                            extension = "";
                        } else if (expansionType.FileExt) {
                             extension = expansionType.FileExt;
                        }

                        if (expansionType.FilePrefix) {
                            prefix = expansionType.FilePrefix + '_';
                        }
                        
                        if (expansionType.FileType) {

                            if (!extension) {
                                extension = expansionType.FileType;
                            }

                            expansionType = expansionType.FileType;
                        }                       
                    } else {
                        extension = expansionType;
                    }

                    if (!extension) {
                        extension = "json";
                    }
                    try {
                        if (expansionData) {
                            if (expansionType == "list") {
                                dataPackMetadata[sobjectField] = await self.processList(dataPackType, parentName, packName, expansionData, isPagination);
                            } else if (expansionType == "object") {
                                var listExpansion = [];
                                var listFileNames = [];

                                for (var childInList of expansionData) {
                                    listExpansion.push(await self.processDataPackData(dataPackType, parentName, packName, childInList, isPagination, jobInfo, listFileNames));
                                }

                                if (expansionData.length == 1) {
                                    dataPackMetadata[sobjectField] = listExpansion[0];
                                } else if (expansionData.length > 1) {
                                    dataPackMetadata[sobjectField] = listExpansion;
                                }
                            } else {
                                // Skip compiled fields
                                if (self.compileOnBuild && self.vlocity.datapacksutils.isCompiledField(dataPackType, sObjectType, sobjectField)) {

                                    delete dataPackMetadata[sobjectField];
                                    continue;
                                }

                                var encoding;

                                var dataFileName = prefix + packName;

                                if (filenameKeys) {
                                    dataFileName += "_" + self.getNameWithFields(filenameKeys, dataPackData);
                                }

                                if (expansionType == "base64") {
                                    encoding = "base64";
                                    
                                    if (extension && dataPackData[extension]) {
                                        extension = dataPackData[extension];
                                    }
                                }

                                dataPackMetadata[sobjectField] = await this.writeFile(dataPackType, parentName, dataFileName, extension, expansionData, isPagination, encoding);
                            }
                        } 
                    } catch (e) {
                        VlocityUtils.error('Error Processing Expansion Data', e);
                        continue;
                    }
                } 
            }

            if (nameExtension == "_DataPack" && Object.keys(dataPackMetadata).length == 0) {
                return;
            }

            if (listFileNames) {

                var caseInsensitive = (packName + nameExtension).toLowerCase();
                if (listFileNames.indexOf((packName + nameExtension).toLowerCase()) != -1) {
                    var nameAddition = 1;
                    var originalNameExtension = nameExtension;
    
                    while (listFileNames.indexOf((packName + nameExtension).toLowerCase()) != -1) {
                        nameExtension = originalNameExtension + '_' + nameAddition;
                        nameAddition++;
                    }
                }
    
                listFileNames.push((packName + nameExtension).toLowerCase());
            }
           
            return await this.writeFile(dataPackType, parentName, packName + nameExtension, fileType, dataPackMetadata, isPagination);
        }
    }
};

DataPacksExpand.prototype.getReferencedDataPacks = function(extension, dataPackType, expansionData, jobInfo) { 
    if (jobInfo.maxDepth == 0 || !jobInfo.fullManifest) {
        return;
    }

    if (extension === 'scss') {
        if (!jobInfo.compileOnBuild) {
            return;
        }

        var regex = new RegExp("(?:@import \")(.*?)(?:;)", "ig");
        var found = expansionData.match(regex);

        if (found) {
            if (!jobInfo.fullManifest[dataPackType]) {
                jobInfo.fullManifest[dataPackType] = {};
            }

            for (var importName of found) {
                var dataPackName = importName.split("\"")[1];

                jobInfo.fullManifest[dataPackType][dataPackType + '/' + dataPackName] = {VlocityDataPackKey: dataPackType + '/' + dataPackName, VlocityDataPackType: dataPackType, Id: dataPackName};
            }
        }
    }
};

DataPacksExpand.prototype.writeFile = async function(dataPackType, parentName, filename, fileType, fileData, isPagination, encoding) {
    var self = this;

    if (!fileData) {
        return fileData;
    }

    var dataPackKey = dataPackType + '/' + parentName;
    if (this.vlocity.datapacksutils.ignoreFileMap && this.vlocity.datapacksutils.ignoreFileMap.ignores(dataPackKey)) {
        VlocityUtils.verbose('ignoring', dataPackKey);
        return;
    }

    // File Path should have "Project Name"
    var fullFilePath = this.generateFilepath(dataPackType, parentName, filename, fileType);

    if (isPagination) {
        try {
            if (Array.isArray(fileData)) {
                var previousFileData = JSON.parse(await fs.readFile(fullFilePath, { "encoding": encoding }));
                fileData = Array.from(new Set(previousFileData.concat(fileData)));
                fileData = self.sortList(fileData, dataPackType);
            } else if (filename.indexOf('_AllRelationshipKeys') > 0) {
                var previousFileData = JSON.parse(await fs.readFile(fullFilePath, { "encoding": encoding }));

                Object.keys(previousFileData).forEach(function(key) {
                    fileData[key] = previousFileData[key];
                });
            } 
        } catch (e) {
            VlocityUtils.error(e.stack);
        }
    }

    if (fileType == "json") {
        if (typeof fileData === "object") {
            fileData = stringify(fileData, { space: 4 });
        } else {
            try {
                // There is an issue with sometimes strange escape chars in sample JSON         
                fileData = stringify(JSON.parse(fileData.replace(/&amp;quot;/g, '').replace(/&quot;/g, '"').replace(/”|“/g, '"')), { space: 4 });
            } catch (e) {
                VlocityUtils.error('JSON Parsing Error', filename + "." + fileType, e.message);
                return fileData;
            }
        }

        if (fileData == '{\n}') {
            return '{}';
        } else if (fileData == '[\n]') {
            return '[]';
        }
    }

    if (!encoding) {
        encoding = 'utf8';
    }

    await fs.outputFile(fullFilePath, fileData, { "encoding": encoding });

    if (fullFilePath.indexOf('_DataPack') > -1) {
        VlocityUtils.success('Creating file', path.normalize(fullFilePath));
    } else {
        VlocityUtils.verbose('Creating file', path.normalize(fullFilePath));
    }

    return self.generateFolderOrFilename(filename, fileType);
};

var folderMetadata = { 
    dashboards: "dashboardFolder-meta.xml", 
    documents: "documentFolder-meta.xml", 
    email: "emailFolder-meta.xml", 
    reports: "reportFolder-meta.xml" 
};

DataPacksExpand.addAdditionalMetadataKeysForSFDX = function(manifestKeys) {
    if (manifestKeys) {
        var newKeys = [];

        for (var key of manifestKeys) {
            var splitKey = key.split('/');
            var folderForKey = splitKey[0];
            
            if (folderMetadata[folderForKey]) {
                var folderMetadataKey = `${splitKey[0]}/${splitKey[1]}.${folderMetadata[folderForKey]}`;
                if (!newKeys.includes(folderMetadataKey)) {
                    newKeys.push(folderMetadataKey);
                }
            }
            
            if (folderForKey == 'documents' && key.indexOf('.document-meta.xml') == -1) {
                var newKey = key.substring(0, key.lastIndexOf('.')) + '.document-meta.xml';
                newKeys.push(newKey);
            } 
        }

        return newKeys;
    }

    return [];
}

DataPacksExpand.prototype.expandFile = async function(targetPath, expandFile, jobInfo) {
    try {
        let allDataPacks = JSON.parse(fs.readFileSync(expandFile, 'utf8'));
        
        if (!jobInfo.vdxnamespace) {
            jobInfo.vdxnamespace = allDataPacks.vdxnamespace;
        }

        let expandPacks = [];

        if (jobInfo.specificManifestKeys) {

            jobInfo.specificManifestKeys = jobInfo.specificManifestKeys.concat(DataPacksExpand.addAdditionalMetadataKeysForSFDX(jobInfo.specificManifestKeys));

            for (var dataPack of allDataPacks.dataPacks) {
                if (jobInfo.specificManifestKeys.includes(dataPack.VlocityDataPackKey) || jobInfo.specificManifestKeys.includes(dataPack.VlocityDataPackKey.replace('-meta.xml', ''))) {
                    expandPacks.push(dataPack);
                }
            }
        } else {
            expandPacks = allDataPacks.dataPacks;
        }
    
        await this.expand(targetPath, { dataPacks: expandPacks }, jobInfo);

        for (var dataPackKey of jobInfo.expandedDataPacks) {           
            jobInfo.currentStatus[dataPackKey] = 'Success';
        }
        
    } catch (e) {
        VlocityUtils.error('Invalid DataPackFile ', expandFile, e.message, e.stack);
    }
};

DataPacksExpand.prototype.expandSFDX = async function(dataPack, jobInfo) {
    if (dataPack.SFDXData) {

        let namespace = '%vlocity_namespace%';
        
        if (jobInfo.vdxnamespace && jobInfo.vdxnamespace != '%vlocity_namespace%') {
            namespace = jobInfo.vdxnamespace
        } else if (this.vlocity.namespace && this.vlocity.namespace != '%vlocity_namespace%') {
            namespace = this.vlocity.namespace;
        } 

        if (!jobInfo.sfdxFolderPath) {
            var projectInfo = this.vlocity.datapacksutils.getSFDXProject(jobInfo);

            jobInfo.sfdxFolderPath = projectInfo.sfdxProject.packageDirectories[0].path;
        }

        var fullFilePath = path.join(jobInfo.sfdxFolderPath, 'main', 'default', dataPack.VlocityDataPackKey).replace(/%vlocity_namespace%/g, namespace);

        if (namespace != '%vlocity_namespace%') {
            dataPack.SFDXData = dataPack.SFDXData.replace(/%vlocity_namespace%/g, namespace);
        }

        VlocityUtils.success('Writing SFDX File', fullFilePath);

        if (dataPack.SFDXDataType == 'staticresources') {
            var allFiles = JSON.parse(dataPack.SFDXData);

            for (resourceFile of allFiles) {
                if (resourceFile.originalFilePath) {
                    fs.copySync(resourceFile.originalFilePath, path.join(jobInfo.sfdxFolderPath, resourceFile.filePath));
                }
            }
        } else {
            await fs.outputFile(fullFilePath, dataPack.SFDXData, { "encoding": dataPack.SFDXDataType });
        }

        jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Success';
    }
}

DataPacksExpand.prototype.expand = async function(targetPath, dataPackData, jobInfo) {
    this.compileOnBuild = jobInfo.compileOnBuild;
    this.targetPath = targetPath;
    if (dataPackData.dataPacks) {
        VlocityUtils.verbose('Start Expand');
        var expandPromises = [];
        for (var dataPack of dataPackData.dataPacks) {
            expandPromises.push(this.expandSFDX(dataPack, jobInfo));
        }
        await Promise.all(expandPromises);

        for (var dataPack of dataPackData.dataPacks) {
            await this.preprocessDataPack(dataPack, jobInfo);
        }

        for (var dataPack of dataPackData.dataPacks) {
            this.updateSourceKeysInDataPack(dataPack, jobInfo, []);
        }

        VlocityUtils.verbose('Expanding All');
        var processPromises = [];
        for (var dataPack of dataPackData.dataPacks) {
            if (dataPack.VlocityDataPackRelationshipType != "Pagination") {
               processPromises.push(this.processDataPack(dataPack, jobInfo, false));
            }
        }
        
        await Promise.all(processPromises);

        for (var dataPack of dataPackData.dataPacks) {
            if (dataPack.VlocityDataPackRelationshipType == "Pagination") {
                await this.processDataPack(dataPack, jobInfo, true);
            }
        }
    }
};
