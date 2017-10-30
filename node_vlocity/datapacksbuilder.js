var request = require('request');
var yaml = require('js-yaml');
var path = require('path');
var fs = require('fs-extra');
var sass = require('sass.js');
var stringify = require('json-stable-stringify');

var UTF8_EXTENSIONS = [ "css", "json", "yaml", "scss", "html", "js"];

var DEFAULT_MAX_DEPLOY_COUNT = 50;

var DataPacksBuilder = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};

    this.compileQueue = []; // array with files that require compilation

    this.defaultdatapack = fs.readFileSync(path.join(__dirname, 'defaultdatapack.json'), 'utf8');
};

DataPacksBuilder.prototype.buildImport = function(importPath, manifest, jobInfo, onComplete) {
    var self = this;
    
    if (self.vlocity.verbose) {
        console.log('\x1b[31m', 'buildImport >>' ,'\x1b[0m', importPath, jobInfo.manifest, jobInfo);
    }

    var dataPackImport = JSON.parse(this.defaultdatapack);

    if (!self.vlocity.datapacksutils.fileExists(importPath)) {
        return onComplete(dataPackImport);
    }

    var maxImportSize = 200000;
    var maxImportCount = DEFAULT_MAX_DEPLOY_COUNT;

    if (jobInfo.resetFileData) {
        self.allFileDataMap = null;
        jobInfo.resetFileData = false;
    }

    if (jobInfo.maximumFileSize) {
        maxImportSize = jobInfo.maximumFileSize;
    }

    if (jobInfo.maximumDeployCount) {
        maxImportCount = jobInfo.maximumDeployCount;
    }

    if (jobInfo.headersOnly && !jobInfo.forceDeploy) {
        maxImportCount = 1;
    }

    if (jobInfo.expansionPath) {
        importPath += '/' + jobInfo.expansionPath;
    }

    self.compileOnBuild = jobInfo.compileOnBuild;

    if (!self.allFileDataMap) {
        self.initializeImportStatus(importPath, manifest, jobInfo);
    }

    var nextImport;

    var currentDataPackKeysInImport = {};

    do {
        nextImport = self.getNextImport(importPath, Object.keys(jobInfo.currentStatus), jobInfo.singleFile === true, jobInfo, currentDataPackKeysInImport);

        if (nextImport) {

           if (!jobInfo.singleFile && Object.keys(currentDataPackKeysInImport).length > 1 && stringify(nextImport).length > maxImportSize) {

                jobInfo.currentStatus[nextImport.VlocityDataPackKey] = 'Ready';
                break;
            } else {
                if (self.needsPagination(nextImport)) {
                    dataPackImport.dataPacks = dataPackImport.dataPacks.concat(self.paginateDataPack(nextImport, jobInfo));
                } else {
                    dataPackImport.dataPacks.push(nextImport);
                }

                currentDataPackKeysInImport[nextImport.VlocityDataPackKey] = true;
                
                if (!jobInfo.singleFile && (Object.keys(currentDataPackKeysInImport).length == self.vlocity.datapacksutils.getMaxDeploy(nextImport.VlocityDataPackType) || nextImport.shouldBreakImportLoop)) {

                    delete nextImport.shouldBreakImportLoop;
                    break;
                }
            }
        }
    } while (nextImport && (jobInfo.singleFile || (stringify(dataPackImport).length < maxImportSize && dataPackImport.dataPacks.length < maxImportCount)))

    self.compileQueuedData(result => {
        if(result.hasErrors) {            
            jobInfo.hasError = true;
            jobInfo.errorMessage = result.errors.join('\n');
        }
        onComplete(dataPackImport.dataPacks.length > 0 ? dataPackImport : null);
    });
};

DataPacksBuilder.prototype.needsPagination = function(dataPackData, jobInfo) {

    var paginationLimit = this.vlocity.datapacksutils.getPaginationSize(dataPackData.VlocityDataPackType);

    return this.countRecords(dataPackData) > paginationLimit;
};

