var request = require("request");
var yaml = require("js-yaml");
var fs = require("fs-extra");
var path  = require("path");
var stringify = require('json-stable-stringify');
var unidecode = require('unidecode'); 

var DataPacksExpand = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};
};

DataPacksExpand.prototype.generateFolderPath = function(dataPackType, parentName) {
    var self = this;
    //Replace spaces with dash (-) to have a valid file name for cards
    var validParentName = self.generateFolderOrFilename(parentName);

    return self.targetPath + "/" + dataPackType + "/" + validParentName + "/";
};


DataPacksExpand.prototype.generateFolderOrFilename = function(filename, extension) {

    var santizedFilename = unidecode(filename).replace(/%vlocity_namespace%__/g,"").replace(/[^A-Za-z0-9_\-\.]/g, "-");

    if (extension 
        && extension != "base64" 
        && !this.vlocity.datapacksutils.endsWith(filename, "." + extension)) {
        santizedFilename += "." + extension;
    }

    return santizedFilename;
}

//Generate the full file path
DataPacksExpand.prototype.generateFilepath = function(dataPackType, parentName, filename, extension) {
    var self = this;

    var validFileName = self.generateFolderOrFilename(filename, extension);

    return self.generateFolderPath(dataPackType, parentName) + validFileName; 
};

DataPacksExpand.prototype.getNameWithFields = function(nameFields, dataPackData) {
    var self = this;
    var filename = "";

    nameFields.forEach(function(key) {

        if (filename != "") {
            filename += "_";
        }

        // If key references a field adds that otherwise is literal string
        if (key.indexOf('_') == 0) {
            filename += key.substring(1);
        } else if (dataPackData[key] && (typeof dataPackData[key] === "string" || typeof dataPackData[key] === "number")) {
            filename += dataPackData[key];
        }
        else if (typeof dataPackData[key] === "object") {
            filename += self.getDataPackFolder(null, dataPackData[key].VlocityRecordSObjectType, dataPackData[key]);
        }
    });

    if (filename == "") {
        if (dataPackData.Name && typeof dataPackData.Name === "string") {
            filename += dataPackData.Name;
        } else {
            filename = null;
        }
    }

    return filename;
};

DataPacksExpand.prototype.getDataPackName = function(dataPackType, sObjectType, dataPackData) {
    var self = this;
    var name = self.getNameWithFields(self.vlocity.datapacksutils.getFileName(dataPackType, sObjectType), dataPackData);
    return name ? name : dataPackType;
};

DataPacksExpand.prototype.getListFileName = function(dataPackType, sObjectType, dataPackData) {
    var self = this;
    var name = self.getNameWithFields(self.vlocity.datapacksutils.getListFileName(dataPackType, sObjectType), dataPackData);
    return name ? name : dataPackType;
};

DataPacksExpand.prototype.getDataPackFolder = function(dataPackType, sObjectType, dataPackData) {
    var self = this;
    return self.getNameWithFields(self.vlocity.datapacksutils.getFolderName(dataPackType, sObjectType), dataPackData);
};

DataPacksExpand.prototype.sortList = function(listData, dataPackType) {
    var self = this;

    if (listData.length > 0 && typeof listData[0] === "object" && listData[0].VlocityRecordSObjectType) {
        var sObjectType = listData[0].VlocityRecordSObjectType;

        var sortFields = self.vlocity.datapacksutils.getSortFields(dataPackType, sObjectType);

        var listDataBefore = stringify(listData);

        listData.sort(function(a, b) {
            return self.listSortBy(a, b, sortFields, 0);
        });  
    }
}

DataPacksExpand.prototype.processList = function(dataPackType, parentName, filename, listData, isPagination) {
    var self = this;

    if (listData.length > 0) {

        var sObjectType = listData[0].VlocityRecordSObjectType;
      
        listData.forEach(function(dataPack) {
            self.processObjectEntry(dataPackType, dataPack, isPagination);
        });

        var fileType = self.vlocity.datapacksutils.getFileType(dataPackType, sObjectType);

        self.sortList(listData, dataPackType);

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

        return self.writeFile(dataPackType, parentName, packName, fileType, listData, isPagination);
    }
};

