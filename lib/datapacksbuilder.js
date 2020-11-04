var yaml = require('js-yaml');
var path = require('path');
var fs = require('fs-extra');
var sass = require('sass.js');
var stringify = require('fast-json-stable-stringify');

var UTF8_EXTENSIONS = [ "css", "json", "yaml", "scss", "html", "js", "xml"];

var DEFAULT_MAX_DEPLOY_COUNT = 5;
var DEFAULT_MAX_IMPORT_SIZE = 2000000;

var DataPacksBuilder = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};

    this.compileQueue = []; // array with files that require compilation

    this.defaultdatapack = fs.readFileSync(path.join(__dirname, 'defaultdatapack.json'), 'utf8');

    this.dataPackSizes = {};

    this.needsPaginationForKey = {};

    this.savedBulkRecords = {};

    this.parentData = {};
};

DataPacksBuilder.prototype.hasValidImports = async function(importPath, jobInfo) {

    VlocityUtils.verbose('Checking Valid Imports Start');
    VlocityUtils.silent = true;

    var jobInfoStatusHash = this.vlocity.datapacksutils.hashCode(stringify(jobInfo.currentStatus) + jobInfo.headersOnly + ' ' + jobInfo.forceDeploy);

    if (jobInfo.hasValidImportsCached && jobInfo.hasValidImportsCached[jobInfoStatusHash]) {
        return jobInfo.hasValidImportsCached[jobInfoStatusHash];
    }

    jobInfo.hasValidImportsCached = {};

    var dataPackImport = await this.buildImport(importPath, jobInfo, true);
    VlocityUtils.silent = false; 

    if (dataPackImport && dataPackImport.dataPacks && dataPackImport.dataPacks.length > 0) {
        VlocityUtils.verbose('Checking Valid Imports Found', dataPackImport.dataPacks.length);
        for (var pack of dataPackImport.dataPacks) {
            if (jobInfo.currentStatus[pack.VlocityDataPackKey] == 'Added') {
                jobInfo.currentStatus[pack.VlocityDataPackKey] = 'Ready';
            } else if (jobInfo.currentStatus[pack.VlocityDataPackKey] == 'AddedHeader') {
                jobInfo.currentStatus[pack.VlocityDataPackKey] = 'Ready';
            }
        }

        jobInfo.hasValidImportsCached[this.vlocity.datapacksutils.hashCode(stringify(jobInfo.currentStatus))] = true;

        return true;
    }

    return false;
}