DataPacksBuilder.prototype.paginateDataPack = function(dataPackData, jobInfo) {
    var self = this;
    var paginatedDataPacksFinal = [];

    var dataField = self.vlocity.datapacksutils.getDataField(dataPackData);

    var dataPackBase = JSON.parse(stringify(dataPackData));

    if (!dataPackBase.VlocityDataPackParents) {
        dataPackBase.VlocityDataPackParents = [];
    }

    // Remove all but top level Data
    Object.keys(dataPackBase.VlocityDataPackData[dataField][0]).forEach(function(keyField) {
        if (Array.isArray(dataPackBase.VlocityDataPackData[dataField][0][keyField])) {
            delete dataPackBase.VlocityDataPackData[dataField][0][keyField];
        }
    });

    dataPackBase = stringify(dataPackBase);

    var paginatedDataPack = JSON.parse(dataPackBase);
  
    var dataPackParent = dataPackData.VlocityDataPackData[dataField][0];

    var paginationLimit = this.vlocity.datapacksutils.getPaginationSize(dataPackData.VlocityDataPackType);
    var currentCount = 0;
    
    Object.keys(dataPackParent).forEach(function(keyField) {

        if (Array.isArray(dataPackParent[keyField])) {

            var recordsCounts = self.countRecords(dataPackParent[keyField]);

            if (recordsCounts > 0) {

                dataPackParent[keyField].forEach(function(childRecord) {
                    var thisRecordCount = self.countRecords(childRecord);

                    if (currentCount != 0 && (currentCount + thisRecordCount) > paginationLimit) {
                        var currentDataPackKey = paginatedDataPack.VlocityDataPackKey;

                        paginatedDataPacksFinal.push(paginatedDataPack);
                        paginatedDataPack = JSON.parse(dataPackBase);

                        paginatedDataPack.VlocityPreviousPageKey = currentDataPackKey;
                        paginatedDataPack.VlocityDataPackKey = paginatedDataPack.VlocityDataPackKey + '|Page|' + paginatedDataPacksFinal.length;
                        paginatedDataPack.VlocityDataPackRelationshipType = 'Pagination';

                        paginatedDataPack.VlocityDataPackData.VlocityPreviousPageKey = currentDataPackKey;
                        paginatedDataPack.VlocityDataPackData.VlocityDataPackKey = paginatedDataPack.VlocityDataPackKey;

                        paginatedDataPack.VlocityDataPackData.VlocityDataPackRelationshipType = 'Pagination';

                        console.log('\x1b[32m', 'Adding to ' + (jobInfo.singleFile ? 'File' : 'Deploy') + ' >>', '\x1b[0m', paginatedDataPack.VlocityDataPackKey + ' - ' + paginatedDataPack.VlocityDataPackLabel, '\x1b[31m', jobInfo.headersOnly ? 'Headers Only' : '', jobInfo.forceDeploy ? 'Force Deploy' : '', '\x1b[0m');
                       
                        currentCount = 0;
                    }

                    if (!paginatedDataPack.VlocityDataPackData[dataField][0][keyField]) {
                        paginatedDataPack.VlocityDataPackData[dataField][0][keyField] = [];
                    }
                   
                    paginatedDataPack.VlocityDataPackData[dataField][0][keyField].push(childRecord);

                    currentCount += thisRecordCount;
                });
            }
        }
    });

    if (currentCount != 0) {
        paginatedDataPacksFinal.push(paginatedDataPack);
    }

    return paginatedDataPacksFinal;
}

DataPacksBuilder.prototype.countRecords = function(dataPackData) {
    var self = this;

    var count = 0;

    if (dataPackData.VlocityDataPackData) {
        var dataPackType = dataPackData.VlocityDataPackType;

        var dataField = self.vlocity.datapacksutils.getDataField(dataPackData);

        if (dataField) {
            count += self.countRecords(dataPackData.VlocityDataPackData[dataField][0]);
        }
    } else { 
        if (Array.isArray(dataPackData)) {
            dataPackData.forEach(function(childData) {
                count += self.countRecords(childData);
            });
        } else if (dataPackData.VlocityDataPackType == 'SObject') {

            Object.keys(dataPackData).forEach(function(key) {
                count += self.countRecords(dataPackData[key]);
            });
            count++;
        }
    }

    return count;
};

DataPacksBuilder.prototype.getFileData = function(filePath) {

    return this.allFileDataMap[path.normalize(filePath)];
}

DataPacksBuilder.prototype.setFileData = function(filePath, data) {

    if (!this.allFileDataMap) {
        this.allFileDataMap = {};
    }
    this.allFileDataMap[path.normalize(filePath)] = data;
}

DataPacksBuilder.prototype.loadFilesAtPath = function(srcpath, jobInfo, dataPackKey) {
    var self = this;

    self.vlocity.datapacksutils.getFiles(srcpath).forEach(function(filename) {

        var encoding = 'base64';

        var extension = filename.substr(filename.lastIndexOf('.')+1);

        if (UTF8_EXTENSIONS.indexOf(extension) > -1) {
            encoding = 'utf8';
        }

        var filemapkey = (srcpath + '/' + filename).toLowerCase();
        self.setFileData(filemapkey, fs.readFileSync(srcpath + '/' + filename, encoding));
    });
};

