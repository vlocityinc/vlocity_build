var request = require('request');
var yaml = require('js-yaml');
var path = require('path');
var fs = require('fs-extra');
var sass = require('node-sass');
var stringify = require('json-stable-stringify');

var UTF8_EXTENSIONS = [ "css", "json", "yaml", "scss", "html", "js"];

var DataPacksBuilder = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};

    this.dataPacksExpandedDefinition = JSON.parse(fs.readFileSync(path.join(__dirname, "datapacksexpanddefinition.json"), 'utf8'));
    //this.defaultDataPack = JSON.parse(fs.readFileSync(path.join(__dirname, 'defaultdatapack.json'), 'utf8'));
    this.currentStatus;
    this.currentImportData = {};
};

DataPacksBuilder.prototype.buildImport = function(importPath, manifest, jobInfo) {
    var self = this;

    var dataPackImport = JSON.parse(fs.readFileSync(path.join(__dirname, 'defaultdatapack.json'), 'utf8'));

    var MAX_IMPORT_SIZE = 400000;

    if (jobInfo.maximumFileSize) {
        MAX_IMPORT_SIZE = jobInfo.maximumFileSize;
    }

    if (jobInfo.expansionPath) {
        importPath += '/' + jobInfo.expansionPath;
    }

    self.compileOnBuild = jobInfo.compileOnBuild;

    if (!self.currentStatus) {
        self.initializeImportStatus(importPath, manifest, jobInfo);
    }

    var nextImport;

    do {
        nextImport = self.getNextImport(importPath, Object.keys(self.currentStatus));

        if (nextImport) {
            dataPackImport.dataPacks.push(nextImport);
        }   

    } while (nextImport && (jobInfo.singleFile || stringify(dataPackImport).length < MAX_IMPORT_SIZE))

    return dataPackImport.dataPacks.length > 0 ? dataPackImport : null;  
};

DataPacksBuilder.prototype.loadFilesAtPath = function(srcpath, jobInfo) {
    var self = this;

    self.vlocity.datapacksutils.getFiles(srcpath).forEach(function(filename) {

        var encoding = 'base64';

        var extension = filename.substr(filename.lastIndexOf('.')+1);

        if (UTF8_EXTENSIONS.indexOf(extension) > -1) {
            encoding = 'utf8';
        }

        if (!self.allFileDataMap) {
            self.allFileDataMap = {};
        }
       
        self.allFileDataMap[srcpath + '/' + filename] = fs.readFileSync(srcpath + '/' + filename, encoding);

        if (filename.indexOf('_DataPack') != -1) {

            var jsonData = JSON.parse(self.allFileDataMap[srcpath + '/' + filename]);
            var apexImportData = {};

            self.vlocity.datapacksutils.getApexImportDataKeys(jsonData.VlocityRecordSObjectType).forEach(function(field) {
                apexImportData[field] = jsonData[field];
            });

            if (jobInfo.preDeployDataSummary == null) {
                jobInfo.preDeployDataSummary = [];
            }

            jobInfo.preDeployDataSummary.push(apexImportData);
        }
    });
};

DataPacksBuilder.prototype.getDataPackLabel = function(dataPackTypeDir, dataPackName) {
    var allFiles = this.vlocity.datapacksutils.getFiles(dataPackTypeDir + '/' + dataPackName);
    for (var i = 0; i < allFiles.length; i++) {
        if (allFiles[i].indexOf('_DataPack.json') != -1) {
           return allFiles[i].substr(0, allFiles[i].indexOf('_DataPack.json'));
        }
    }
};