DataPacksBuilder.prototype.buildImport = async function(importPath, jobInfo, validateOnly) {
    var self = this;
    var bulkRecords = [];

    if (!self.vlocity.datapacksutils.fileExists(importPath)) {
        return null;
    }

    var dataPackImport = JSON.parse(this.defaultdatapack);

    self.maxImportSize = DEFAULT_MAX_IMPORT_SIZE;
    var maxImportCount = DEFAULT_MAX_DEPLOY_COUNT;

    if (jobInfo.resetFileData) {
        self.allFileDataMap = null;
        jobInfo.resetFileData = false;
    }

    if (jobInfo.maximumFileSize) {
        self.maxImportSize = jobInfo.maximumFileSize;
    }

    if (jobInfo.maximumDeployCount) {
        maxImportCount = jobInfo.maximumDeployCount;
    }

    if (jobInfo.headersOnly && !jobInfo.forceDeploy) {
        maxImportCount = 1;
    }

    if (jobInfo.expansionPath) {
        importPath = path.join(importPath, jobInfo.expansionPath);
    }

    self.compileOnBuild = jobInfo.compileOnBuild;

    if (jobInfo.jobAction == 'Deploy' && jobInfo.removeInvalidMatchingKeyFields) {
        this.matchingKeyFields = await this.vlocity.utilityservice.getDRMatchingKeyFields();
    }

    if (!self.allFileDataMap) {
        self.allFileDataMap = {};
        self.initializingFileMap = true;
        await self.initializeImportStatus(importPath, jobInfo);
        self.initializingFileMap = false;
    }

    if (jobInfo.sourceKeyToMatchingKeysData && Object.keys(jobInfo.sourceKeyToMatchingKeysData).length === 0){
        Object.keys(self.allFileDataMap).forEach((filePath) => {

            try {
                if (filePath.indexOf('datapack.json') !== -1) {
                    let eachFileDataJSON = JSON.parse(self.allFileDataMap[filePath]);
                    jobInfo.sourceKeyToMatchingKeysData[eachFileDataJSON.VlocityRecordSourceKey] = eachFileDataJSON;
                }
            } catch (e) {
                VlocityUtils.error('Error Parsing JSON', e);
            }
        });
    }

    while (self.initializingFileMap) {
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    var jobInfoStatusHash = this.vlocity.datapacksutils.hashCode(stringify(jobInfo.currentStatus));

    if (jobInfo.buildImportCachedAlreadyNull === jobInfoStatusHash) {
        return null;
    }
    
    jobInfo.buildImportCachedAlreadyNull = null;

    var nextImport;

    var currentDataPackKeysInImport = {};

    var dataPackImportLength = JSON.stringify(dataPackImport).length;

    var shouldBreakImportLoop = false;

    do {
        nextImports = self.getNextImports(importPath, jobInfo, currentDataPackKeysInImport, !jobInfo.singleFile ? dataPackImportLength : 0, validateOnly);

        if (validateOnly && nextImports.length > 0) {
            dataPackImport.dataPacks = nextImports;
            return dataPackImport;
        }

        for (var nextImport of (nextImports || [])) {

            if (!shouldBreakImportLoop) {

                dataPackImportLength += JSON.stringify(nextImport).length;
                
                if (!jobInfo.singleFile && self.needsPagination(nextImport, jobInfo)) {

                    try {
                        bulkRecords = await self.vlocity.datapacksutils.handleDataPackEvent('extractAllBulkRecords', nextImport.VlocityDataPackType, { dataPackData: nextImport });
                    } catch (e) {
                        jobInfo.currentStatus[nextImport.VlocityDataPackKey] = 'Error';
                        VlocityUtils.error('Error', nextImport.VlocityDataPackKey, e);
                        continue;
                    }

                    if (bulkRecords) {
                        var dataPackKey = JSON.stringify(nextImport.VlocityDataPackKey)

                        if (!self.savedBulkRecords[dataPackKey]) {
                            self.savedBulkRecords[dataPackKey] = {};
                        }

                        self.savedBulkRecords[dataPackKey] = JSON.parse(JSON.stringify(bulkRecords));
                        dataPackImport.dataPacks.push(nextImport);
                    } else {
                        var paginated = self.paginateDataPack(nextImport, jobInfo);

                        if (paginated.length == 0) {
                            paginated = [ nextImport ];
                        }

                        dataPackImport.dataPacks = dataPackImport.dataPacks.concat(paginated);

                        shouldBreakImportLoop = true;
                    }
                } else {
                    dataPackImport.dataPacks.push(nextImport);
                }

                currentDataPackKeysInImport[nextImport.VlocityDataPackKey] = true;
                
                if (!jobInfo.singleFile && (dataPackImport.dataPacks.length == self.vlocity.datapacksutils.getMaxDeploy(nextImport.VlocityDataPackType) || shouldBreakImportLoop)) {
                    shouldBreakImportLoop = true;
                }
            } else {
                jobInfo.currentStatus[nextImport.VlocityDataPackKey] = 'Ready';
            }
        }
    } while (nextImports && nextImports.length != 0 && (jobInfo.singleFile || (dataPackImportLength < self.maxImportSize && dataPackImport.dataPacks.length < maxImportCount)) && !shouldBreakImportLoop);

    if (dataPackImport.dataPacks.length > 0) {
        VlocityUtils.success(jobInfo.jobAction, dataPackImport.dataPacks.length, 'Items');

        if (jobInfo.compileOnBuild) {

            let result = await self.compileQueuedData();

            if (result.hasCompileError && !jobInfo.singleFile) {            
                jobInfo.hasError = true;

                result.errors.forEach(function(error) {
                    VlocityUtils.error('SASS Compilation Error', error.VlocityDataPackKey, error.message);
                    jobInfo.errors.push('SASS Compilation Error ' + error.VlocityDataPackKey + ' ' + error.message);

                    VlocityUtils.warn('Removing From Deploy', error.VlocityDataPackKey);

                    jobInfo.currentStatus[error.VlocityDataPackKey] = 'Error';
                    jobInfo.currentErrors[error.VlocityDataPackKey] = 'SASS Compilation Error ' + error.message;
                });

                dataPackImport.dataPacks.forEach(function(dataPack) {
                    if (jobInfo.currentStatus[dataPack.VlocityDataPackKey] != 'Error') {
                        VlocityUtils.warn('Setting Back to Ready', dataPack.VlocityDataPackKey);
                        jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Ready';
                    }
                });

                return null;
            }
        } 

        if (jobInfo.upgradeDataPackFields) {
            jobInfo.platformObjectMappings = this.vlocity.datapacksutils.updateExpandedDefinitionNamespace(
                yaml.safeLoad(fs.readFileSync(
                    path.join(__dirname, 'platformObjectMappings.yaml'),
                    'utf8'
                ))
            );
            dataPackImport.dataPacks.forEach(dataPack => {
                if (Object.keys(jobInfo.platformObjectMappings).includes(dataPack.VlocityDataPackType)) {
                    this.vlocity.datapacksutils.updateDataPackWithNewMappings(dataPack, jobInfo);
                }
            });
        }
        
        return dataPackImport;
        
    } else {
        jobInfo.buildImportCachedAlreadyNull = this.vlocity.datapacksutils.hashCode(stringify(jobInfo.currentStatus));

        return null;
    }
};

DataPacksBuilder.prototype.needsPagination = function(dataPackData, jobInfo) {

    dataPackData.recordsCount =  this.countRecords(dataPackData);

    if (!this.needsPaginationForKey[dataPackData.VlocityDataPackKey]) {
        var paginationLimit = this.vlocity.datapacksutils.getPaginationSize(dataPackData.VlocityDataPackType);
        this.needsPaginationForKey[dataPackData.VlocityDataPackKey] = !jobInfo.disablePagination && dataPackData.recordsCount > paginationLimit;
    }

    return this.needsPaginationForKey[dataPackData.VlocityDataPackKey];
};

DataPacksBuilder.prototype.paginateDataPack = function(dataPackData, jobInfo) {
    var self = this;
    var paginatedDataPacksFinal = [];

    var dataField = self.vlocity.datapacksutils.getDataField(dataPackData);

    var dataPackBase = JSON.parse(JSON.stringify(dataPackData));

    if (!dataPackBase.VlocityDataPackParents) {
        dataPackBase.VlocityDataPackParents = [];
    }

    var paginatedDataPack = JSON.parse(JSON.stringify(dataPackBase));
  
    var currentSObject = paginatedDataPack.VlocityDataPackData[dataField][0];
    
    self.paginateItem(paginatedDataPack, currentSObject, paginatedDataPacksFinal, jobInfo);

    return paginatedDataPacksFinal;
}

DataPacksBuilder.prototype.paginateItem = function(paginatedDataPack, currentSObject, paginatedDataPacksFinal, jobInfo) {
    var self = this;

    var paginationActions = self.vlocity.datapacksutils.getPaginationActions(paginatedDataPack.VlocityDataPackType);

    var paginationLimit = this.vlocity.datapacksutils.getPaginationSize(paginatedDataPack.VlocityDataPackType);

    Object.keys(currentSObject).forEach(function(keyField) {
        
        if (Array.isArray(currentSObject[keyField])) {
          
            var recordsCounts = self.countRecords(currentSObject[keyField]);

            if (recordsCounts > 0) {
                if (currentSObject[keyField].length > 0 && currentSObject[keyField].length < paginationLimit) {
                    self.paginateItem(paginatedDataPack, currentSObject[keyField][0], paginatedDataPacksFinal, jobInfo);
                } else {
                    var arrayOfPaginated = [];

                    if (paginationActions 
                        && paginationActions[keyField] 
                        && paginationActions[keyField].indexOf('RemoveFromInitial') != -1) {
                        arrayOfPaginated.push([]);
                    }

                    for (var i = 0; i < currentSObject[keyField].length; i += paginationLimit) {
                        var pageChunk = currentSObject[keyField].slice(i, i + paginationLimit);
                        arrayOfPaginated.push(pageChunk);
                    }
                
                    for (var i = 0; i < arrayOfPaginated.length; i++) {
                       
                        currentSObject[keyField] = arrayOfPaginated[i];

                        var addingPaginatedDataPack = JSON.parse(JSON.stringify(paginatedDataPack));

                        if (i > 0 && paginationActions) {
                            Object.keys(paginationActions).forEach(function(field) {
                                var actions = paginationActions[field];
                                if (actions) {
                                    if (actions.indexOf('Remove') != -1 && keyField != field) {
                                        var dataField = self.vlocity.datapacksutils.getDataField(paginatedDataPack);

                                        if (addingPaginatedDataPack.VlocityDataPackData[dataField][0][field]) {
                                            delete addingPaginatedDataPack.VlocityDataPackData[dataField][0][field];
                                        }
                                    } else if (actions.indexOf('AddLookupRelationships') != -1) {
                                        self.addLookupRelationships(addingPaginatedDataPack, field);
                                    }
                                }
                            });
                        }

                        if (i > 0) {

                            addingPaginatedDataPack.VlocityPreviousPageKey = i == 1 ? paginatedDataPack.VlocityDataPackKey : paginatedDataPack.VlocityDataPackKey + '|Page|' + (i-1);
                            addingPaginatedDataPack.VlocityDataPackKey = paginatedDataPack.VlocityDataPackKey + '|Page|' + i;
                            addingPaginatedDataPack.VlocityDataPackRelationshipType = 'Pagination';
                        
                            addingPaginatedDataPack.VlocityDataPackData.VlocityPreviousPageKey = addingPaginatedDataPack.VlocityPreviousPageKey;
                            addingPaginatedDataPack.VlocityDataPackData.VlocityDataPackKey = addingPaginatedDataPack.VlocityDataPackKey;
                            addingPaginatedDataPack.VlocityDataPackData.VlocityDataPackRelationshipType = 'Pagination';
                        }

                        VlocityUtils.verbose('Paginating', addingPaginatedDataPack.VlocityDataPackKey);
                    
                        paginatedDataPacksFinal.push(addingPaginatedDataPack);
                    }
                }
            }
        }
    });
}

DataPacksBuilder.prototype.countRecords = function(dataPackData) {
    var self = this;

    var count = 0;
    if (dataPackData) {
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
    }

    return count;
};

DataPacksBuilder.prototype.addLookupRelationships = function(paginatedDataPack, field) {
    var self = this;

    var dataField = self.vlocity.datapacksutils.getDataField(paginatedDataPack);

    if (paginatedDataPack.VlocityDataPackData[dataField][0][field]) { 
        paginatedDataPack.VlocityDataPackData[dataField][0][field].forEach(function(item) {

            Object.keys(item).forEach(function(field) {
                var fieldValue = item[field];

                if (typeof fieldValue === 'object' && fieldValue.VlocityDataPackType == 'VlocityMatchingKeyObject') {
                    fieldValue.VlocityDataPackType = 'VlocityLookupMatchingKeyObject';
                }
            });
        });
    }
};

DataPacksBuilder.prototype.getFileData = function() {
    // vari args functions
    var pathString = arguments.length > 1 ? path.join.apply(this, arguments) : arguments[0];
    return this.allFileDataMap[path.normalize(pathString).toLowerCase()];
}

DataPacksBuilder.prototype.setFileData = async function(filePath, encoding) {
    var data = await fs.readFile(filePath, encoding);

    if (!this.allFileDataMap) {
        this.allFileDataMap = {};
    }

    this.allFileDataMap[path.normalize(filePath).toLowerCase()] = data;

    try {
        var dataPack = JSON.parse(data);

        if (dataPack) {
            if (!this.recordSourceKeyToFilePath) {
                this.recordSourceKeyToFilePath = {};
            }
            
            if (dataPack instanceof Array) {
                for (data of dataPack) {
                    if (data.VlocityRecordSourceKey) {
                        this.recordSourceKeyToFilePath[data.VlocityRecordSourceKey] = path.normalize(filePath);    
                    }   
                }
            } else if (dataPack.VlocityRecordSourceKey){
                this.recordSourceKeyToFilePath[dataPack.VlocityRecordSourceKey] = path.normalize(filePath);
            }
        }
    } catch (e) {}
}

DataPacksBuilder.prototype.loadFilesAtPath = async function(srcpath, jobInfo, dataPackKey) {
    
    var filePromises = [];
    for (var filename of this.vlocity.datapacksutils.getFiles(srcpath)) {
        var encoding = 'base64';
        var extension = filename.substr(filename.lastIndexOf('.')+1);
        if (UTF8_EXTENSIONS.indexOf(extension) > -1) {
            encoding = 'utf8';
        }
        var filemapkey = path.normalize(path.join(srcpath, filename));
        filePromises.push(this.setFileData(filemapkey, encoding));
    }

    if (filePromises.length > 0) {
        await Promise.all(filePromises);
    }
};

DataPacksBuilder.prototype.getDataPackLabelByDir = function(dataPackDir, jobInfo) {
    try {        
        if (!jobInfo.dataPackLabelsByDir[dataPackDir]) {            
            var allFiles = this.vlocity.datapacksutils.getFiles(dataPackDir);
            for (var i = 0; i < allFiles.length; i++) {
                var basename = allFiles[i];
                if (basename.endsWith('_DataPack.json')) {
                    jobInfo.dataPackLabelsByDir[dataPackDir] = basename.substr(0, basename.lastIndexOf('_DataPack.json'));
                    break;
                }
            }
        } 

        return jobInfo.dataPackLabelsByDir[dataPackDir];
    } catch (e) {
        // Means file deleted
        return null;
    }
    // file not found
    return null;
};

DataPacksBuilder.prototype.getDataPackLabel = function(dataPackTypeDir, dataPackName) {
    try {        
        var allFiles = this.vlocity.datapacksutils.getFiles(path.join(dataPackTypeDir, dataPackName));
        for (var i = 0; i < allFiles.length; i++) {
            var basename = allFiles[i];
            if (basename.endsWith('_DataPack.json')) {
               return basename.substr(0, basename.lastIndexOf('_DataPack.json'));
            }
        }
    } catch (e) {
        // Means file deleted
        return null;
    }
    // file not found
    return null;
};

DataPacksBuilder.prototype.isInManifest = function(jobInfo, dataPackType, dataPackKey, dataPackName) {

    if (!jobInfo.specificManifestKeys && !jobInfo.specificManifestObjects) {
        return true;
    }

    if (jobInfo.specificManifestKeys && 
        (jobInfo.specificManifestKeys.indexOf(dataPackKey) != -1
        || jobInfo.specificManifestKeys.indexOf(this.vlocity.datapacksexpand.sanitizeDataPackKey(dataPackKey)) != -1)) {
        jobInfo.manifestFound[dataPackKey] = true; 
        jobInfo.manifestFound[this.vlocity.datapacksexpand.sanitizeDataPackKey(dataPackKey)] = true;
        return true; 
    }

    // Allow Passing in Just Type to Manifest for Deploy
    if (jobInfo.specificManifestKeys && jobInfo.specificManifestKeys.indexOf(dataPackType) != -1) {
        jobInfo.manifestFound[dataPackKey] = true; 
        return true; 
    }

    if (jobInfo.specificManifestObjects && 
        jobInfo.specificManifestObjects[dataPackType] && 
        jobInfo.specificManifestObjects[dataPackType].indexOf(dataPackName) != -1) {
        jobInfo.manifestFound[dataPackKey] = true; 
        return true; 
    }
 
    return false;
}

DataPacksBuilder.prototype.initializeTypeAtPath = async function(dataPackTypeDir, dataPackName, dataPackType, jobInfo) {
    var self = this;

    var dataPackLabel = self.getDataPackLabel(dataPackTypeDir, dataPackName);
    var dataPackKey = dataPackType + '/' + dataPackName.replace(path.sep, '/');  
    var metadataFilename = path.join(dataPackTypeDir, dataPackName, dataPackLabel + '_DataPack.json');

    if (dataPackLabel == null || !self.vlocity.datapacksutils.fileExists(metadataFilename)) {
        return;
    }
    try {  
        await this.loadFilesAtPath(path.join(dataPackTypeDir, dataPackName), jobInfo, dataPackKey);
        var sobjectData = JSON.parse(self.getFileData(metadataFilename));

        let sObjDataRecordType = sobjectData.VlocityRecordSObjectType;
        if (jobInfo.upgradeDataPackFields && this.vlocity.datapacksutils.dataPacksExpandedDefinition.StmpaExcludedSObjectsTypes.includes(sObjDataRecordType)) {
            sObjDataRecordType = sObjDataRecordType.replace('%vlocity_namespace%__', '');
        }
        
        var generatedDataPackKey = dataPackType + '/' + self.vlocity.datapacksexpand.getDataPackFolder(dataPackType, sObjDataRecordType, sobjectData);

        jobInfo.keysToDirectories[generatedDataPackKey] = dataPackType + '/' + dataPackName;

        if (self.isInManifest(jobInfo, dataPackType, generatedDataPackKey, dataPackName)) {
        
            if (!jobInfo.currentStatus[generatedDataPackKey]) {
                jobInfo.currentStatus[generatedDataPackKey] = 'Ready';
            }

            if (sobjectData.Name) {
                jobInfo.generatedKeysToNames[generatedDataPackKey] = sobjectData.Name;
            }

            if (jobInfo.allParents.indexOf(generatedDataPackKey) == -1) {
                jobInfo.allParents.push(generatedDataPackKey);
            }

            var apexImportData = {};

            self.vlocity.datapacksutils.getApexImportDataKeys(sObjDataRecordType).forEach(function(field) {
                apexImportData[field] = sobjectData[field];
            });

            apexImportData.VlocityRecordSourceKey = sobjectData.VlocityRecordSourceKey;
            jobInfo.preDeployDataSummary.push(apexImportData);
            jobInfo.allDataSummary[generatedDataPackKey] = apexImportData;
            jobInfo.dataPackKeyToPrimarySourceKey[sobjectData.VlocityRecordSourceKey] = generatedDataPackKey;
        }
    } catch (e) {
        jobInfo.currentStatus[dataPackKey] = 'Error';
        jobInfo.hasError = true;
        jobInfo.errors.push(`Error Loading >> ${dataPackKey} - ${e.message}`);
        VlocityUtils.error('Error Loading', dataPackKey, e.message, e.stack);
    }
    
}


DataPacksBuilder.prototype.initializeImportStatus = async function(importPath, jobInfo) {
    var self = this;

    if (!self.vlocity.datapacksutils.fileExists(importPath)) {
        VlocityUtils.error('No Data At Path', importPath);
        return;
    }

    this.parentData = {};
    var importPaths = [];
    
    var directories = self.vlocity.datapacksutils.getDirectories(importPath);

    for (var dataPackType of directories) {
        if (jobInfo.allAllowedTypes) {
            if (!jobInfo.allAllowedTypes.Vlocity || !jobInfo.allAllowedTypes.Vlocity[dataPackType]) {
                continue;
            }
        }

        importPaths.push(dataPackType);
    }

    VlocityUtils.verbose('Found import paths', importPaths);

    var allDataPacksOfType = {};

    for (var dataPackType of importPaths) {
        var dataPackTypeDir = importPath + '/' + dataPackType;
        allDataPacksOfType[dataPackType] = self.vlocity.datapacksutils.getDirectories(dataPackTypeDir, true);
        VlocityUtils.verbose('Found datapack candidates', dataPackType, allDataPacksOfType[dataPackType].length);
    }

    for (var dataPackType of importPaths) {

        var dataPackTypeDir = importPath + '/' + dataPackType;
        for (var dataPackName of allDataPacksOfType[dataPackType]) {
            await this.initializeTypeAtPath(dataPackTypeDir, dataPackName, dataPackType, jobInfo);
        }
    }

    if (jobInfo.specificManifestKeys) {
        VlocityUtils.verbose('Looking For Manifest Keys', jobInfo.specificManifestKeys);
        VlocityUtils.verbose('Found Manifest Keys', jobInfo.manifestFound);
        
        jobInfo.specificManifestKeys.forEach(key => {
            // Ignore when passed in as type
            if (key.indexOf('/') != -1
            && !(jobInfo.manifestFound[key] 
                || jobInfo.manifestFound[self.vlocity.datapacksexpand.sanitizeDataPackKey(key)])) {

                if (this.vlocity.datapacksutils.metadataTypesByFolder 
                    && this.vlocity.datapacksutils.metadataTypesByFolder[key.substring(0, key.indexOf('/'))]) {
                    return;
                }

                jobInfo.hasError = true;
                jobInfo.errors.push('Manifest Item Missing >> ' + key);
                VlocityUtils.error('Manifest Item Missing', key);
            }
        });
    }    
};

DataPacksBuilder.prototype.getNextImports = function(importPath, jobInfo, currentDataPackKeysInImport, currentBuildLength, validateOnly) {
    var self = this;

    var singleFile = jobInfo.singleFile === true;
    var dataPackKeys = Object.keys(jobInfo.currentStatus);

    var nextImports = [];

    var parallelStatus = {};

    var dataPackTypesWithReadyStatus = [];
    var typesToBeDeployedLast = [];
    Object.keys(jobInfo.currentStatus).forEach(key => {
        let dataPackType = key.split('/')[0];
        if ((jobInfo.currentStatus[key] === 'Ready' || jobInfo.currentStatus[key] === 'Added' || jobInfo.currentStatus[key] === 'ReadySeparate') && !dataPackTypesWithReadyStatus.includes(dataPackType)) {
            dataPackTypesWithReadyStatus.push(dataPackType);
            if (this.vlocity.datapacksutils.isDeployLast(dataPackType)) {
                typesToBeDeployedLast.push(dataPackType);
            }
        }
    });

    var lastDeployableReadyDataPacks = typesToBeDeployedLast.filter(el => dataPackTypesWithReadyStatus.includes(el));

    for (var i = 0; i < dataPackKeys.length; i++) {
        
        var dataPackKey = dataPackKeys[i];

        if (jobInfo.currentStatus[dataPackKey] == 'Ready' 
            || (jobInfo.currentStatus[dataPackKey] == 'ReadySeparate' 
                && Object.keys(currentDataPackKeysInImport).length == 0) 
            || (jobInfo.currentStatus[dataPackKey] == 'Header' 
                    && !jobInfo.headersOnly 
                    && Object.keys(currentDataPackKeysInImport).length == 0)) {
            try {

                var typeIndex = dataPackKey.indexOf('/');

                var dataPackType = dataPackKey.substr(0, typeIndex);
                var dataNameIndex = dataPackKey.indexOf(dataPackType + '/') + dataPackType.length + 1;
                
                var dataPackName = dataPackKey.substr(dataNameIndex);

                if (!jobInfo.keysToDirectories[dataPackKey]) {
                    if (dataPackKey.indexOf('|Page') != -1) {
                        delete jobInfo.currentStatus[dataPackKey];
                    }
                    continue;
                }

                if (jobInfo.jobAction === 'Deploy' &&
                    typesToBeDeployedLast.includes(dataPackType) &&
                    dataPackTypesWithReadyStatus.length !== lastDeployableReadyDataPacks.length
                ) {
                    continue;
                }

                var fullPathToFiles = path.join(importPath, jobInfo.keysToDirectories[dataPackKey]);
               
                var dataPackLabel = self.getDataPackLabelByDir(fullPathToFiles, jobInfo);

                var parentData;

                var maxDeployCountForType = DEFAULT_MAX_DEPLOY_COUNT;

                if (self.vlocity.datapacksutils.getMaxDeploy(dataPackType)) {
                    maxDeployCountForType = self.vlocity.datapacksutils.getMaxDeploy(dataPackType);
                }

                if (dataPackType.indexOf('SObject_') == 0) {
                    dataPackType = 'SObject';
                }
                
                var fileData = self.getFileData(fullPathToFiles, dataPackLabel + '_DataPack.json');
                
                if (!fileData) {
                    delete jobInfo.currentStatus[dataPackKey];
                    continue;
                }

                var dataPackDataMetadata = JSON.parse(fileData);

                if (!jobInfo.singleFile) {
                    if (Object.keys(currentDataPackKeysInImport).length >= maxDeployCountForType) {
                        continue;
                    }
                }

                if (!dataPackLabel) {
                    delete jobInfo.currentStatus[dataPackKey];
                    continue;
                }

                var headersType = self.vlocity.datapacksutils.getHeadersOnly(dataPackType);

                // Headers only accounts for potential circular references by only uploading the parent record
                if (!jobInfo.headersOnly && !jobInfo.forceDeploy) {
                   parentData = self.getFileData(fullPathToFiles, dataPackLabel + '_ParentKeys.json');
                } else if (!headersType && !jobInfo.forceDeploy) {
                    continue;
                }

                if (!jobInfo.singleFile && !self.vlocity.datapacksutils.isAllowParallel(dataPackType, dataPackDataMetadata)) {
                    if (parallelStatus[dataPackType] == null) {

                        for (var statKey in jobInfo.currentStatus) {
                            if (statKey.indexOf(dataPackType + '/') == 0 
                            && (jobInfo.currentStatus[statKey] == 'Added' || jobInfo.currentStatus[statKey] == 'AddedHeader')) {
                                parallelStatus[dataPackType] = true;
                                break;
                            }
                        }

                        if (!parallelStatus[dataPackType]) {
                            parallelStatus[dataPackType] = false;
                        }
                    }
                    
                    if (parallelStatus[dataPackType]) {
                        continue;
                    }
                }

                if (jobInfo.forceDeploy && jobInfo.ignoreAllParents) {
                    parentData = null;
                }

                var needsParents = false; 

                if (parentData) {

                    if (!this.parentData[dataPackKey]) {
                        var parentDataList = [];

                        try {

                            JSON.parse(parentData).forEach(function(parentKey) {
                                if (dataPackKey != parentKey) {
                                    parentDataList.push(parentKey);
                                };
                            });

                            this.parentData[dataPackKey] = parentDataList;
                        } catch (e) {
                            VlocityUtils.error('Error Loading Parent Keys', dataPackKey);
                        }
                    }

                    if (!singleFile) {
                        this.parentData[dataPackKey].forEach(function(parentKey) {

                            if (self.vlocity.datapacksutils.isGuaranteedParentKey(parentKey)) {
                                return;
                            }

                            if (jobInfo.currentStatus[parentKey] != null 
                                && !(jobInfo.currentStatus[parentKey] == 'Success' 
                                    || jobInfo.currentStatus[parentKey] == 'Header' 
                                    || jobInfo.currentStatus[parentKey] == 'AddedHeader') 
                                && currentDataPackKeysInImport[parentKey] != true) {
                                needsParents = true;
                            }
                        });

                        if (needsParents) {
                            continue;
                        }
                    }

                    parentData = this.parentData[dataPackKey];
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

                if (jobInfo.currentStatus[dataPackKey] == 'ReadySeparate' || jobInfo.currentStatus[dataPackKey] == 'Header') {
                    nextImport.shouldBreakImportLoop = true;
                }

                var sobjectDataField = dataPackDataMetadata.VlocityRecordSObjectType;

                var dataPackImportBuilt = self.buildFromFiles(dataPackKey, dataPackDataMetadata, fullPathToFiles, dataPackType, sobjectDataField, jobInfo);

                // Always an Array in Actual Data Model
                if (dataPackImportBuilt[0] != null && dataPackImportBuilt[0].VlocityDataPackType.indexOf('SObject_') == 0) {
                    sobjectDataField = dataPackImportBuilt[0].VlocityRecordSObjectType;
                    dataPackImportBuilt[0].VlocityDataPackType = 'SObject';
                    dataPackImportBuilt.VlocityDataPackType = 'SObject';
                }

                if (jobInfo.headersOnly && headersType != "All") {
                    var hasReference = false;

                    var headersRemovals = self.vlocity.datapacksutils.getHeadersRemovals(dataPackType, dataPackImportBuilt[0].VlocityRecordSObjectType);

                    if (headersRemovals) {
                        headersRemovals.forEach(function(key) {
                            delete dataPackImportBuilt[0][key];
                        });
                    }

                    Object.keys(dataPackImportBuilt[0]).forEach(function(key) {

                        var headersExclusions = self.vlocity.datapacksutils.getHeadersExclusions(dataPackType);

                        if (headersExclusions 
                            && jobInfo.allowHeadersPartial 
                            && headersExclusions.indexOf(key) != -1) {
                            return;
                        }

                        if (Array.isArray(dataPackImportBuilt[0][key])) {
                            dataPackImportBuilt[0][key] = [];
                        } else if (typeof dataPackImportBuilt[0][key] === 'object' 
                            && dataPackImportBuilt[0][key].VlocityLookupRecordSourceKey) {

                            // This is waiting to upload, when headers only, any item references with references that will not already exist
                            var referenceKey = jobInfo.dataPackKeyToPrimarySourceKey[dataPackImportBuilt[0][key].VlocityLookupRecordSourceKey];

                            if (referenceKey 
                                && jobInfo.currentStatus[referenceKey] 
                                && !(jobInfo.currentStatus[referenceKey] == 'Success' 
                                || jobInfo.currentStatus[referenceKey] == 'Header')) {
                                hasReference = true;
                            }
                        }
                    });

                    if (hasReference) {
                        continue;
                    }
                }

                nextImport.VlocityDataPackData[sobjectDataField] = dataPackImportBuilt;
                jobInfo.dataPackDisplayLabels[dataPackKey] = this.vlocity.datapacksutils.getDisplayName(dataPackImportBuilt[0]) + ` (${dataPackKey})`;

                if (!jobInfo.singleFile && Object.keys(currentDataPackKeysInImport).length != 0) {

                    if (!self.dataPackSizes[nextImport.VlocityDataPackKey]) {
                        self.dataPackSizes[nextImport.VlocityDataPackKey] = JSON.stringify(nextImport).length;
                    }

                    if (self.dataPackSizes[nextImport.VlocityDataPackKey] + currentBuildLength > self.maxImportSize) {
                        continue;
                    } else {
                        currentBuildLength += self.dataPackSizes[nextImport.VlocityDataPackKey];
                    }
                }

                if (jobInfo.headersOnly) {

                    if (headersType == 'Identical') {
                        jobInfo.currentStatus[dataPackKey] = 'Added';
                    } else {
                        jobInfo.currentStatus[dataPackKey] = 'Header';
                    }
                } else if (jobInfo.currentStatus[dataPackKey] == 'Header') {
                    jobInfo.currentStatus[dataPackKey] = 'AddedHeader';
                } else {
                    jobInfo.currentStatus[dataPackKey] = 'Added';
                }
                
                VlocityUtils.success('Adding to ' + (jobInfo.singleFile ? 'File' : (validateOnly == 1 ? 'Validate' : 'Deploy')) + '', nextImport.VlocityDataPackKey + ' - ' + dataPackLabel, jobInfo.headersOnly ? '- Headers Only' : '', jobInfo.forceDeploy ? '- Force Deploy' : '');

                currentDataPackKeysInImport[dataPackKey] = true;

                nextImports.push(nextImport);

                if (validateOnly && nextImports.length > 0) {
                    break;
                }
            } catch (e) {
                VlocityUtils.error('Error Formatting Deploy', dataPackKey, e.stack || e);

                jobInfo.hasError = true;
                jobInfo.errors.push(`Error Formatting Deploy >> ${dataPackKey} - ${e.stack || e}`);
                jobInfo.currentStatus[dataPackKey] = 'Error';
            }
        }
    }

    return nextImports;
};

DataPacksBuilder.prototype.buildFromFiles = function(dataPackKey, dataPackDataArray, fullPathToFiles, dataPackType, currentDataField, jobInfo) {
    var self = this;

    // The SObjectData in the DataPack is always stored in arrays
    if (!Array.isArray(dataPackDataArray)){
        dataPackDataArray = [ dataPackDataArray ];
    }

    for (var i = 0; i < dataPackDataArray.length; i++) {
        var dataPackData = dataPackDataArray[i];
        if (dataPackData.VlocityDataPackType) {
            dataPackData.VlocityDataPackIsIncluded = true;

            // Allow removing and injecting Vlocity Record Source keys to 
            // keep any inconsistent data out of the saved files
            if (!dataPackData.VlocityRecordSourceKey && dataPackData.VlocityDataPackType == 'SObject') {
                // This should be index + parent
                dataPackData.VlocityRecordSourceKey = dataPackKey + '/' + dataPackData.VlocityRecordSObjectType + '/' + i;
            }
        }
       
        Object.keys(dataPackData).forEach(function(field) {            
            
            var potentialFileNames = dataPackData[field];

            if (field != 'Name' && potentialFileNames) {

                // Check on This idea
                if (Array.isArray(potentialFileNames) 
                    && potentialFileNames.length > 0
                    && typeof potentialFileNames[0] === 'string' ) 
                {
                    var allDataPackFileData = [];

                    potentialFileNames.forEach(function(fileInArray) {
                        var fileData = self.getFileData(fullPathToFiles, fileInArray);
                        if (fileData) {
                            try {
                                allDataPackFileData.push(JSON.parse(fileData));
                            } catch (e) {
                                jobInfo.currentStatus[dataPackKey] = 'Error';
                                jobInfo.errors.push(`Error Building DataPack ${dataPackKey} - Corrupt File - ${fullPathToFiles}`)
                                VlocityUtils.error('Error Building DataPack', dataPackKey, 'Corrupt File', fullPathToFiles);
                            }
                        } else {
                            VlocityUtils.error('File Does Not Exist', path.join(fullPathToFiles, fileInArray));
                        }
                    });

                    if (allDataPackFileData.length > 0) {
                        self.buildFromFiles(dataPackKey, allDataPackFileData, fullPathToFiles, dataPackType, field, jobInfo);
                        dataPackData[field] = allDataPackFileData;
                    }
                } else if (typeof potentialFileNames === 'string') {
                    var filename = path.join(fullPathToFiles, potentialFileNames);
                    var fileType = self.vlocity.datapacksutils.getExpandedDefinition(dataPackType, currentDataField, field);
                    var fileData = self.getFileData(filename);

                    if (potentialFileNames == fileData && jobInfo.jobAction == 'Deploy') {
                        VlocityUtils.error('Error', 'File was deleted and corrupted. Please Re-Export before Deploying.', filename);
                        throw `File was deleted and corrupted. Please Re-Export before Deploying ${filename}`;
                    }

                    if (fileData) {
                        var fileDataJSON;

                        try {
                            fileDataJSON = JSON.parse(fileData);
                        } catch (e) {
                            // expected often
                        }

                        if (fileDataJSON && ((fileDataJSON[0] && fileDataJSON[0].VlocityRecordSObjectType) || fileDataJSON.VlocityRecordSObjectType)) {
                            dataPackData[field] = self.buildFromFiles(dataPackKey, fileDataJSON, fullPathToFiles, dataPackType, field, jobInfo);
                        } else {
                            if (self.compileOnBuild && fileType && fileType.CompiledField) {

                                var allTemplateUISelected = self.vlocity.datapacksutils.getDirectories(fullPathToFiles + "/..");
                                // these options will be passed to the importer function 
                                var includePaths = allTemplateUISelected.map(function(dir) {
                                    return path.normalize(fullPathToFiles + "/../" + dir + "/");
                                });

                                if (jobInfo.additionalSassCompilationIncludePaths) {
                                    for (var folder of jobInfo.additionalSassCompilationIncludePaths) {
                                        var uiTemplateFolder = folder.split(path.sep).pop();
                                        if (!allTemplateUISelected.includes(uiTemplateFolder)) {
                                            includePaths.push(folder);
                                        }
                                    }
                                }

                                var importerOptions = {
                                    // collect paths to look for imported/included files
                                    includePaths: includePaths
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
                                            VlocityUtils.error('Compilation Error', dataPackKey, 'Failed to compile SCSS: ' + filename + ' ' + error.message);

                                            return { VlocityDataPackKey: dataPackKey, message: 'Failed to compile SCSS: ' + filename + ' ' + error.message };
                                        }
                                        dataPackData[fileType.CompiledField] = compiledResult;
                                    }
                                });
                                // save source into datapack to ensure the uncompiled data also gets deployed
                                dataPackData[field] = fileData;
                            } else if (!self.compileOnBuild || !self.vlocity.datapacksutils.isCompiledField(dataPackType, currentDataField, field)) {

                                if (fileDataJSON) {
                                    dataPackData[field] = JSON.stringify(fileDataJSON);
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

        var buildOnlyFields = self.vlocity.datapacksutils.getBuildOnlyFields(dataPackType, dataPackData.VlocityRecordSObjectType);

        Object.keys(buildOnlyFields).forEach(function(field) {

            // Check null for existing data to not get corrupted
            if (dataPackData[field] == null) {
                if (buildOnlyFields[field] == 'index') {
                    dataPackData[field] = i+1;
                } else if (buildOnlyFields[field] == 'guid') {
                    dataPackData[field] = self.vlocity.datapacksutils.guid();
                } else {
                    dataPackData[field] = buildOnlyFields[field];
                }
            }
        });
    }

    if (jobInfo.jobAction == 'Deploy') {
        if (jobInfo.removeInvalidMatchingKeyFields) {
            this.removeInvalidMatchingKeyFields(dataPackDataArray);
        }

        if (jobInfo.checkMatchingKeys) {
            return this.checkMatchingKeys(dataPackDataArray, [], jobInfo); 
        }
    }
    
    return dataPackDataArray;
};

DataPacksBuilder.prototype.checkMatchingKeys = function (currentData, updatedDataPackDataArray, jobInfo) {
    if (currentData) {
        if (Array.isArray(currentData)) {
            currentData.forEach((childData) => {
                updatedDataPackDataArray.push(this.checkMatchingKeys(childData, updatedDataPackDataArray, jobInfo));
            });
        } else {
            Object.keys(currentData).forEach((sobjectField) => {
                if (typeof currentData[sobjectField] === "object"
                    && (currentData[sobjectField].VlocityDataPackType === "VlocityMatchingKeyObject" || currentData[sobjectField].VlocityDataPackType === "VlocityLookupMatchingKeyObject")
                    && this.matchingKeyFields 
                    && this.matchingKeyFields[currentData[sobjectField]] 
                    && this.matchingKeyFields[currentData[sobjectField].VlocityRecordSObjectType]) {
                    let matchingObjectKeys = this.matchingKeyFields[currentData[sobjectField].VlocityRecordSObjectType];
                    if (matchingObjectKeys) {
                        matchingObjectKeys.forEach((key) => {
                            let returnResponse = this.processMatchingKeys(matchingObjectKeys, key, currentData[sobjectField], jobInfo);
                            currentData[sobjectField] = returnResponse.childData;
                            if (returnResponse.error) {
                                jobInfo.hasError = true;
                                jobInfo.errors.push(`Matching Key Data not found for >> ${currentData[sobjectField].VlocityMatchingRecordSourceKey}. Missing ${key}`);
                                VlocityUtils.error('Matching Key Data not found for', currentData[sobjectField].VlocityMatchingRecordSourceKey,'. Missing', key);
                            }
                        });
                    }
                }
            });
            return currentData;
        }
    }
    return updatedDataPackDataArray;
};

DataPacksBuilder.prototype.processMatchingKeys = function (matchingObjectKeys, key, childData, jobInfo) {
    var errorFlag;
    if (!childData[key]) {
        errorFlag = true;
        Object.keys(childData).forEach((sobjField) => {
            if (sobjField != "VlocityDataPackType"
                && sobjField != "VlocityMatchingRecordSourceKey"
                && sobjField != "VlocityLookupRecordSourceKey"
                && sobjField != "VlocityRecordSObjectType"
                && sobjField.indexOf('.') === -1 
                // To prevent nested key getting replaced while searching normal keys.
                && sobjField.indexOf(key.replace('__c','')) === -1
                // To prevent any normal key getting replaced in several iterations due to multiple matching keys for any object
                && matchingObjectKeys.indexOf(sobjField) === -1) {
                    if(jobInfo.sourceKeyToMatchingKeysData[childData.VlocityMatchingRecordSourceKey] 
                        && jobInfo.sourceKeyToMatchingKeysData[childData.VlocityMatchingRecordSourceKey][key]){
                            childData[key] = jobInfo.sourceKeyToMatchingKeysData[childData.VlocityMatchingRecordSourceKey][key];
                            delete childData[sobjField];
                            errorFlag = false;
                    }
            } else if(sobjField.indexOf(key.replace('__c','')) === 0){
                errorFlag = false;
            }
        });
    } else {
        errorFlag = false;
    }

    return {childData: childData, error: errorFlag};
};

DataPacksBuilder.prototype.removeInvalidMatchingKeyFields = function(currentData) {
    
    if (currentData) {
       
        if (Array.isArray(currentData)) {
            currentData.forEach((childData) => {
                this.removeInvalidMatchingKeyFields(childData);
            });

        } else {
            if (currentData.VlocityDataPackType == "VlocityLookupMatchingKeyObject") {
                var matchingFields = this.matchingKeyFields;

                if (matchingFields[currentData.VlocityRecordSObjectType]) {
                    Object.keys(currentData).forEach((sobjectField) => {

                        if (sobjectField != "VlocityDataPackType"
                            && sobjectField != "VlocityLookupRecordSourceKey"
                            && sobjectField != "VlocityRecordSObjectType"
                            && sobjectField.indexOf('.') == -1 
                            && matchingFields[currentData.VlocityRecordSObjectType].indexOf(sobjectField) == -1) {
                            delete currentData[sobjectField];
                        } 
                    });
                }
            }

            Object.keys(currentData).forEach((sobjectField) => {
                if (typeof currentData[sobjectField] === "object") {
                    this.removeInvalidMatchingKeyFields(currentData[sobjectField]);
                } 
            });
        }
    }
};

DataPacksBuilder.prototype.compileQueuedData = async function() {
    let promise = await new Promise((resolve) => {
        // locals we will use to track the progress
        var compileCount = 0;
        var errors = [];
        
        // Sass.js compiler is a bit funcky and the callbacks
        // are not garantueed to be called in the correct order
        // this causes issue and therefor we do not want to compile files in parallel 
        // this compileNext function takes care of that by calling itself recusrively
        var compileNext = (job) => {
            if (!job) {

                if (errors.length > 0) {
                    VlocityUtils.verbose('Compilation Error', 'Compiled', compileCount, 'files with', errors.length, 'errors.', errors);
                } else if (compileCount > 0) {
                    VlocityUtils.verbose('Compilation Success', 'Compiled', compileCount);
                }
                
                return resolve({ 
                    compileCount: compileCount,
                    hasCompileError: errors.length > 0, 
                    errors: errors
                });
            }

            VlocityUtils.verbose('Start compilation', job.filename);

            this.compile(job.language, job.source, job.options || {}, (error, compiledResult) => {
                if(error) {
                    errors.push(job.callback(error, null));
                } else {
                    job.callback(null, compiledResult);
                    compileCount++;
                }
                compileNext(this.compileQueue.pop());
            });
        };

        // kick it off!
        compileNext(this.compileQueue.pop()); 
    });

    return promise;
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