DataPacksBuilder.prototype.getDataPackLabel = function(dataPackTypeDir, dataPackName) {
    try {
            var allFiles = this.vlocity.datapacksutils.getFiles(dataPackTypeDir + '/' + dataPackName);
        for (var i = 0; i < allFiles.length; i++) {
            if (allFiles[i].indexOf('_DataPack.json') != -1) {
               return allFiles[i].substr(0, allFiles[i].indexOf('_DataPack.json'));
            }
        }
    } catch (e) {
        // Means file deleted
    }

    return null;
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

    if (manifest) {
        self.pendingFromManifest = JSON.parse(stringify(manifest));
    } else {
        self.pendingFromManifest = {};
    }

    if (!self.vlocity.datapacksutils.fileExists(importPath)) {
         console.log('\x1b[32m', 'No Data At Path >>' ,'\x1b[0m', importPath);
        return;
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

                            self.loadFilesAtPath(dataPackTypeDir + '/' + dataPackName, jobInfo, dataPackKey);

                            var sobjectData = JSON.parse(self.getFileData(metadataFilename.toLowerCase()));
                           
                            var generatedDataPackKey = dataPackType + '/' + self.vlocity.datapacksexpand.getDataPackFolder(dataPackType, sobjectData.VlocityRecordSObjectType, sobjectData);

                            if (!jobInfo.currentStatus[generatedDataPackKey]) {
                                jobInfo.currentStatus[generatedDataPackKey] = 'Ready';
                            }

                            if (jobInfo.allParents.indexOf(generatedDataPackKey) == -1) {
                                jobInfo.allParents.push(generatedDataPackKey);
                            }

                            var apexImportData = {};

                            self.vlocity.datapacksutils.getApexImportDataKeys(sobjectData.VlocityRecordSObjectType).forEach(function(field) {
                                apexImportData[field] = sobjectData[field];
                            });

                            if (jobInfo.preDeployDataSummary == null) {
                                jobInfo.preDeployDataSummary = [];
                            }

                            if (jobInfo.allDeployDataSummary == null) {
                                jobInfo.allDeployDataSummary = {};
                            }

                            jobInfo.preDeployDataSummary.push(apexImportData);

                            jobInfo.allDeployDataSummary[generatedDataPackKey] = apexImportData;

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
                    console.error('\x1b[31m', 'Error whilst processing >>' ,'\x1b[0m', dataPackKey, e.stack);
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

DataPacksBuilder.prototype.getNextImport = function(importPath, dataPackKeys, singleFile, jobInfo, currentDataPackKeysInImport) {
    var self = this;

    for (var i = 0; i < dataPackKeys.length; i++) {
        
        var dataPackKey = dataPackKeys[i];


        if (jobInfo.currentStatus[dataPackKey] == 'Ready' || (jobInfo.currentStatus[dataPackKey] == 'ReadySeparate' && Object.keys(currentDataPackKeysInImport).length == 0) || (jobInfo.currentStatus[dataPackKey] == 'Header' && !jobInfo.headersOnly)) {
            try {

                var typeIndex = dataPackKey.indexOf('/');
                var dataPackType = dataPackKey.substr(0, typeIndex);
                var dataNameIndex = dataPackKey.lastIndexOf('/')+1;
                var dataPackName = dataPackKey.substr(dataNameIndex);
                var dataPackLabel = self.getDataPackLabel(importPath + '/' + dataPackType, self.vlocity.datapacksexpand.sanitizeDataPackKey(dataPackName));

                var fullPathToFiles = path.join(importPath, dataPackType, self.vlocity.datapacksexpand.sanitizeDataPackKey(dataPackName));
                var parentData;

                var maxDeployCountForType = DEFAULT_MAX_DEPLOY_COUNT;

                if (jobInfo.maximumDeployCount) {
                    maxImportCount = jobInfo.maximumDeployCount;
                }

                if (self.vlocity.datapacksutils.getMaxDeploy(dataPackType)) {
                    maxDeployCountForType = self.vlocity.datapacksutils.getMaxDeploy(dataPackType);
                }

                if (dataPackType.indexOf('SObject_') == 0) {
                    dataPackType = 'SObject';
                }

                if (!jobInfo.singleFile) {
                    if (Object.keys(currentDataPackKeysInImport).length >= maxDeployCountForType) {
                        continue;
                    }

                    if (jobInfo.supportParallel && !self.vlocity.datapacksutils.isAllowParallel(dataPackType)) {
                        continue;
                    }
                }

                if (!dataPackLabel) {
                    delete jobInfo.currentStatus[dataPackKey];
                    continue;
                }

                if (jobInfo.defaultMaxParallel > 1 && !jobInfo.supportParallel && self.vlocity.datapacksutils.isAllowParallel(dataPackType)) {
                    jobInfo.supportParallelAgain = true;
                }

                var headersType = self.vlocity.datapacksutils.getHeadersOnly(dataPackType);

                // Headers only accounts for potential circular references by only uploading the parent record
                if (!jobInfo.headersOnly && !jobInfo.forceDeploy) {
                   parentData = self.getFileData((fullPathToFiles + '/' + dataPackLabel + '_ParentKeys.json').toLowerCase());
                } else if (!headersType && !jobInfo.forceDeploy) {
                    continue;
                }

                if (jobInfo.forceDeploy && jobInfo.ignoreAllParents) {
                    parentData = null;
                }

                var needsParents = false; 

                if (parentData) {

                    parentData = JSON.parse(parentData);

                    if (!singleFile) {
                        parentData.forEach(function(parentKey) {

                            if (self.vlocity.datapacksutils.isGuaranteedParentKey(parentKey)) {
                                return;
                            }

                            var slashIndex = parentKey.indexOf('/');
                            var beforeSlash = parentKey.substring(0, slashIndex);
                            var afterSlash = parentKey.substring(slashIndex+1);

                            var parentKeyForStatus = beforeSlash + '/' + self.vlocity.datapacksexpand.generateFolderOrFilename(afterSlash);

                            if (jobInfo.currentStatus[parentKeyForStatus] != null 
                                && !(jobInfo.currentStatus[parentKeyForStatus] == 'Success' 
                                    || jobInfo.currentStatus[parentKeyForStatus] == 'Header') 
                                && currentDataPackKeysInImport[parentKeyForStatus] != true) {

                                needsParents = true;
                            }
                        });

                        if (needsParents) {
                            continue;
                        }
                    }
                }

                var nextImport = {
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
                    },
                    VlocityDataPackRelationshipType: 'Primary'
                }

                if (jobInfo.currentStatus[dataPackKey] == 'ReadySeparate') {
                    nextImport.shouldBreakImportLoop = true;
                }

                var dataPackDataMetadata = JSON.parse(self.getFileData((fullPathToFiles + '/' + dataPackLabel + '_DataPack.json').toLowerCase()));

                var sobjectDataField = dataPackDataMetadata.VlocityRecordSObjectType;

                // Always an Array in Actualy Data Model
                var dataPackImportBuilt = self.buildFromFiles(dataPackDataMetadata, fullPathToFiles, dataPackType, sobjectDataField);

                if (dataPackImportBuilt[0] != null && dataPackImportBuilt[0].VlocityDataPackType.indexOf('SObject_') == 0) {
                    sobjectDataField = dataPackImportBuilt[0].VlocityRecordSObjectType;
                    dataPackImportBuilt[0].VlocityDataPackType = 'SObject';
                    dataPackImportBuilt.VlocityDataPackType = 'SObject';
                }

                if (jobInfo.headersOnly && headersType != "All") {
                    Object.keys(dataPackImportBuilt[0]).forEach(function(key) {
                        if (Array.isArray(dataPackImportBuilt[0][key])) {
                            dataPackImportBuilt[0][key] = [];
                        }
                    });
                }

                nextImport.VlocityDataPackData[sobjectDataField] = dataPackImportBuilt;

                if (jobInfo.headersOnly) {

                    if (headersType == "Identical") {
                        jobInfo.currentStatus[dataPackKey] = 'Added';
                    }
                    else {
                        jobInfo.currentStatus[dataPackKey] = 'Header';
                    }
                } else {
                    jobInfo.currentStatus[dataPackKey] = 'Added';
                }

                if (!jobInfo.noStatus) {
                    console.log('\x1b[32m', 'Adding to ' + (jobInfo.singleFile ? 'File' : 'Deploy') + ' >>', '\x1b[0m', nextImport.VlocityDataPackKey + ' - ' + dataPackLabel, '\x1b[31m', jobInfo.headersOnly ? 'Headers Only' : '', jobInfo.forceDeploy ? 'Force Deploy' : '', '\x1b[0m');
                }
                
                return nextImport;
            } catch (e) {
                console.log('\x1b[31m', 'Error Formatting Deploy >>','\x1b[0m', dataPackKey, e.stack);
                throw e;
            }
        }
    }

    return null;
};

DataPacksBuilder.prototype.buildFromFiles = function(dataPackDataArray, fullPathToFiles, dataPackType, currentDataField) {
    var self = this;

    // The SObjectData in the DataPack is always stored in arrays
    if (!Array.isArray(dataPackDataArray)){
        dataPackDataArray = [ dataPackDataArray ];
    }

    dataPackDataArray.forEach(function(dataPackData) {

        if (dataPackData.VlocityDataPackType) {
            dataPackData.VlocityDataPackIsIncluded = true;

            // Allow removing and injecting Vlocity Record Source keys to 
            // keep any unhelpful data out of the saved files
            if (!dataPackData.VlocityRecordSourceKey 
                && !dataPackData.VlocityMatchingRecordSourceKey 
                && !dataPackData.VlocityLookupRecordSourceKey) {
                dataPackData.VlocityRecordSourceKey = self.vlocity.datapacksexpand.generateSourceKey(dataPackData);
            }
        }

        Object.keys(dataPackData).forEach(function(field) {            
            
            var potentialFileNames = dataPackData[field];

            if (field != 'Name') {

                // Check on This idea
                if (Array.isArray(potentialFileNames) 
                    && potentialFileNames.length > 0
                    && typeof potentialFileNames[0] === 'string' ) 
                {
                    var allDataPackFileData = [];

                    potentialFileNames.forEach(function(fileInArray) {
                        var fileInArray = (fullPathToFiles + "/" + fileInArray).toLowerCase();

                        if (self.getFileData(fileInArray)) {
                             allDataPackFileData = allDataPackFileData.concat(self.buildFromFiles(JSON.parse(self.getFileData(fileInArray)), fullPathToFiles, dataPackType, field));
                        } else {
                            console.log('\x1b[31m', 'File Does Not Exist >>' ,'\x1b[0m', fileInArray);
                        }
                    });

                    if (allDataPackFileData.length > 0) {
                        dataPackData[field] = allDataPackFileData;
                    }
                } else if (typeof potentialFileNames === 'string') {
                    var filename = fullPathToFiles + "/" + potentialFileNames;
                    var fileType = self.vlocity.datapacksutils.getExpandedDefinition(dataPackType, currentDataField, field);

                    var fileData = self.getFileData(filename.toLowerCase());

                    if (fileData) {
                        var fileDataJSON;

                        try {
                            fileDataJSON = JSON.parse(fileData);
                        } catch (e) {
                            // expected often
                        }

                        if (fileDataJSON && ((fileDataJSON[0] && fileDataJSON[0].VlocityRecordSObjectType) || fileDataJSON.VlocityRecordSObjectType)) {

                            dataPackData[field] = self.buildFromFiles(fileDataJSON, fullPathToFiles, dataPackType, field);
                        } else {
                            if (self.compileOnBuild && fileType.CompiledField) { 

                                // these options will be passed to the importer function 
                                var importerOptions = {
                                    // collect paths to look for imported/included files
                                    includePaths: self.vlocity.datapacksutils.getDirectories(fullPathToFiles + "/..").map(function(dir) {
                                        return path.normalize(fullPathToFiles + "/../" + dir + "/");
                                    })
                                };
                                // Push job to compile qeueu; the data will be compiled after the import is completed
                                self.compileQueue.push({
                                    filename: filename,
                                    status: null,
                                    language: fileType.FileType,
                                    source: fileData,
                                    options: {
                                        // this is options that is passed to the compiler
                                        importer: importerOptions
                                    },
                                    callback: function(error, compiledResult) {
                                        if (error) {
                                            return console.log('\x1b[31m', 'Failed to compile SCSS for >>' ,'\x1b[0m', filename, '\n', error.message);
                                        }
                                        dataPackData[fileType.CompiledField] = compiledResult;
                                    }
                                });
                                // save source into datapack to ensure the uncompiled data also gets deployed
                                dataPackData[field] = fileData;
                            } else if (!self.compileOnBuild || !self.vlocity.datapacksutils.isCompiledField(dataPackType, currentDataField, field)) {

                                if (fileDataJSON) {
                                    dataPackData[field] = stringify(fileDataJSON);
                                } else {
                                    dataPackData[field] = fileData;
                                }
                            }
                        }
                    } 
                } 
            }
            
            var jsonFields = self.vlocity.datapacksutils.getJsonFields(dataPackType, currentDataField);

            if (jsonFields) {
                jsonFields.forEach(function(jsonField) { 
                    if (dataPackData[jsonField]) {
                        if (typeof dataPackData[jsonField] === 'object') {
                            dataPackData[jsonField] = stringify(dataPackData[jsonField]);
                        } else {
                            try {
                                // Remove extra line endings if there 
                                dataPackData[jsonField] = stringify(JSON.parse(dataPackData[jsonField]));
                            } catch (e) {
                                // Can ignore
                            }
                        }
                    }
                    
                });
            }
        });
    });
    
    return dataPackDataArray;
};

DataPacksBuilder.prototype.compileQueuedData = function(onComplete) {    
    // locals we will use to track the progress
    var compileCount = 0;
    var errors = [];
    
    // Sass.js compiler is a bit funcky and the callbacks
    // are not garantueed to be called in the correct order
    // this causes issue and therefor we do not want to compile files in parallel 
    // this compileNext function takes care of that by calling itself recusrively
    var compileNext = (job) => {
        if (!job) {
            if (this.vlocity.verbose && (compileCount > 0 || errors.length > 0)) {
                console.log('\x1b[31m', 'Compilation done >>' ,'\x1b[0m', 'compiled', compileCount, 'files with', errors.length, 'errors.');
            }
            return onComplete({ 
                compileCount: compileCount,
                hasErrors: errors.length > 0, 
                errors: errors
            });
        }

        if (this.vlocity.verbose) {
            console.log('\x1b[31m', 'Start compilation of >>' ,'\x1b[0m', job.filename);
        }

        this.compile(job.language, job.source, job.options || {}, (error, compiledResult) => {
            if(error) {
                console.log('\x1b[31m', error.message, '>>' ,'\x1b[0m', '\n');
                job.callback(error, null);
                errors.push(error);
            } else {
                job.callback(null, compiledResult);
                compileCount++;
            }
            compileNext(this.compileQueue.pop());
        });
    };

    // kick it off!
    compileNext(this.compileQueue.pop());
};


/** 
 * recusive async function that loops through a list of paths trying to read a file and returns the data 
 * of that file if it is succesfull
 * @param {string} filename - name of the file to search for
 * @param {string[]} pathArray - Array of paths to search in
 * @param {callback} cb - callback(err, fileData)
 */
DataPacksBuilder.prototype.tryReadFile = function(fileName, pathArray, cb, i) {
    if ((i = i || 0) >= pathArray.length) return cb(new Error("Requested file not found: " + fileName), null);
    fs.readFile(path.join(pathArray[i], fileName), 'UTF8', (err, data) => {
        if (!err) return cb(null, data);                                    
        this.tryReadFile(fileName, pathArray, cb, ++i);
    });
};

DataPacksBuilder.prototype.compile = function(lang, source, options, cb) {
    // This function contains the core code to execute compilation of source data
    // add addtional languages here to support more compilation types    
    switch(lang) {
        case 'scss': {
            // intercept file loading requests from libsass
            sass.importer((request, done) => {
                // (object) request
                // (string) request.current path libsass wants to load (content of »@import "<path>";«)
                // (string) request.previous absolute path of previously imported file ("stdin" if first)
                // (string) request.resolved currentPath resolved against previousPath
                // (string) request.path absolute path in file system, null if not found
                // (mixed)  request.options the value of options.importer
                // -------------------------------
                // (object) result
                // (string) result.path the absolute path to load from file system
                // (string) result.content the content to use instead of loading a file
                // (string) result.error the error message to print and abort the compilation
                if (!request.path) {
                    // do we have include paths -- if so start probing them
                    if (request.options && request.options.includePaths && 
                        Array.isArray(request.options.includePaths)) {
                        return this.tryReadFile(request.current + '.scss', request.options.includePaths, (err, data) => {
                            if(err) return done({ error: err });
                            done({ content: data });
                        });
                    }
                }                
                // return error
                done({ error: "Unable to resolve requested SASS import; try setting the 'includePaths'" +
                              "compiler option if your import is not in the root directory." });
            });
            sass.compile(source, options, (result) => {
                if (result.status !== 0) {
                    var error = new Error('SASS compilation failed, see error message for details: ' + result.formatted);
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