DataPacksExpand.prototype.listSortBy = function(obj1, obj2, fieldsArray, fieldsArrayIndex) {
    var self = this;

    var obj1Data = obj1[fieldsArray[fieldsArrayIndex]];
    var obj2Data = obj2[fieldsArray[fieldsArrayIndex]];

    if (fieldsArray[fieldsArrayIndex] == "Hash") {
        obj1Data = stringify(obj1);
        obj2Data = stringify(obj2);
    }

    // Handle cases where data is null vs empty string
    if (!obj1Data) {
        obj1Data = null;
    }

    if (!obj2Data) {
        obj2Data = null;
    }

    if (obj1Data == null && obj2Data != null) {
        return 1;
    }

    if (obj1Data != null && obj2Data == null) {
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

DataPacksExpand.prototype.processObjectEntry = function(dataPackType, dataPackData, isPagination)
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
                    console.log(field, e);
                }
            }
        });
    }
};

DataPacksExpand.prototype.generateSourceKey = function(currentData, jobInfo) {
    var self = this;
    
    var generationFields = self.vlocity.datapacksutils.getSourceKeyGenerationFields(currentData.VlocityRecordSObjectType);

    var generatedKey = '';

    generationFields.forEach(function(keyField) {

        var objectSourceData = currentData[keyField];

        if (typeof objectSourceData === "object") {
           generatedKey += '/' + self.getSourceKeyData(objectSourceData, jobInfo).VlocityRecordSourceKeyNew;
        } else {
            generatedKey += '/' + objectSourceData;
        }
    });
    
    return self.vlocity.datapacksutils.guid(generatedKey) +  '-VLSK';
}

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
    }

    if (sourceKeyFields) {
        
        var newSourceKey = currentData.VlocityRecordSObjectType;
        var missingSourceKey = false;

        sourceKeyFields.forEach(function(keyField) {

            if ((currentData[keyField] == null || currentData[keyField] == "") 
                && (jobInfo.addSourceKeys && !isMatchingKey)) {
                currentData[keyField] = self.generateSourceKey(currentData, jobInfo);
            }

            var objectSourceData = currentData[keyField];

            if (objectSourceData == null || objectSourceData == "") {
                missingSourceKey = true;
            } else if (typeof objectSourceData === "object") {
                newSourceKey += "/" + self.getSourceKeyData(objectSourceData, jobInfo).VlocityRecordSourceKeyNew;
                sourceKeyData[keyField] = JSON.parse(stringify(objectSourceData));
            } else {
                newSourceKey += "/" + objectSourceData;
                sourceKeyData[keyField] = currentData[keyField];
            }
        });

        if (!missingSourceKey) {
           sourceKeyData.VlocityRecordSourceKeyNew = newSourceKey;
        }
    } 
    // This is Vlocity trick to help unique objects with GlobalKeys not already added to DataPacks metadata
    else if (currentData['%vlocity_namespace%__GlobalKey__c'] != "") {
        sourceKeyData.VlocityRecordSourceKeyNew = currentData.VlocityRecordSObjectType + "/" + currentData['%vlocity_namespace%__GlobalKey__c'];
    } else if (currentData['GlobalKey__c'] != "") {
        sourceKeyData.VlocityRecordSourceKeyNew = currentData.VlocityRecordSObjectType + "/" + currentData['GlobalKey__c'];
    }

    return sourceKeyData;
}

