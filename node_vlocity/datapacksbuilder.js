var request = require('request');
var yaml = require('js-yaml');
var path = require('path');
var fs = require('fs-extra');
var sass = require('sass.js');
var stringify = require('json-stable-stringify');

var UTF8_EXTENSIONS = [ "css", "json", "yaml", "scss", "html", "js"];

var DataPacksBuilder = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};

    this.dataPacksExpandedDefinition = JSON.parse(fs.readFileSync(path.join(__dirname, "datapacksexpanddefinition.json"), 'utf8'));
    //this.defaultDataPack = JSON.parse(fs.readFileSync(path.join(__dirname, 'defaultdatapack.json'), 'utf8'));
    this.compileQueue = []; // array with files that require compilation
};

DataPacksBuilder.prototype.buildImport = function(importPath, manifest, jobInfo, onComplete) {
     var self = this;
    
    if (self.vlocity.verbose) {
		console.log('\x1b[31m', 'buildImport >>' ,'\x1b[0m', importPath, jobInfo.manifest, jobInfo);
	}
    
    var dataPackImport = JSON.parse(fs.readFileSync(path.join(__dirname, 'defaultdatapack.json'), 'utf8'));
    var maximumFileSize = jobInfo.maximumFileSize ? jobInfo.maximumFileSize : 200000;

    if (jobInfo.expansionPath) {
        importPath += '/' + jobInfo.expansionPath;
    }

    self.compileOnBuild = jobInfo.compileOnBuild;

   
    if (!self.allFileDataMap) {
        self.initializeImportStatus(importPath, manifest, jobInfo);
    }

    var nextImport;

    do {
        
        nextImport = self.getNextImport(importPath, Object.keys(jobInfo.currentStatus), jobInfo.singleFile === true, jobInfo);

        if (nextImport) {
            dataPackImport.dataPacks.push(nextImport);
        }
    } while (nextImport && (jobInfo.singleFile || stringify(dataPackImport).length < maximumFileSize))

    self.compileQueuedData(() => {
        onComplete(dataPackImport.dataPacks.length > 0 ? dataPackImport : null);
    });
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

    if (!jobInfo.currentStatus) {
        jobInfo.currentStatus = {};
    }

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

                            if (!jobInfo.currentStatus[dataPackKey]) {
                                jobInfo.currentStatus[dataPackKey] = 'Ready';
                            }

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

DataPacksBuilder.prototype.getNextImport = function(importPath, dataPackKeys, singleFile, jobInfo) {
    var self = this;
    var nextImport;

    dataPackKeys.forEach(function(dataPackKey) {
        if (!nextImport) {
            if (jobInfo.currentStatus[dataPackKey] == 'Ready') {
                try {
                    var typeIndex = dataPackKey.indexOf('/');
                    var dataPackType = dataPackKey.substr(0, typeIndex);
                    var dataNameIndex = dataPackKey.lastIndexOf('/')+1;
                    var dataPackName = dataPackKey.substr(dataNameIndex);
                    var dataPackLabel = self.getDataPackLabel(importPath + '/' + dataPackType, dataPackName);

                    var fullPathToFiles = importPath + '/' + dataPackKey;
                    var parentData = self.allFileDataMap[ fullPathToFiles + '/' + dataPackLabel + '_ParentKeys.json'];
                    
                    var needsParents = false;

                    if (parentData) {
                        parentData = JSON.parse(parentData);

                        if (!singleFile) {
                        parentData.forEach(function(parentKey) {
                                if (jobInfo.currentStatus[parentKey.replace(/\s+/g, "-")] == 'Ready') {
                                needsParents = true;
                            }
                        });

                        if (needsParents) {
                            return;
                        }
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

                    var dataPackDataMetadata = JSON.parse(self.allFileDataMap[fullPathToFiles + '/' + dataPackLabel + '_DataPack.json']);
                    var sobjectDataField = dataPackDataMetadata.VlocityRecordSObjectType;

                    // Always an Array in Actualy Data Model
                    var dataPackImportBuilt = self.buildFromFiles(dataPackDataMetadata, fullPathToFiles, dataPackType, sobjectDataField);

                    if (dataPackImportBuilt[0] != null && dataPackImportBuilt[0].VlocityDataPackType == 'SObject') {
                        sobjectDataField = dataPackImportBuilt[0].VlocityRecordSObjectType;
                    }

                    nextImport.VlocityDataPackData[sobjectDataField] = dataPackImportBuilt;
                    jobInfo.currentStatus[dataPackKey] = 'Added';
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
                    var fieldData = self.dataPacksExpandedDefinition[dataPackType][currentDataField][field];

                    if (fieldData == 'object' && Array.isArray(fileNames)) {

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

                            if (fieldData == 'list' || fieldData == 'object') {
                                dataPackData[field] = self.buildFromFiles(JSON.parse(self.allFileDataMap[filename]), fullPathToFiles, dataPackType, field);
                            } else {
                                if (self.compileOnBuild && fieldData.CompiledField) {                                    
                                    dataPackData[field] = self.allFileDataMap[filename];
                                    // Push job to compile qeueu; the data will be compiled after the import is completed
                                    self.compileQueue.push({
                                        filename: filename,
                                        status: null,
                                        language: fieldData.FileType,
                                        source: self.allFileDataMap[filename],
                                        callback: function(error, compiledResult) {
                                            if (error) {
                                                return console.log('\x1b[31m', 'Error while compiling SCSS in >>' ,'\x1b[0m', filename, '\n', error.message);
                                            }
                                            dataPackData[fieldData.CompiledField] = compiledResult;
                                        }
                                    });
                                } else if (!self.compileOnBuild || 
                                           !self.dataPacksExpandedDefinition[dataPackType][currentDataField].CompiledFields ||
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

DataPacksBuilder.prototype.compileQueuedData = function(onComplete) {
    var compilerBacklogSize = this.compileQueue.length;    
    if(compilerBacklogSize == 0) {
        return onComplete(null);
    }  

    var compileCount = 0;
    var compileErrors = 0;
    while (this.compileQueue.length > 0) {
        var job = this.compileQueue.pop();

        if (this.vlocity.verbose) {
            console.log('\x1b[31m', 'Start compilation of >>' ,'\x1b[0m', job.filename);
        }

        this.compile(job.language, job.source, job.options || {}, (error, compiledResult) => {
            if(error) {
                console.log('\x1b[31m', error.message, '>>' ,'\x1b[0m', '\n');
                job.callback(error, null);
                compileErrors++;
            } else {
                job.callback(null, compiledResult);
                compileCount++;
            }
            
            if(--compilerBacklogSize == 0) {
                if (this.vlocity.verbose) {
                    console.log('\x1b[31m', 'Compilation done >>' ,'\x1b[0m', 'Compiled', compileCount, 'files with', compileErrors, 'errors.');
                }
                onComplete(null);
            }
        });
    }
};

DataPacksBuilder.prototype.compile = function(lang, source, options, cb) {
    // This function contains the core code to execute compilation of source data
    // add addtional languages here to support more compilation types
    switch(lang) {
        case 'scss': {
            sass.compile(source, options, (result) => {
                if (result.status !== 0) {
                    var error = new Error('SASS compilatio error: ' + result.formatted);
                    cb(error, null);
                } else {
                    cb(null, result.text);
                }                
            });
        } return;
        default: {       
            cb(new Error('Unknown language: ' + lang), null);
        } return;
    }
};


