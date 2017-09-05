var request = require("request");
var yaml = require("js-yaml");
var fs = require("fs-extra");
var path  = require("path");
var stringify = require('json-stable-stringify');
var unidecode = require('unidecode'); 

var DataPacksExpand = module.exports = function(vlocity) {
    var self = this;
    self.vlocity = vlocity || {};
    self.utils = self.vlocity.datapacksutils;
};

DataPacksExpand.prototype.generateFolderPath = function(dataPackType, parentName) {
    var self = this;
    //Replace spaces with dash (-) to have a valid file name for cards
    var validParentName = parentName.replace(/\s+/g, "-");
    return self.targetPath + "/" + dataPackType + "/" + validParentName + "/";
};

//Generate the full file path
DataPacksExpand.prototype.generateFilepath = function(dataPackType, parentName, filename, extension) {
    var self = this;
    //Replace spaces with dash (-) to have a valid file name for cards
    var validFileName = filename.replace(/\s+/g, "-");
    return self.generateFolderPath(dataPackType, parentName) + validFileName + "." + extension;
};

DataPacksExpand.prototype.getNameWithFields = function(nameFields, dataPackData) {
    var self = this;
    var filename = "";

    nameFields.forEach(function(key) {

        if (filename != "") {
            filename += "_";
        }

        // If key references a field adds that otherwise is literal string
        if (key.indexOf('#') == 0) {
            filename += key.substring(1);
        } else if (dataPackData[key] && typeof dataPackData[key] === "string") {
            filename += unidecode(dataPackData[key].replace(/\//g, "-"));
        }
    });

    if (filename == "") {
        if (dataPackData.Name && typeof dataPackData.Name === "string") {
            filename += unidecode(dataPackData.Name.replace(/\//g, "-"));
        } else {
            filename = null;
        }
    }

    // fields can contain the Vlocity namespace placeholder
    // we remove the namespace placeholder from files names to make them
    // more readable
    return filename.replace(/%vlocity_namespace%__/g,"");
};

DataPacksExpand.prototype.getDataPackName = function(dataPackType, sObjectType, dataPackData) {
    var self = this;
    var name = self.getNameWithFields(self.utils.getFileName(dataPackType, sObjectType), dataPackData);
    return name ? name : dataPackType;
};

DataPacksExpand.prototype.getDataPackFolder = function(dataPackType, sObjectType, dataPackData) {
    var self = this;
    return self.getNameWithFields(self.utils.getFolderName(dataPackType, sObjectType), dataPackData);
};

DataPacksExpand.prototype.processList = function(dataPackType, parentName, filename, listData, isPagination) {
    var self = this;

    if (listData.length > 0) {

        var sObjectType = listData[0].VlocityRecordSObjectType;
      
        listData.forEach(function(dataPack) {
            self.processObjectEntry(dataPackType, dataPack, isPagination);
        });

        var sortFields = self.utils.getSortFields(dataPackType, sObjectType);
        var fileType = self.utils.getFileType(dataPackType, sObjectType);

        listData.sort(function(a, b) {
            return self.listSortBy(a, b, sortFields, 0);
        });

        var dataPackName = self.getDataPackName(dataPackType, sObjectType, listData[0]);
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
    if (stringify(obj1[fieldsArray[fieldsArrayIndex]]) < stringify(obj2[fieldsArray[fieldsArrayIndex]])) {
        return -1;
    }
    
    if (stringify(obj1[fieldsArray[fieldsArrayIndex]]) > stringify(obj2[fieldsArray[fieldsArrayIndex]])) {
        return 1;
    }

    if (fieldsArrayIndex == fieldsArray.length-1) {
        return 0;
    }

    return this.listSortBy(obj1, obj2, fieldsArray, fieldsArrayIndex+1);
};

DataPacksExpand.prototype.processObjectEntry = function(dataPackType, dataPackData, isPagination)
{
    var self = this;
    var sObjectType = dataPackData.VlocityRecordSObjectType;
    
    var defaultFilterFields = self.utils.getFilterFields();

    defaultFilterFields.forEach(function(field) {
        delete dataPackData[field];
    });

    var filterFields = self.utils.getFilterFields(dataPackType, sObjectType);

    if (filterFields) {
        filterFields.forEach(function(field) {
            delete dataPackData[field];
        });
    }

    var jsonFields = self.utils.getJsonFields(dataPackType, sObjectType);

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

DataPacksExpand.prototype.preprocessDataPack = function(currentData, dataPackKey, options) {

    var self = this;

    if (currentData) {
       
        if (Array.isArray(currentData)) {
            currentData.forEach(function(childData) {
                self.preprocessDataPack(childData, dataPackKey, options);
            });

        } else {

            if (currentData.VlocityRecordSObjectType) {

                if (typeof currentData.Name === 'object') {
                    currentData.Name = "Id-" + currentData.Id;
                }

                // This only applies to the actual object
                if (currentData.Id && currentData.VlocityRecordSourceKey) {

                    var keyFields = self.utils.getSourceKeyDefinitionFields(currentData.VlocityRecordSObjectType);

                    var newSourceKey = currentData.VlocityRecordSObjectType;

                    var addedSourceKeyField = false;
                    keyFields.forEach(function(keyField) {
                        if (currentData[keyField]) {

                            var objectSourceData = currentData[keyField];
                            if (typeof objectSourceData === "object") {
                                 var keyFieldsForId = self.utils.getSourceKeyDefinitionFields(objectSourceData.VlocityRecordSObjectType);

                                var parentSourceAdded = false;

                                keyFieldsForId.forEach(function(keyFieldForId) {

                                    if (objectSourceData[keyFieldForId]) {
                                        newSourceKey += "/" + objectSourceData[keyFieldForId];
                                        parentSourceAdded = true;
                                    }
                                });

                                if (!parentSourceAdded && objectSourceData.Name) {
                                    newSourceKey += "/" + objectSourceData.Name;
                                }

                                addedSourceKeyField = true;
                            } else {
                                newSourceKey += "/" + objectSourceData;
                                addedSourceKeyField = true;   
                            }
                            
                        } else if (currentData[self.utils.getWithoutNamespace(keyField)]) {
                            var objectSourceData = currentData[self.utils.getWithoutNamespace(keyField)];
                            if (typeof objectSourceData === "object") {
                                var keyFieldsForId = self.utils.getSourceKeyDefinitionFields(objectSourceData.VlocityRecordSObjectType);

                                var parentSourceAdded = false;

                                keyFieldsForId.forEach(function(keyFieldForId) {

                                    var keyFieldForIdWithout = self.utils.getWithoutNamespace(keyFieldForIdWithout);

                                    if (objectSourceData[keyFieldForIdWithout]) {
                                        newSourceKey += "/" + objectSourceData[keyFieldForIdWithout];
                                        parentSourceAdded = true;
                                    }
                                });

                                if (!parentSourceAdded && objectSourceData.Name) {
                                    newSourceKey += "/" + objectSourceData.Name;
                                }

                                addedSourceKeyField = true;
                            } else {
                                newSourceKey += "/" + objectSourceData;
                                addedSourceKeyField = true;
                            }
                        }
                    });

                    if (!addedSourceKeyField) {

                        if (currentData['%vlocity_namespace%__GlobalKey__c']) {
                            newSourceKey = dataPackKey + "/" + currentData.VlocityRecordSObjectType + "/" + currentData['%vlocity_namespace%__GlobalKey__c'];
                        } else {
                            newSourceKey = dataPackKey + "/" + currentData.VlocityRecordSObjectType + "/" + currentData.Name;
                        }
                    }

                    options.vlocityRecordSourceKeyMap[currentData.VlocityRecordSourceKey] = newSourceKey;
                    options.vlocityRecordSourceKeyMap[currentData.Id] = newSourceKey;

                    currentData.VlocityRecordSourceKey = newSourceKey;
                }
            }

            if (currentData.VlocityDataPackData) {

                var dataPackType = currentData.VlocityDataPackType;
               
                var dataField = self.utils.getDataField(currentData);

                if (dataField) {
                    var dataPackDataChild = currentData.VlocityDataPackData[dataField];
                    var parentName;

                    if (dataPackDataChild) {

                        // Top level is always an array with 1 element
                        dataPackDataChild = dataPackDataChild[0];

                        parentName = self.getDataPackFolder(dataPackType, dataPackDataChild.VlocityRecordSObjectType, dataPackDataChild);

                        options.vlocityKeysToNewNamesMap[currentData.VlocityDataPackKey] = dataPackType + "/" + parentName;
                    }

                    dataPackKey = dataPackType + "/" + parentName;
                }
            }

            Object.keys(currentData).forEach(function(sobjectField) {
                if (typeof currentData[sobjectField] === "object") {
                    self.preprocessDataPack(currentData[sobjectField], dataPackKey, options);
                }
            });
        }
    }
};

DataPacksExpand.prototype.updateSourceKeysInDataPack = function(currentData, dataPackKey, options) {

    var self = this;

    if (currentData) {
       
        if (Array.isArray(currentData)) {
            currentData.forEach(function(childData) {
                self.updateSourceKeysInDataPack(childData, dataPackKey, options);
            });

        } else {

            if (currentData.VlocityRecordSObjectType) {

                // This only applies to the actual object
                if (currentData.VlocityLookupRecordSourceKey && !options.vlocityRecordSourceKeyMap[currentData.VlocityLookupRecordSourceKey]) {
                    var keyFields = self.utils.getSourceKeyDefinitionFields(currentData.VlocityRecordSObjectType);

                    var newSourceKey = currentData.VlocityRecordSObjectType;

                    var addedSourceKeyField = false;
                    keyFields.forEach(function(keyField) {
                        if (currentData[keyField]) {
                            newSourceKey += "/" + currentData[keyField];
                            addedSourceKeyField = true;
                        } else if (currentData[self.utils.getWithoutNamespace(keyField)]) {
                            newSourceKey += "/" + currentData[self.utils.getWithoutNamespace(keyField)];
                            addedSourceKeyField = true;
                        }
                    });

                    if (!addedSourceKeyField) {
                        newSourceKey = currentData.VlocityRecordSObjectType + "/" + currentData.Name;
                    }

                    currentData.VlocityLookupRecordSourceKey = newSourceKey;
                }
            }

            Object.keys(currentData).forEach(function(sobjectField) {
                if (typeof currentData[sobjectField] === "object") {
                    self.updateSourceKeysInDataPack(currentData[sobjectField], dataPackKey, options);
                } else if (options.vlocityRecordSourceKeyMap[currentData[sobjectField]]) {
                    // This attempts to replace any Id with a SourceKey
                    currentData[sobjectField] = options.vlocityRecordSourceKeyMap[currentData[sobjectField]];
                }
            });
        }
    }
}

DataPacksExpand.prototype.refreshAllParentKeys = function(options) {

    Object.keys(options.vlocityAllParentFiles).forEach(function(parentFileNameFull) {

        var allParentKeys = [];

        try {
            allParentKeys = JSON.parse(fs.readFileSync(parentFileNameFull, { "encoding": "utf8" }));
        } catch (e) {

        }

        options.vlocityAllParentFiles[parentFileNameFull].forEach(function(parentKey) {
             
             if (options.vlocityKeysToNewNamesMap[parentKey]) {

                if (allParentKeys.indexOf(options.vlocityKeysToNewNamesMap[parentKey]) == -1) {
                     allParentKeys.push(options.vlocityKeysToNewNamesMap[parentKey]);
                }
            }

            fs.outputFileSync(parentFileNameFull, stringify(allParentKeys, { space: 4 }), { "encoding": "utf8" });
        });
    });
}

DataPacksExpand.prototype.processDataPack = function(dataPackData, options, isPagination) {

    var self = this;
    if (dataPackData.VlocityDataPackData) {

        var dataPackType = dataPackData.VlocityDataPackType;

        if ((!options.manifestOnly || self.utils.isInManifest(dataPackData.VlocityDataPackData, options.manifest))) {

            var dataField = self.utils.getDataField(dataPackData);
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

                // Load parent key data if doing a maxDepth != -1 to not lose parent keys
                if (options.maxDepth && options.maxDepth != -1 && dataPackData.VlocityDepthFromPrimary != 0) {
                    var parentFileNameFull = self.generateFilepath(dataPackType, parentName, dataPackName + "_ParentKeys", "json");

                    try {
                        allParentKeys = JSON.parse(fs.readFileSync(fullFilePath, { "encoding": "utf8" }));
                    } catch (e) {

                    }
                }
                    
                if (!isPagination) {
                    fs.emptyDirSync(this.generateFolderPath(dataPackType, parentName));
                }

                if (dataPackData.VlocityDataPackParents && dataPackData.VlocityDataPackParents.length > 0) {
                    dataPackData.VlocityDataPackParents.forEach(function(parentKey) {
                        if (options.vlocityKeysToNewNamesMap[parentKey]) {

                            if (allParentKeys.indexOf(options.vlocityKeysToNewNamesMap[parentKey]) == -1) {
                                allParentKeys.push(options.vlocityKeysToNewNamesMap[parentKey]);
                            }
                        }
                    });

                    dataPackData.VlocityDataPackParents.forEach(function (parentKey) {
                        if (options.vlocityKeysToNewNamesMap[parentKey]) {
                            allParentKeys.push(options.vlocityKeysToNewNamesMap[parentKey]);
                        }

                        var parentFileNameFull = self.generateFilepath(dataPackType, parentName, dataPackName + "_ParentKeys", "json");
                        
                        if (!options.vlocityAllParentFiles[parentFileNameFull]) {
                            options.vlocityAllParentFiles[parentFileNameFull] = dataPackData.VlocityDataPackParents;
                        } else {   
                            options.vlocityAllParentFiles[parentFileNameFull].concat(dataPackData.VlocityDataPackParents);  
                        }
                    });

                    if (allParentKeys.length > 0) {
                        self.writeFile(dataPackType, parentName, dataPackName + "_ParentKeys", "json", allParentKeys, isPagination);
                    }
                }

                if (dataPackData.VlocityDataPackAllRelationships) {
                    var allRels = {};

                    Object.keys(dataPackData.VlocityDataPackAllRelationships).forEach(function (relKey) {
                        if (options.vlocityKeysToNewNamesMap[relKey]) {
                            allRels[options.vlocityKeysToNewNamesMap[relKey]] = dataPackData.VlocityDataPackAllRelationships[relKey];
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
                fileType = self.utils.getFileType(dataPackType, sObjectType);
            } else {
                packName = currentObjectName;
                nameExtension = "_DataPack";
                fileType = "json";
            }

            var dataPackMetadata = {};

            this.processObjectEntry(dataPackType, dataPackData, isPagination);
           
            Object.keys(dataPackData).forEach(function(sobjectField) {
                if (self.utils.isValidSObject(dataPackType, sObjectType)) {
                    var expansionType = self.utils.getExpandedDefinition(dataPackType, sObjectType, sobjectField);

                    if (expansionType) {

                        var extension = expansionType;
                        var filenameKeys;

                        if (expansionType && typeof expansionType === "object") {
                            if (expansionType.FileName) {
                                filenameKeys = expansionType.FileName;
                            }
                            
                            if (expansionType.FileType) {
                                expansionType = expansionType.FileType;
                            } else {
                                expansionType = 'json';
                            }

                            if (expansionType.FileExt) {
                                 extension = expansionType.FileExt;
                            } else {
                                 extension = expansionType;
                            }
                        }

                        var expansionData = dataPackData[sobjectField];
                        if (expansionData) {
                            if (expansionType == "list") {
                                dataPackMetadata[sobjectField] = self.processList(dataPackType, parentName, packName, expansionData, isPagination);
                            } else if (expansionType == "object") {
                                var listExpansion = [];

                                expansionData.forEach(function(childInList) {
                                    listExpansion.push(self.processDataPackData(dataPackType, parentName, packName, childInList, isPagination));
                                });

                                if (expansionData.length == 1) {
                                    dataPackMetadata[sobjectField] = listExpansion[0];
                                } else if (expansionData.length > 1) {
                                    dataPackMetadata[sobjectField] = listExpansion;
                                }
                            } else {
                                // Skip compiled fields
                                if (self.compileOnBuild && self.utils.isCompiledField(dataPackType, sObjectType, sobjectField)) {
                                    return;
                                }

                                var encoding;

                                var dataFileName = packName;

                                if (filenameKeys) {
                                    dataFileName += "_" + self.getNameWithFields(filenameKeys, dataPackData);
                                }

                                if (expansionType == "base64") {
                                    encoding = "base64";
                                    
                                    if (dataPackData[extension]) {
                                        extension = dataPackData[extension];
                                    }
                                } 

                                dataPackMetadata[sobjectField] = self.writeFile(dataPackType, parentName, dataFileName, extension, expansionData, isPagination, encoding);
                            }
                        }
                    } else {
                        dataPackMetadata[sobjectField] = dataPackData[sobjectField];
                    }
                }
            });

            return this.writeFile(dataPackType, parentName, packName + nameExtension, fileType, dataPackMetadata, isPagination);
        }
    }
};

DataPacksExpand.prototype.writeFile = function(dataPackType, parentName, filename, fileType, fileData, isPagination, encoding) {
    var self = this;

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
                fileData = stringify(JSON.parse(fileData), { space: 4 });
            } catch (e) {
                console.log('\x1b[31m', "Error", '\x1b[0m ', filename + "." + fileType, e);
            }
        }
    }

    if (!encoding) {
        encoding = 'utf8';
    }

    fs.outputFileSync(fullFilePath, fileData, { "encoding": encoding });

    if (fullFilePath.indexOf('_DataPack') > -1 || self.vlocity.verbose) {
         console.log('\x1b[32m', 'Creating file:', '\x1b[0m', fullFilePath);
    }

    return filename.replace(/\s+/g, "-") + "." + fileType;
};

DataPacksExpand.prototype.expandFile = function(targetPath, expandFile, options) {
    var self = this;
    
    try {
        self.expand(targetPath, JSON.parse(fs.readFileSync(expandFile, 'utf8')), options);
    } catch (e) {
        console.log("Invalid DataPackFile " + expandFile + ' ' + e.message);
    }
};

DataPacksExpand.prototype.expand = function(targetPath, dataPackData, options, onComplete) {
    var self = this;
    self.compileOnBuild = options.compileOnBuild;
    self.targetPath = targetPath;
    if (dataPackData.dataPacks) {
       
        dataPackData.dataPacks.forEach(function(dataPack) {
            self.preprocessDataPack(dataPack, null, options);
        });

        dataPackData.dataPacks.forEach(function(dataPack) {
            self.updateSourceKeysInDataPack(dataPack, null, options);
        });

        dataPackData.dataPacks.forEach(function(dataPack) {
           if (dataPack.VlocityDataPackRelationshipType != "Pagination") {
                self.processDataPack(dataPack, options, false);
           }
        });

        dataPackData.dataPacks.forEach(function(dataPack) {
            if (dataPack.VlocityDataPackRelationshipType == "Pagination") {
                self.processDataPack(dataPack, options, true);
            }
        });
    }

    onComplete();
};