DataPacksBuilder.prototype.initializeImportStatus = function(importPath, manifest, jobInfo) {
    var self = this;

    var matchingFunction = function(dataPackType, dataPackName) {
        if (Array.isArray(manifest[dataPackType])) {
            return !!manifest[dataPackType].find(function(entry) {
                return (entry.replace(/ /g, '-') == dataPackName);
            });
        }
        var matchingString = manifest[dataPackType];
        if (typeof matchingString != "string") {
            matchingString = stringify(matchingString);
        }
        return (matchingString.indexOf(dataPackName) != -1);
    }

    self.currentStatus = {};

    if (manifest) {
        self.pendingFromManifest = JSON.parse(stringify(manifest));
    } else {
        self.pendingFromManifest = {};
    }

    var importPaths = self.vlocity.datapacksutils.getDirectories(importPath);
    if (self.vlocity.verbose) {
        console.log('\x1b[31m', 'Found import paths >>' ,'\x1b[0m', importPaths);
    }
    importPaths.forEach(function(dataPackType) {

        var dataPackTypeDir = importPath + '/' + dataPackType;

        var allDataPacksOfType = self.vlocity.datapacksutils.getDirectories(dataPackTypeDir);

        if (self.vlocity.verbose) {
            console.log('\x1b[31m', 'Found datapacks >>' ,'\x1b[0m', allDataPacksOfType);
        }

        if (allDataPacksOfType) {
            allDataPacksOfType.forEach(function(dataPackName) {

                var metadataFilename = dataPackTypeDir + '/' + dataPackName + '/' + self.getDataPackLabel(dataPackTypeDir, dataPackName) + '_DataPack.json';
               

                var dataPackKey = dataPackType + '/' + dataPackName;

                try {
                    if (metadataFilename && (!manifest || (manifest[dataPackType] && matchingFunction(dataPackType, dataPackName)))) {

                        if (self.vlocity.datapacksutils.fileExists(metadataFilename)) {
                            self.currentStatus[dataPackKey] = 'Ready';

                            self.loadFilesAtPath(dataPackTypeDir + '/' + dataPackName, jobInfo);
                            if (Array.isArray(self.pendingFromManifest[dataPackType])) {
                                var beforeCount = self.pendingFromManifest[dataPackType].length;
                                self.pendingFromManifest[dataPackType] = self.pendingFromManifest[dataPackType].filter(function(value) {
                                    return value.replace(/ /g, '-') !== dataPackName;
                                });
                            } else {
                                if (self.pendingFromManifest[dataPackType]) {
                                    self.pendingFromManifest[dataPackType].replace(dataPackName, '');
                                }
                            }
                        } else {
                            console.error('\x1b[31m', 'Missing metadata file for _DataPack.json >> ', '\x1b[0m',  dataPackKey);
                        }
                    }
                } catch (e) {
                    console.error('\x1b[31m', 'Error whilst processing >>' ,'\x1b[0m', dataPackKey, e);
                }
            });
        }
    });
    var hasMissingEntries = false;
    Object.keys(self.pendingFromManifest).forEach(function(key) {
        if (self.pendingFromManifest[key].length > 0) {
            hasMissingEntries = true;
        }
    });
    if (hasMissingEntries) {
        console.error("Unmatched but required files:\n" + stringify(self.pendingFromManifest, null, 2));
    }
};

DataPacksBuilder.prototype.getNextImport = function(importPath, dataPackKeys, singleFile) {
    var self = this;

    var nextImport;

    dataPackKeys.forEach(function(dataPackKey) {

        if (!nextImport) {

            if (self.currentStatus[dataPackKey] == 'Ready') {
                try {
                    var typeIndex = dataPackKey.indexOf('/');
                    var dataPackType = dataPackKey.substr(0, typeIndex);
                    var dataNameIndex = dataPackKey.lastIndexOf('/')+1;
                    var dataPackName = dataPackKey.substr(dataNameIndex);
                    var dataPackLabel = self.getDataPackLabel(importPath + '/' + dataPackType, dataPackName);

                    var fullPathToFiles = importPath + '/' + dataPackKey;
                    var parentData = self.allFileDataMap[ fullPathToFiles + '/' + dataPackLabel + '_ParentKeys.json'];
                    
                    var needsParents = false;

                    if (!singleFile && parentData) {
                        parentData = JSON.parse(parentData);

                        parentData.forEach(function(parentKey) {
                            if (self.currentStatus[parentKey] == 'Ready') {
                                needsParents = true;
                            }
                        });

                        if (needsParents) {
                            return;
                        }
                    }

                    nextImport = {
                        VlocityDataPackKey: dataPackKey,
                        VlocityDataPackType: dataPackType,
                        VlocityDataPackParents: parentData,
                        VlocityDataPackStatus: 'Success',
                        VlocityDataPackIsIncluded: true,
                        VlocityDataPackName: dataPackName,
                        VlocityDataPackData: {
                            VlocityDataPackKey: dataPackKey,
                            VlocityDataPackType: dataPackType,
                            VlocityDataPackIsIncluded: true
                        }
                    }

                    var dataPackDataMetadata = JSON.parse(self.allFileDataMap[fullPathToFiles + '/' + dataPackLabel + '_DataPack.json'])

                    var sobjectDataField = dataPackDataMetadata.VlocityRecordSObjectType;

                    // Always an Array in Actualy Data Model
                    var dataPackImportBuilt = self.buildFromFiles(dataPackDataMetadata, fullPathToFiles, dataPackType, sobjectDataField);

                    if (dataPackImportBuilt[0] != null && dataPackImportBuilt[0].VlocityDataPackType == 'SObject') {
                        sobjectDataField = dataPackImportBuilt[0].VlocityRecordSObjectType;
                    }

                    nextImport.VlocityDataPackData[sobjectDataField] = dataPackImportBuilt;

                    self.currentStatus[dataPackKey] = 'Added';
                } catch (e) {
                    console.log('\x1b[31m', 'Error Formatting Deploy >>' ,'\x1b[0m', dataPackKey, e);
                    throw e;
                }

            }
        }
    });

    return nextImport;
};