DataPacksExpand.prototype.preprocessSObjects = function(currentData, dataPackType, jobInfo) {

    var self = this;

    if (currentData) {

        if (currentData.VlocityDataPackData) {
            var dataField = self.vlocity.datapacksutils.getDataField(currentData);

            if (dataField) {
                self.preprocessSObjects(currentData.VlocityDataPackData[dataField][0],dataPackType, jobInfo);
            }
        } else { 
   
            if (Array.isArray(currentData)) {

                self.sortList(currentData, dataPackType);
                currentData.forEach(function(childData) {
                    self.preprocessSObjects(childData, dataPackType, jobInfo);
                });

            } else {

                var originalSourceKey = currentData.VlocityRecordSourceKey;

                var currentId = currentData.Id;

                if (typeof currentData.Name === "object") {
                    currentData.Name = currentData.Id ? currentData.Id : originalSourceKey;
                }

                if (currentData.Name 
                    && currentId 
                    && currentData.Name.indexOf(currentId) != -1) {
                    currentData.Name = self.generateSourceKey(currentData, jobInfo);
                }

                var defaultFilterFields = self.vlocity.datapacksutils.getFilterFields(null, 'All');

                defaultFilterFields.forEach(function(field) {
                    delete currentData[field];
                });

                var filterFields = self.vlocity.datapacksutils.getFilterFields(dataPackType, currentData.VlocityRecordSObjectType);

                if (filterFields) {
                    filterFields.forEach(function(field) {
                        delete currentData[field];
                    });
                }

                var replacementFields = self.vlocity.datapacksutils.getReplacementFields(dataPackType, currentData.VlocityRecordSObjectType);

                if (replacementFields) {
                    Object.keys(replacementFields).forEach(function(field) {

                        if (replacementFields[field].indexOf('_') == 0) {
                            currentData[field] = replacementFields[field].substring(1);
                        } else {
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
                    jobInfo.vlocityRecordSourceKeyMap[sourceKeyData.VlocityRecordSourceKeyOriginal] = sourceKeyData;

                    if (currentId) {
                        jobInfo.vlocityRecordSourceKeyMap[currentId] = sourceKeyData;
                        jobInfo.vlocityRecordSourceKeyMap[sourceKeyData.VlocityRecordSourceKeyOriginal] = sourceKeyData;
                        jobInfo.vlocityKeysToNewNamesMap[sourceKeyData.VlocityRecordSourceKeyOriginal] = sourceKeyData.VlocityRecordSourceKeyNew;
                    }

                    Object.keys(currentData).forEach(function(sobjectField) {
                        if (typeof currentData[sobjectField] === "object") {
                            self.preprocessSObjects(currentData[sobjectField], dataPackType, jobInfo);
                        }
                    });
                }
            }
        }       
    }
}

DataPacksExpand.prototype.preprocessDataPack = function(currentData, jobInfo) {

    var self = this;

    var dataField = self.vlocity.datapacksutils.getDataField(currentData);

    if (dataField) {

        var sobjectData = currentData.VlocityDataPackData[dataField][0];

        if (currentData.VlocityDataPackType == 'SObject') {
            currentData.VlocityDataPackType = 'SObject_' + dataField.replace(/%vlocity_namespace%__|__c/g, '');

            currentData.VlocityDataPackParents = [];

            Object.keys(sobjectData).forEach(function(childKey) {

                if (typeof sobjectData[childKey] == 'object' && sobjectData[childKey].VlocityLookupRecordSourceKey) {
                    currentData.VlocityDataPackParents.push(sobjectData[childKey].VlocityLookupRecordSourceKey);
                }

                if (childKey.indexOf('.') != -1) {
                    delete sobjectData[childKey];
                }
            });
        }

        self.preprocessSObjects(sobjectData, currentData.VlocityDataPackType, jobInfo);

        var parentName;
        var dataPackType = currentData.VlocityDataPackType;

        if (sobjectData) {

            parentName = self.getDataPackFolder(dataPackType, sobjectData.VlocityRecordSObjectType, sobjectData);
            var generatedKey = dataPackType + "/" + parentName;

            jobInfo.vlocityKeysToNewNamesMap[currentData.VlocityDataPackKey] = generatedKey;

            // make sure we don't overwrite keys later
            jobInfo.vlocityKeysToNewNamesMap[generatedKey] = generatedKey;
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

DataPacksExpand.prototype.updateSourceKeysInDataPack = function(currentData, jobInfo) {

    var self = this;

    if (currentData) {

        if (currentData.VlocityDataPackData) {
            var dataField = self.vlocity.datapacksutils.getDataField(currentData);

            if (dataField) {
                self.updateSourceKeysInDataPack(currentData.VlocityDataPackData[dataField][0], jobInfo);
            }
        } else { 
           
            if (Array.isArray(currentData)) {
                currentData.forEach(function(childData) {
                    self.updateSourceKeysInDataPack(childData, jobInfo);
                });

            } else {       
                // This is meant to refix any broken links due to missing Matching Key Data.
                // Matching key in this situation must also be defined as a SourceKeyDefinitions
                // Future Enhancement - Get and Create Matching Keys through here
                if (currentData.VlocityDataPackType == 'VlocityLookupMatchingKeyObject' || currentData.VlocityDataPackType == 'VlocityMatchingKeyObject') {

                    var originalSourceKeyObject = jobInfo.vlocityRecordSourceKeyMap[currentData.VlocityRecordSourceKeyOriginal];

                    //console.log('originalSourceKeyObject', originalSourceKeyObject);

                    if (originalSourceKeyObject 
                        && originalSourceKeyObject.VlocityRecordSourceKeyNew) {
                        var clonedOriginalSourceKeyObject = JSON.parse(stringify(originalSourceKeyObject));

                        currentData.VlocityRecordSourceKey = originalSourceKeyObject.VlocityRecordSourceKeyNew;

                        if (self.vlocity.datapacksutils.endsWith(originalSourceKeyObject.VlocityRecordSourceKeyNew, '-VLSK')) {
                            Object.keys(clonedOriginalSourceKeyObject).forEach(function(sourceDataKey) {
                                currentData[sourceDataKey] = clonedOriginalSourceKeyObject[sourceDataKey]; 
                            });
                        }
                    }
                }

                Object.keys(currentData).forEach(function(sobjectField) {

                    
                    if (typeof currentData[sobjectField] === "object") {
                        self.updateSourceKeysInDataPack(currentData[sobjectField], jobInfo);
                    } else if (jobInfo.vlocityRecordSourceKeyMap[currentData[sobjectField]]) {
                        // This attempts to replace any Id with a SourceKey
                        currentData[sobjectField] = jobInfo.vlocityRecordSourceKeyMap[currentData[sobjectField]].VlocityRecordSourceKeyNew;
                    }
                });

               
                if (currentData.VlocityDataPackType == 'VlocityLookupMatchingKeyObject') {

                    if (currentData.VlocityMatchingRecordSourceKey) {
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
}

DataPacksExpand.prototype.processDataPack = function(dataPackData, jobInfo, isPagination) {

    var self = this;
    if (dataPackData.VlocityDataPackData) {

        var dataPackType = dataPackData.VlocityDataPackType;
        if ((!jobInfo.manifestOnly || self.vlocity.datapacksutils.isInManifest(dataPackData.VlocityDataPackData, jobInfo.manifest))) {

            var dataField = self.vlocity.datapacksutils.getDataField(dataPackData);
            if (!dataField)
                return;

            var dataPackDataChildern = dataPackData.VlocityDataPackData[dataField];
            if (!dataPackDataChildern)
                return;

            dataPackDataChildern.forEach((dataPackDataChild) => {
                // Top level is always an array with 1 element -- not always true
                //dataPackDataChild = dataPackDataChild[0];

                var parentName = self.getDataPackFolder(dataPackType, dataPackDataChild.VlocityRecordSObjectType, dataPackDataChild);
                var dataPackName = self.getDataPackName(dataPackType, dataPackDataChild.VlocityRecordSObjectType, dataPackDataChild);

                var allParentKeys = [];
                var allRels = {};

                // Load parent key data if doing a maxDepth != -1 to not lose parent keys
                if (jobInfo.maxDepth != null && jobInfo.maxDepth >= 0 && dataPackData.VlocityDepthFromPrimary != 0) {
                    var parentFileNameFull = self.generateFilepath(dataPackType, parentName, dataPackName + "_ParentKeys", "json");

                    try {
                        allParentKeys = JSON.parse(fs.readFileSync(parentFileNameFull, { "encoding": "utf8" }));
                    } catch (e) {

                    }

                    var relFileNameFull = self.generateFilepath(dataPackType, parentName, dataPackName + "_AllRelationshipKeys", "json");

                    try {
                        allRels = JSON.parse(fs.readFileSync(relFileNameFull, { "encoding": "utf8" }));
                        dataPackData.VlocityDataPackAllRelationships = allRels;
                    } catch (e) {

                    }
                }
                    
                if (!isPagination) {
                    fs.emptyDirSync(this.generateFolderPath(dataPackType, parentName));
                }

                if (dataPackData.VlocityDataPackParents && dataPackData.VlocityDataPackParents.length > 0) {
                    dataPackData.VlocityDataPackParents.forEach(function(parentKey) {
                        if (jobInfo.vlocityKeysToNewNamesMap[parentKey]) {

                            if (allParentKeys.indexOf(jobInfo.vlocityKeysToNewNamesMap[parentKey]) == -1) {
                                allParentKeys.push(jobInfo.vlocityKeysToNewNamesMap[parentKey]);
                            }
                        }
                    });

                    if (allParentKeys.length > 0) {
                        allParentKeys.sort();
                        self.writeFile(dataPackType, parentName, dataPackName + "_ParentKeys", "json", allParentKeys, isPagination);
                    }
                }

                if (jobInfo.useAllRelationships !== false && dataPackData.VlocityDataPackAllRelationships) {
                   
                    Object.keys(dataPackData.VlocityDataPackAllRelationships).forEach(function (relKey) {
                        if (jobInfo.vlocityKeysToNewNamesMap[relKey]) {
                            allRels[jobInfo.vlocityKeysToNewNamesMap[relKey]] = dataPackData.VlocityDataPackAllRelationships[relKey];
                        }
                    });

                    if (Object.keys(allRels).length > 0) {
                        self.writeFile(dataPackType, parentName, dataPackName + "_AllRelationshipKeys", "json", allRels, isPagination);
                    }
                }

                self.processDataPackData(dataPackType, parentName, null, dataPackDataChild, isPagination);
            });            
        }
    }
}

DataPacksExpand.prototype.processDataPackData = function(dataPackType, parentName, filename, dataPackData, isPagination) {
    var self = this;

    if (dataPackData) {

        if (dataPackData.VlocityRecordSObjectType) {
            var sObjectType = dataPackData.VlocityRecordSObjectType;

            var currentObjectName = this.getDataPackName(dataPackType, sObjectType, dataPackData);
            
            var packName;
            var nameExtension = '';
            var fileType;

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

            Object.keys(dataPackData).forEach(function(sobjectField) {

                dataPackMetadata[sobjectField] = dataPackData[sobjectField];

                var expansionType = self.vlocity.datapacksutils.getExpandedDefinition(dataPackType, sObjectType, sobjectField);

                var expansionData = dataPackData[sobjectField];

                if (!expansionType 
                    && Array.isArray(expansionData) 
                    && expansionData[0] 
                    && expansionData[0].VlocityRecordSObjectType) {
                    expansionType = "list";
                }

                if (expansionType && !doNotExpand) {

                    var extension;
                    var prefix = '';
                    var filenameKeys;

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

                    if (expansionData) {
                        if (expansionType == "list") {
                            dataPackMetadata[sobjectField] = self.processList(dataPackType, parentName, packName, expansionData, isPagination);
                        } else if (expansionType == "object") {
                            var listExpansion = [];

                            expansionData.forEach(function(childInList) {
                                listExpansion.push(self.processDataPackData(dataPackType, parentName, packName, childInList, isPagination));
                            });

                            listExpansion.sort();

                            if (expansionData.length == 1) {
                                dataPackMetadata[sobjectField] = listExpansion[0];
                            } else if (expansionData.length > 1) {
                                dataPackMetadata[sobjectField] = listExpansion;
                            }
                        } else {
                            // Skip compiled fields
                            if (self.compileOnBuild && self.vlocity.datapacksutils.isCompiledField(dataPackType, sObjectType, sobjectField)) {

                                delete dataPackMetadata[sobjectField];
                                return;
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

                            dataPackMetadata[sobjectField] = self.writeFile(dataPackType, parentName, dataFileName, extension, expansionData, isPagination, encoding);
                        }
                    } 
                }
            });

            if (nameExtension == "_DataPack" && Object.keys(dataPackMetadata).length == 0) {
                return;
            }

            return this.writeFile(dataPackType, parentName, packName + nameExtension, fileType, dataPackMetadata, isPagination);
        }
    }
};

DataPacksExpand.prototype.writeFile = function(dataPackType, parentName, filename, fileType, fileData, isPagination, encoding) {
    var self = this;

    if (!fileData) {
        return fileData;
    }

    // File Path should have "Project Name"
    var fullFilePath = this.generateFilepath(dataPackType, parentName, filename, fileType);

    if (isPagination) {
        try {
            if (Array.isArray(fileData)) {
                var previousFileData = JSON.parse(fs.readFileSync(fullFilePath, { "encoding": encoding }));
                fileData = previousFileData.concat(fileData);
               
            } else if (fileName.indexOf('_AllRelationshipKeys') > 0) {
                var previousFileData = JSON.parse(fs.readFileSync(fullFilePath, { "encoding": encoding }));

                Object.keys(previousFileData).forEach(function(key) {
                    fileData[key] = previousFileData[key];
                });
            } 
        } catch (e) {
            //console.log(e);
        }
    }

    if (fileType == "json") {
        if (typeof fileData === "object") {
            fileData = stringify(fileData, { space: 4 });
        } else {
            try {
                // There is an issue with sometimes strange escape chars in sample JSON
                fileData = stringify(JSON.parse(fileData.replace(/&amp;quot;/g, '').replace(/&quot;/g, '"')), { space: 4 });
            } catch (e) {

                console.log('\x1b[31m', "Error", '\x1b[0m ', filename + "." + fileType, e);
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

    fs.outputFileSync(fullFilePath, fileData, { "encoding": encoding });

    if (fullFilePath.indexOf('_DataPack') > -1 || self.vlocity.verbose) {
         console.log('\x1b[32m', 'Creating file:', '\x1b[0m', fullFilePath);
    }

    return self.generateFolderOrFilename(filename, fileType);
};

DataPacksExpand.prototype.expandFile = function(targetPath, expandFile, jobInfo) {
    var self = this;
    
    try {
        self.expand(targetPath, JSON.parse(fs.readFileSync(expandFile, 'utf8')), jobInfo);
    } catch (e) {
        console.log("Invalid DataPackFile " + expandFile + ' ' + e.message);
    }
};

DataPacksExpand.prototype.expand = function(targetPath, dataPackData, jobInfo, onComplete) {
    var self = this;
    self.compileOnBuild = jobInfo.compileOnBuild;
    self.targetPath = targetPath;
    if (dataPackData.dataPacks) {
       
        dataPackData.dataPacks.forEach(function(dataPack) {
            self.preprocessDataPack(dataPack, jobInfo);
        });

        dataPackData.dataPacks.forEach(function(dataPack) {
            self.updateSourceKeysInDataPack(dataPack, jobInfo);
        });

        dataPackData.dataPacks.forEach(function(dataPack) {
           if (dataPack.VlocityDataPackRelationshipType != "Pagination") {
                self.processDataPack(dataPack, jobInfo, false);
           }
        });

        dataPackData.dataPacks.forEach(function(dataPack) {
            if (dataPack.VlocityDataPackRelationshipType == "Pagination") {
                self.processDataPack(dataPack, jobInfo, true);
            }
        });
    }

    onComplete();
};