DataPacksBuilder.prototype.buildFromFiles = function(dataPackDataArray, fullPathToFiles, dataPackType, currentDataField) {
    var self = this;

    // The SObjectData in the DataPack is always stored in arrays
    if (!Array.isArray(dataPackDataArray)){
        dataPackDataArray = [ dataPackDataArray ];
    }

    var dataPackDef = self.dataPacksExpandedDefinition[dataPackType];

    if (dataPackDef[currentDataField]) {
        var dataFieldDef = dataPackDef[currentDataField];

        dataPackDataArray.forEach(function(dataPackData) {

            if (dataPackData.VlocityDataPackType) {
                dataPackData.VlocityDataPackIsIncluded = true;
            }

            Object.keys(dataPackData).forEach(function(field) {            
                if (dataFieldDef && dataFieldDef[field]) {

                    var fileNames = dataPackData[field];
 
                    var fileType = self.dataPacksExpandedDefinition[dataPackType][currentDataField][field];

                    if (fileType == 'object' && Array.isArray(fileNames)) {

                        var allDataPackFileData = [];

                        fileNames.forEach(function(fileInArray) {
                            var fileInArray = fullPathToFiles + "/" + fileInArray;

                            if (self.allFileDataMap[fileInArray]) {
                                 allDataPackFileData = allDataPackFileData.concat(self.buildFromFiles(JSON.parse(self.allFileDataMap[fileInArray]), fullPathToFiles, dataPackType, field));
                            } else {
                                console.log('\x1b[31m', 'File Does Not Exist >>' ,'\x1b[0m', fileInArray);
                            }
                        });

                        dataPackData[field] = allDataPackFileData;
                    } else {

                        var filename = fullPathToFiles + "/" + dataPackData[field];

                        if (self.allFileDataMap[filename]) {    

                            if (fileType == 'list' || fileType == 'object') {
                                dataPackData[field] = self.buildFromFiles(JSON.parse(self.allFileDataMap[filename]), fullPathToFiles, dataPackType, field);
                            } else {
                                if (self.compileOnBuild && self.dataPacksExpandedDefinition[dataPackType][currentDataField][field].CompiledField) {
                                    if (self.dataPacksExpandedDefinition[dataPackType][currentDataField][field].FileType == 'scss') {

                                        var includePathsForSass = [];

                                        self.vlocity.datapacksutils.getDirectories(fullPathToFiles + "/..").forEach(function(dir) {
                                            includePathsForSass.push(fullPathToFiles + "/../" + dir + "/");
                                        });

                                        var sassResult = sass.renderSync({
                                          data: self.allFileDataMap[filename],
                                          includePaths: includePathsForSass
                                        });

                                        dataPackData[self.dataPacksExpandedDefinition[dataPackType][currentDataField][field].CompiledField] = sassResult.css.toString();
                                        dataPackData[field] = self.allFileDataMap[filename];
                                    }
                                } else if (!self.compileOnBuild || !self.dataPacksExpandedDefinition[dataPackType][currentDataField].CompiledFields || 
                                   self.dataPacksExpandedDefinition[dataPackType][currentDataField].CompiledFields.indexOf(field) == -1) {
                                    dataPackData[field] = self.allFileDataMap[filename];
                                }
                            }
                        } 
                    } 
                }
            });

            if (dataFieldDef && dataFieldDef.JsonFields) {
                dataFieldDef.JsonFields.forEach(function(jsonField) { 
                    if (dataPackData[jsonField] != "") {
                        dataPackData[jsonField] = stringify(dataPackData[jsonField]);
                    }
                });
            }
        });
    }

    return dataPackDataArray;
};
