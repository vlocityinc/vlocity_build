var fs = require("fs-extra");
var path  = require('path');
var stringify = require('json-stable-stringify');
var yaml = require('js-yaml');
var gitDiff = require('git-diff');
var ignore = require( 'ignore');
const fileType = require('file-type');
const isUtf8 = require('is-utf8');
const UtilityService = require('./utilityservice.js');
var filterxml = require('filterxml');


// use consts for setting the namespace prefix so that we easily can reference it later on in this file
const namespacePrefix = 'vlocity_namespace';
const namespaceFieldPrefix = '%' + namespacePrefix + '%__';

var CURRENT_INFO_FILE;

VLOCITY_BUILD_SALESFORCE_API_VERSION = '46.0';

var DataPacksUtils = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};

    CURRENT_INFO_FILE = path.join(vlocity.tempFolder, 'currentJobInfo.json');

    this.dataPacksExpandedDefinition = yaml.safeLoad(fs.readFileSync(path.join(__dirname, 'datapacksexpanddefinition.yaml'), 'utf8'));

    this.runJavaScriptModules = {};

    this.startTime = new Date().toISOString();
    this.alreadyWrittenLogs = [];
    this.perfTimers = {};
    this.loadedFiles = {};
    this.fieldLabels = {};
    this.objectLabels = {};
    this.fieldImportance = {};
    this.allReferenceFieldsByType = {};
};

DataPacksUtils.prototype.perfTimer = function(key) {

    if (this.perfTimers[key]) {
        VlocityUtils.log('Elapsed: ' + key, Date.now() - this.perfTimers[key]);

        delete this.perfTimers[key];
    } else {
        this.perfTimers[key] = Date.now();
    }
}

DataPacksUtils.prototype.updateExpandedDefinitionNamespace = function(currentData) {
    var self = this;

    if (currentData == null) {
        return null;
    } 
    
    if (Array.isArray(currentData)) {
        var replacedArray = [];

        currentData.forEach(function(val){
            replacedArray.push(self.updateExpandedDefinitionNamespace(val));
        });

        return replacedArray;
    } else if (typeof currentData === 'object') {
        var replacedObject = {};

        Object.keys(currentData).forEach(function(key) {
            if (key.indexOf(namespaceFieldPrefix) == -1 && key.indexOf('__c')) {
                replacedObject[self.updateExpandedDefinitionNamespace(key)] = self.updateExpandedDefinitionNamespace(currentData[key]);
            }
        });

        return replacedObject;
    } else {

        if (typeof currentData === 'string') {

            if (currentData.indexOf(namespaceFieldPrefix) == -1 && currentData.indexOf('.') > 0) {

                var finalString = '';

                currentData.split('.').forEach(function(field) {

                    if (finalString != '') {
                        finalString += '.';
                    }

                    if (field.indexOf('__c') > 0 || field.indexOf('__r') > 0) {
                        finalString += namespaceFieldPrefix + field;
                    } else {
                        finalString += field;
                    }
                });
                return finalString;
            } else if (currentData.indexOf(namespaceFieldPrefix) == -1 && currentData.indexOf('__c') > 0) {
                return namespaceFieldPrefix + currentData;
            }
        }

        return currentData;
    } 
};

DataPacksUtils.prototype.overrideExpandedDefinition = function(expandedDefinition) {
    this.overrideExpandedDefinitions = JSON.parse(JSON.stringify(expandedDefinition).replace(/vlocity_namespace/g, '%vlocity_namespace%'));
};

DataPacksUtils.prototype.getDataField = function(dataPackData) {
    let dataKey;

    if (dataPackData.VlocityDataPackData) {
        Object.keys(dataPackData.VlocityDataPackData).forEach(function(key) {

            if (Array.isArray(dataPackData.VlocityDataPackData[key]) && dataPackData.VlocityDataPackData[key].length > 0 && dataPackData.VlocityDataPackData[key][0].VlocityRecordSObjectType) {
                dataKey = dataPackData.VlocityDataPackData[key][0].VlocityRecordSObjectType;
            }
        });
    }
    return dataKey; 
}

DataPacksUtils.prototype.getAllConfigurations = async function() {

    if (!this.allConfigurations) {
        this.allConfigurations = {};

        var queryResult = await this.vlocity.queryservice.query('SELECT Id, NamespacePrefix, DeveloperName,%vlocity_namespace%__DefaultImportLimit__c,%vlocity_namespace%__DefaultExportLimit__c FROM %vlocity_namespace%__VlocityDataPackConfiguration__mdt');
    
        if (queryResult && queryResult.records) {
            for (var i = 0; i < queryResult.records.length; i++) {

                var developerName = queryResult.records[i].DeveloperName;
                if (this.allConfigurations[queryResult.records[i][developerName]]) {
                    if (queryResult.records[i]['NamespacePrefix'] !== null) {
                        continue;
                    }
                }
    
                this.allConfigurations[developerName] = queryResult.records[i];
            }
        }
    }
};

DataPacksUtils.prototype.getListFileName = function(dataPackType, SObjectType) {
  
    var listFileNameKeys = this.getExpandedDefinition(dataPackType, SObjectType, "ListFileName");

    if (!listFileNameKeys) {
    
        var defaultListFileName = SObjectType.replace(/%vlocity_namespace%__|__c/g, "");

        if (defaultListFileName.substr(defaultListFileName.length-1, 1) == 'y') {
            defaultListFileName = '_' + defaultListFileName.substr(0, defaultListFileName.length-1) + 'ies';
        } else if (defaultListFileName.substr(defaultListFileName.length-1, 1) != 's') {
            defaultListFileName = '_' + defaultListFileName + 's';
        }

        listFileNameKeys = [ defaultListFileName ];
    }

    return listFileNameKeys;
}

DataPacksUtils.prototype.getEventHandler = function(dataPackType, event) {
    return this.getExpandedDefinition(dataPackType, null, event) || {};
}

DataPacksUtils.prototype.getDeltaCheckTextIdField = function(SObjectType) {
    return this.getExpandedDefinition(null, SObjectType, "DeltaCheckTextIdField") || [];
}

DataPacksUtils.prototype.getDeltaCheckMatchingKey = function(SObjectType) {
    return this.getExpandedDefinition(null, SObjectType, "DeltaCheckMatchingKey");
}

DataPacksUtils.prototype.getDeltaCheckMatchingKeyNotQueryable = function(SObjectType) {
    return this.getExpandedDefinition(null, SObjectType, "DeltaCheckMatchingKeyNotQueryable");
}

DataPacksUtils.prototype.getBuildOnlyFields = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "BuildOnlyFields") || {};
}

DataPacksUtils.prototype.getIgnoreFieldDiffs = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "IgnoreFieldDiffs") || [];
}

DataPacksUtils.prototype.isBuildOnlyField = function(dataPackType, SObjectType, field) {
    var buildOnlyFields = this.getExpandedDefinition(dataPackType, SObjectType, "BuildOnlyFields");
    return buildOnlyFields && buildOnlyFields.hasOwnProperty(field);
}

DataPacksUtils.prototype.getPaginationActions = function(dataPackType) {
    return this.getExpandedDefinition(dataPackType, null, "PaginationActions");
}

DataPacksUtils.prototype.getTitleFields = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "TitleFields");
}

DataPacksUtils.prototype.getSortFields = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "SortFields");
}

DataPacksUtils.prototype.isIgnoreExpand = function(dataPackType, SObjectField) {
    var ignoreFields = this.getExpandedDefinition(dataPackType, null, "IgnoreExpand");

    return ignoreFields && ignoreFields.indexOf(SObjectField) != -1;
}

DataPacksUtils.prototype.isDoNotExpand = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "DoNotExpand");
}

DataPacksUtils.prototype.getKeepOnlyFields = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "KeepOnlyFields");
}

DataPacksUtils.prototype.getFilterFields = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "FilterFields");
}

DataPacksUtils.prototype.getSummaryFields = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "SummaryFields");
}

DataPacksUtils.prototype.getDataPackReferences = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "DataPackReferences");
}

DataPacksUtils.prototype.getRecordLabel = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "RecordLabel");
}

DataPacksUtils.prototype.getFileName = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "FileName");
}

DataPacksUtils.prototype.getSourceKeyGenerationFields = function(SObjectType) {
    return this.getExpandedDefinition(null, SObjectType, "SourceKeyGenerationFields");
}

DataPacksUtils.prototype.getSourceKeyDefinitionFields = function(SObjectType) {
    return this.getExpandedDefinition(null, SObjectType, "SourceKeyDefinition");
}

DataPacksUtils.prototype.getMatchingSourceKeyDefinitionFields = function(SObjectType) {
    return this.getExpandedDefinition(null, SObjectType, "MatchingSourceKeyDefinition");
}

DataPacksUtils.prototype.getDiffKeys = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "DiffKeys");
}

DataPacksUtils.prototype.getFolderName = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "FolderName");
}

DataPacksUtils.prototype.getFileType = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "FileType");
}

DataPacksUtils.prototype.getJsonFields = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "JsonFields");
}

DataPacksUtils.prototype.getHashFields = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "HashFields");
}

DataPacksUtils.prototype.getReplacementFields = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "ReplacementFields");
}

DataPacksUtils.prototype.isNonUnique = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "NonUnique");
}

DataPacksUtils.prototype.isUniqueByName = function(dataPackType) {
    return this.getExpandedDefinition(dataPackType, null, "UniqueByName");
}

DataPacksUtils.prototype.getPaginationSize = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, null, "PaginationSize");
}

DataPacksUtils.prototype.isRemoveNullValues = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "RemoveNullValues");
}

DataPacksUtils.prototype.getUnhashableFields = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "UnhashableFields");
}

DataPacksUtils.prototype.getIsDiffable = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, null, "IsDiffable");
}

DataPacksUtils.prototype.isDeletedDuringDeploy = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "DeletedDuringDeploy");
}

DataPacksUtils.prototype.isAllowParallel = function(dataPackType, dataPackDataMetadata) {
    var parallel = this.getExpandedDefinition(dataPackType, null, "SupportParallel");

    if (typeof parallel === "object") {
        var parallelKeys = Object.keys(parallel);

        for (var i = 0; i < parallelKeys.length; i++) {
            var parallelKey = parallelKeys[i];
            var parallelValue = parallel[parallelKey];

            if (dataPackDataMetadata[parallelKey] != parallelValue) {
                return false;
            }
        }

        return true;
    }

    return this.getExpandedDefinition(dataPackType, null, "SupportParallel");
}

DataPacksUtils.prototype.getMaxDeploy = function(dataPackType) {
    return this.getExpandedDefinition(dataPackType, null, "MaxDeploy");
}

DataPacksUtils.prototype.getHeadersOnly = function(dataPackType) {
    return this.getExpandedDefinition(dataPackType, null, "HeadersOnly");
}

DataPacksUtils.prototype.getExportGroupSizeForType = function(dataPackType) {

    var override = this.getExpandedDefinition(dataPackType, null, "ExportGroupSize");
    
    var setting = 0 ;

    if (this.allConfigurations[dataPackType]) {
        setting = this.allConfigurations[dataPackType][`${this.vlocity.namespace}__DefaultExportLimit__c`];
    }

    return override ? override : Math.max(setting, 10);
}

DataPacksUtils.prototype.getChildrenLimitForType = function(dataPackType, SObjectType, field) {
    return this.getExpandedDefinition(dataPackType, null, "ChildrenLimit");
}

DataPacksUtils.prototype.isGuaranteedParentKey = function(parentKey) {

    return (this.overrideExpandedDefinitions 
        && this.overrideExpandedDefinitions.GuaranteedParentKeys 
        && this.overrideExpandedDefinitions.GuaranteedParentKeys.indexOf(parentKey) != -1) 
        || this.dataPacksExpandedDefinition.GuaranteedParentKeys.indexOf(parentKey) != -1;
}

DataPacksUtils.prototype.getApexImportDataKeys = function(SObjectType) {
    var defaults = ["VlocityRecordSObjectType", "Name"];
    var apexImportDataKeys = this.getSourceKeyDefinitionFields(SObjectType); 

    if (apexImportDataKeys) {
        return defaults.concat(apexImportDataKeys);
    }

    return defaults;
}

DataPacksUtils.prototype.getApexSObjectTypeList = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "ApexSObjectTypeList");
}

DataPacksUtils.prototype.isCompiledField = function(dataPackType, SObjectType, field) {
    var compiledFields = this.getExpandedDefinition(dataPackType, SObjectType, "CompiledFields");
    return compiledFields && compiledFields.indexOf(field) != -1;
}

DataPacksUtils.prototype.getDeltaQueryChildren = function(SObjectType) {
    return this.getExpandedDefinition(null, SObjectType, 'DeltaQueryChildren');
};

DataPacksUtils.prototype.getMetadataCheck = function(SObjectType) {
    return this.getExpandedDefinition(null, SObjectType, 'MetadataCheck');
};

DataPacksUtils.prototype.hasExpandedDefinition = function(dataPackType, SObjectType) {
    return this.dataPacksExpandedDefinition[dataPackType] && this.dataPacksExpandedDefinition[dataPackType][SObjectType];
}

DataPacksUtils.prototype.getExpandedDefinition = function(dataPackType, SObjectType, dataKey) {
    let definitionValue;

    if (this.overrideExpandedDefinitions) {
        if (dataPackType && this.overrideExpandedDefinitions.DataPacks && this.overrideExpandedDefinitions.DataPacks[dataPackType]) {
            if (SObjectType) {
                if (this.overrideExpandedDefinitions.DataPacks[dataPackType][SObjectType]) {
                    definitionValue = this.overrideExpandedDefinitions.DataPacks[dataPackType][SObjectType][dataKey]; 
                }
            } else {
                definitionValue = this.overrideExpandedDefinitions.DataPacks[dataPackType][dataKey]; 
            }
        }

        if (definitionValue === undefined && SObjectType && this.overrideExpandedDefinitions.SObjects && this.overrideExpandedDefinitions.SObjects[SObjectType]) {
            definitionValue = this.overrideExpandedDefinitions.SObjects[SObjectType][dataKey];
        }
    }

    if (SObjectType) {
        SObjectType = SObjectType.replace(this.vlocity.namespace, '%vlocity_namespace%');
    }

    if (definitionValue === undefined) {
        if (dataPackType && this.dataPacksExpandedDefinition.DataPacks[dataPackType]) {
            if (SObjectType) {
                if (this.dataPacksExpandedDefinition.DataPacks[dataPackType][SObjectType]) {
                    definitionValue = this.dataPacksExpandedDefinition.DataPacks[dataPackType][SObjectType][dataKey]; 
                }
            } else {
                definitionValue = this.dataPacksExpandedDefinition.DataPacks[dataPackType][dataKey]; 
            }
        }
    }

    if (definitionValue === undefined && SObjectType && this.dataPacksExpandedDefinition.SObjects[SObjectType]) {
        
        definitionValue = this.dataPacksExpandedDefinition.SObjects[SObjectType][dataKey];
    }

    if (definitionValue === undefined) {
        if (SObjectType) {
            definitionValue = this.dataPacksExpandedDefinition.SObjectsDefault[dataKey]; 
        } else {
            definitionValue = this.dataPacksExpandedDefinition.DataPacksDefault[dataKey]; 
        }
    }

    return definitionValue;
}

// Traverse JSON and get all Ids
DataPacksUtils.prototype.getAllSObjectIds = function(currentData, currentIdsOnly, typePlusId) {
    var self = this;

    if (currentData) {
       
        if (Array.isArray(currentData)) {
            currentData.forEach(function(childData) {
                self.getAllSObjectIds(childData, currentIdsOnly, typePlusId);
            });

        } else {

            if (currentData.VlocityDataPackType == "SObject") {
                if (currentData.Id) {
                    currentIdsOnly.push(currentData.Id);
                    typePlusId.push({ SObjectType: currentData.VlocityRecordSObjectType, Id: currentData.Id });
                }
            }
           
            Object.keys(currentData).forEach(function(sobjectField) {
                if (typeof currentData[sobjectField] === "object") {
                    self.getAllSObjectIds(currentData[sobjectField], currentIdsOnly, typePlusId);
                } 
            });
        }
    }
};

DataPacksUtils.prototype.getDirectories = function(srcpath, recusive, rootpath) {
	var dirs = [];
	try {        
        rootpath = path.normalize(rootpath || srcpath);
        fs.readdirSync(srcpath).forEach((file) => {
            var fullname = path.join(srcpath, file);
            var fstat = fs.statSync(fullname);
            if (fstat.isDirectory()) {

                var packName = fullname;

                if (packName.indexOf(rootpath) == 0) {
                    packName = packName.substr(rootpath.length);
                }

                if (packName.indexOf(path.sep) == 0) {
                    packName = packName.substr(path.sep.length);
                }

                dirs.push(packName);

                if(recusive) {
                    dirs = dirs.concat(this.getDirectories(fullname, recusive, rootpath || srcpath))
                }
            }
        });        
    } catch(e) {
        VlocityUtils.error('Error Loading Dir', e);
	}   
	return dirs;
};

DataPacksUtils.prototype.getFiles = function(srcpath) {
    try {
        return fs.readdirSync(srcpath).filter(function(file) {
            return fs.statSync(path.join(srcpath, file)).isFile();
        });
    } catch(e) {
        return [];
    }
};


DataPacksUtils.prototype.getFilesRecursive = function(srcpath, allFilePaths) {
    try {
        fs.readdirSync(srcpath).filter((file) => {
            var filePath = path.join(srcpath, file);
            var fileStat = fs.statSync(filePath);
            if (fileStat.isFile()) {
                allFilePaths.push(path.join(srcpath, file));
            } else if (fileStat.isDirectory()) {
                this.getFilesRecursive(path.join(srcpath, file), allFilePaths);
            }
        });
    } catch(e) {
    }
};

DataPacksUtils.prototype.fileExists = function(srcpath) {
    try {
        fs.statSync(srcpath);
    } catch (e) {
        return false;
    }
    
    return true;
}

DataPacksUtils.prototype.getAllParentKeys = async function(dataPacks, jobInfo) {
    for (var dataPack of dataPacks) {
        VlocityUtils.success('Processing DataPack', dataPack.VlocityDataPackKey);
        await this.vlocity.datapacksexpand.preprocessDataPack(dataPack, jobInfo)
    }

    for (var dataPack of dataPacks) {
        
        var newParents = [];

        for (var parentKey of dataPack.VlocityDataPackParents) {
            var foundParentKey = parentKey;

            if (jobInfo.dataPackKeyToPrimarySourceKey[parentKey]) {
                foundParentKey = jobInfo.dataPackKeyToPrimarySourceKey[parentKey];
            }

            if (foundParentKey != dataPack.VlocityDataPackKey && jobInfo.currentStatus[foundParentKey] && newParents.indexOf(foundParentKey) == -1) {
                newParents.push(foundParentKey);
            }
        }

        newParents.sort();
        dataPack.VlocityDataPackParents = newParents;
    }
}

DataPacksUtils.prototype.getParents = function(jobInfo, currentData, dataPackKey) {
    var self = this;

    if (currentData) {
        if (currentData.VlocityDataPackData) {
            var dataField = self.vlocity.datapacksutils.getDataField(currentData);

            if (dataField) {
                currentData.VlocityDataPackData[dataField].forEach(function(sobjectData) {
                    if (jobInfo.allParents.indexOf(currentData.VlocityDataPackKey) == -1) {
                        jobInfo.allParents.push(currentData.VlocityDataPackKey);
                    }
                    
                    self.getParents(jobInfo, sobjectData, currentData.VlocityDataPackKey);
                });
            }
        } else { 
           
            if (Array.isArray(currentData)) {
                currentData.forEach(function(childData) {
                    self.getParents(jobInfo, childData, dataPackKey);
                });

            } else {       
            
                if (currentData.VlocityDataPackType != 'VlocityLookupMatchingKeyObject' && currentData.VlocityDataPackType != 'VlocityMatchingKeyObject') {

                    // Make as Array because can Export Multiple Keys due to the way dependencies are exported
                    if (!jobInfo.sourceKeysByParent[currentData.VlocityRecordSourceKey]) {
                        jobInfo.sourceKeysByParent[currentData.VlocityRecordSourceKey] = [];
                    }

                    if (jobInfo.sourceKeysByParent[currentData.VlocityRecordSourceKey].indexOf(dataPackKey) == -1) {
                        jobInfo.sourceKeysByParent[currentData.VlocityRecordSourceKey].push(dataPackKey);
                    }

                    Object.keys(currentData).forEach(function(key) {
                        if (Array.isArray(currentData[key])) {
                            self.getParents(jobInfo, currentData[key], dataPackKey);
                        }
                    }); 
                }
            }
        }
    }
}

DataPacksUtils.prototype.initializeFromProject = async function(jobInfo) {
    var self = this;

    if (!self.fileExists(jobInfo.projectPath)) {
        return;
    }

    var jobInfoTemp = JSON.parse(JSON.stringify(jobInfo));

    jobInfoTemp.singleFile = true;
    VlocityUtils.silence = true;
    jobInfoTemp.compileOnBuild = false;
    jobInfoTemp.manifest = null;
    let dataJson = await self.vlocity.datapacksbuilder.buildImport(jobInfo.projectPath, jobInfoTemp);
   
    VlocityUtils.silence = false;

    if (dataJson && dataJson.dataPacks) {
        dataJson.dataPacks.forEach(function(dataPack) {
            self.getParents(jobInfo, dataPack);
        });
    }
}

DataPacksUtils.prototype.isInManifest = function(dataPackData, manifest) {
    
    if (manifest && manifest[dataPackData.VlocityDataPackType]) {
        for (var i = 0; i < manifest[dataPackData.VlocityDataPackType].length; i++)
        {
            var man = manifest[dataPackData.VlocityDataPackType][i];

            if (typeof man == 'object') {
                var isMatching = true;

                Object.keys(man).forEach(function(key) {
                    if (man[key] != dataPackData[key]) {
                        isMatching = false;
                    }
                });

                if (isMatching) {
                    return isMatching;
                }
            } else if (man == dataPackData.Id) {
                return true;
            }
        }
    }

    return false;
}

DataPacksUtils.prototype.loadApex = async function(projectPath, filePath) {
    var possiblePaths = [
        path.join(projectPath, filePath),
        path.join(__dirname, '..', 'apex', filePath),
        filePath
    ];

    var apexFilePath = possiblePaths.find(apexFilePath => 
        this.vlocity.datapacksutils.fileExists(apexFilePath));

    if (!apexFilePath) {
        throw 'The specified file \'' + filePath + '\' does not exist.';
    }

    VlocityUtils.report('Loading Apex', apexFilePath);

    var apexFileData = fs.readFileSync(apexFilePath, 'utf8');
    var includes = apexFileData.match(/\/\/include(.*?);/gi);
   
    var includedClasses = [];

    if (includes) {
        var srcdir = path.dirname(apexFilePath);

        for (var replacement of includes) {    
            var className = replacement.match(/\/\/include(.*?);/i)[1].trim();  
            let apexClassLoaded = await this.loadApex(srcdir, className);

            includedClasses.push({
                replacement: replacement,
                fileData: apexClassLoaded
            });
        }
    }

    for (var classInfo of includedClasses) {
        apexFileData = apexFileData.replace(classInfo.replacement, classInfo.fileData);
    }

    return apexFileData;
};

DataPacksUtils.prototype.splitApex = function(apexFileData, currentContextData) {
    // This function splits APEX in multiple chuncks so that the can be executed as anon apex
    // 16,088 is the limit according to a topic on SO
    const MAX_ANON_APEX_SIZE = 10000; 

    var formatApex = (data, contextData) => data
        .replace(/CURRENT_DATA_PACKS_CONTEXT_DATA/g, JSON.stringify(contextData))
        .replace(/%vlocity_namespace%/g, this.vlocity.namespace)
        .replace(/vlocity_namespace/g, this.vlocity.namespace);

    var formattedApex = [];
    var intContextData = [];
    currentContextData = currentContextData || [];
   
    for(var i = 0; i < currentContextData.length; i++) {
        var isLastItem = (i+1) == currentContextData.length;
        var apex = formatApex(apexFileData, intContextData.concat(currentContextData[i]));

        if (apex.length > MAX_ANON_APEX_SIZE) {
            if (intContextData.length == 0) {
                 throw 'Your APEX is to big to be executed anonymously.';
             }
             formattedApex.push(formatApex(apexFileData, intContextData));
             intContextData = [];
             i--; // try agin to fit this context in the next Anon apex chunck
        } else if (isLastItem) {
            formattedApex.push(apex);
        } else {
            intContextData.push(currentContextData[i]);
        }
    }

    if (currentContextData.length == 0) {
        formattedApex.push(formatApex(apexFileData, currentContextData));
    }

    return formattedApex;
};

DataPacksUtils.prototype.runApex = async function(projectPath, filePaths, currentContextData) {
    var self = this;
    filePaths = Array.isArray(filePaths) ? filePaths : [ filePaths ];

    for (var filePath of filePaths) {

        let loadedApex = await self.loadApex(projectPath, filePath);

        let apexChunks = self.splitApex(loadedApex, currentContextData);

        for (var apexChunk of apexChunks) {
            try {
                let res = await self.vlocity.jsForceConnection.tooling.executeAnonymous(apexChunk);
            
                if (!res || res.success === true) {
                    VlocityUtils.success('Apex Success', filePath);
                    continue;
                }

                if (res.exceptionStackTrace) {
                    VlocityUtils.error('APEX Exception StackTrace', res.exceptionStackTrace);
                }

                if (res.compileProblem) {
                    VlocityUtils.error('APEX Compilation Error', res.compileProblem);
                    
                } 

                if (res.exceptionMessage) {
                    VlocityUtils.error('APEX Exception Message', res.exceptionMessage);
                }

                throw res;
            } catch (err) {
                throw `Apex Error >> ${err} APEX code failed to execute but no exception message was provided`;
            }
        }
    }
};

DataPacksUtils.prototype.onEvent = async function(event, dataPack, jobInfo) {

    var eventHandler = this.getEventHandler(dataPack.VlocityDataPackType, event);

    if (eventHandler) {
        await this.runJavaScript(jobInfo.projectPath, eventHandler, dataPack, jobInfo);
    }
}

DataPacksUtils.prototype.runJavaScript = async function(projectPath, filePath, currentContextData, jobInfo) {
    var self = this;

    let promise = await new Promise((resolve) => {
        var pathToRun = path.join(projectPath, filePath);

        var defaultJSPath = path.resolve(path.join(__dirname, '..', 'javascript', filePath));

        if (!self.fileExists(pathToRun) && self.fileExists(defaultJSPath)) {
            pathToRun = defaultJSPath;
        }

        pathToRun = path.resolve(pathToRun);
        if (!self.runJavaScriptModules[pathToRun]) {
            self.runJavaScriptModules[pathToRun] = require(pathToRun);
        }

        self.runJavaScriptModules[pathToRun](self.vlocity, currentContextData, jobInfo, resolve);
    });

    return promise;
};

DataPacksUtils.prototype.getFieldLabel = async function(sObject, fieldApiName) {
    var self = this;

    if (self.vlocity.namespace == '%vlocity_namespace%') {
        return null;
    }

    let promise = await new Promise((resolve, reject) => {

        if (!self.fieldLabels[sObject]) {

            self.fieldLabels[sObject] = self.getExpandedDefinition(null, sObject, 'FieldLabels') || {};

            self.vlocity.jsForceConnection.sobject(sObject.replace('%vlocity_namespace%', self.vlocity.namespace)).describe(function(err, meta) {

                if (meta) {
                    self.objectLabels[sObject] = meta.label;

                    meta.fields.forEach(field => {
                        self.fieldLabels[sObject][field.name.replace(self.vlocity.namespace, '%vlocity_namespace%')] = field.label;
                    });

                    resolve(self.generateFieldLabel(sObject, fieldApiName)); 
                } else {
                    resolve(null); 
                }
            });
        } else {
            resolve(self.generateFieldLabel(sObject, fieldApiName));
        }       
    });

    return promise; 
}

DataPacksUtils.prototype.generateFieldLabel = function(sObject, fieldApiName) {

    if (this.fieldLabels[sObject][fieldApiName]) {
        return this.fieldLabels[sObject][fieldApiName];
    }

    if (!fieldApiName) {
        return null;
    }
 
    var finalFieldName = '';

    for (var fieldSplit of fieldApiName.split('.')) {

        if (this.fieldLabels[sObject][fieldSplit]) {
            fieldSplit = this.fieldLabels[sObject][fieldSplit];
        } else if (this.dataPacksExpandedDefinition.FieldLabels[sObject] && this.dataPacksExpandedDefinition.FieldLabels[sObject][fieldSplit]) {
            fieldSplit = this.dataPacksExpandedDefinition.FieldLabels[sObject][fieldSplit];
        } else if (this.dataPacksExpandedDefinition.FieldLabels.All[fieldSplit]) {
            fieldSplit = this.dataPacksExpandedDefinition.FieldLabels.All[fieldSplit];
        }

        if (!finalFieldName) {
            finalFieldName = fieldSplit;
        } else {
            finalFieldName += ' - ' + fieldSplit;
        }
    }

    return finalFieldName.replace('%vlocity_namespace%__', '');
}

DataPacksUtils.prototype.hashCode = function(toHash) {
    return DataPacksUtils.hashCode(toHash);
}

DataPacksUtils.hashCode = function(toHash) {
    var hash = 0, i, chr;

    if (toHash.length === 0) return hash;

    for (i = 0; i < toHash.length; i++) {
        chr   = toHash.charCodeAt(i);
        hash  = ((hash << 5) - hash) + chr;
        hash |= 0; // Convert to 32bit integer
    }

    return hash;
};

DataPacksUtils.prototype.guid = function() {
    function s4() {
        return Math.random().toString(16).substring(2, 5);
    }

    return s4() + s4() + '-' + s4() + s4() + '-' + s4() + s4() + '-' +
    s4() + s4() + '-' + s4() + s4() + s4();
};

DataPacksUtils.prototype.updateRecordReferences = function(record) {
    var self = this;

    delete record.attributes;

    try {

        Object.keys(record).forEach(function(field) {
            if (record[field] != null && typeof record[field] == "object" && !Array.isArray(record[field])) {
 
                delete record[field].attributes;

                self.updateRecordReferences(record[field]);

                var referenceField = self.endsWith(field, '__r') ?  field.replace('__r', '__c') : field + 'Id';
                record[referenceField] = record[field];
            }
        });
    } catch (e) {
       VlocityUtils.error('Error', e);
    }
};

DataPacksUtils.prototype.getAllReferenceFields = async function(sObjectType) {

    if (this.vlocity.username && !this.allReferenceFieldsByType[sObjectType]) {

        this.allReferenceFieldsByType[sObjectType] = [];

        try {
            var metadata = await this.vlocity.deltacheck.getSObjectMetadata(sObjectType);

            if (metadata) {
                for (var fieldName in metadata.fieldsDefinitionsMap) {
                    if (metadata.fieldsDefinitionsMap[fieldName].type == 'reference') {
                        this.allReferenceFieldsByType[sObjectType].push(fieldName);
                    }
                }
            } else {
                VlocityUtils.error('Meatdata Not Found', sObjectType);
            }

        } catch (e) {
            VlocityUtils.error(e);
        }
    }
        
    return this.allReferenceFieldsByType[sObjectType];
}

DataPacksUtils.prototype.removeUnhashableFields = function(dataPackType, dataPackData) {
    var self = this;

    if (dataPackData && dataPackData.VlocityRecordSObjectType) {

        var unhashableFields = self.getUnhashableFields(dataPackType, dataPackData.VlocityRecordSObjectType);

        if (unhashableFields) {
            unhashableFields.forEach(function(field) {

                try {
                    if (field.indexOf('.') != -1) {
                        var rootField = field.substring(0, field.indexOf('.'));

                        var subField = field.substr(field.indexOf('.')+1);
                        if (dataPackData[rootField]) {
                            var parsedField = JSON.parse(dataPackData[rootField]);
                            
                            if (parsedField[subField]) {
                                delete parsedField[subField];

                                dataPackData[rootField] = stringify(parsedField);
                            }
                        }
                    } else {
                        delete dataPackData[field];
                    }
                } catch (e) {
                    VlocityUtils.error('Error Removing Unhashable Field', field);
                }
            });
        }

        var filterFields = self.getFilterFields(dataPackType, dataPackData.VlocityRecordSObjectType);

        if (filterFields) {
            filterFields.forEach(function(field) {
                delete dataPackData[field];
            });
        }

        delete dataPackData.VlocityMatchingRecordSourceKey;
        delete dataPackData.VlocityRecordSourceKey;
        delete dataPackData.VlocityRecordSourceKeyOriginal;
        delete dataPackData.VlocityLookupRecordSourceKey;
        delete dataPackData.VlocityDataPackType;
        delete dataPackData.Id;

        Object.keys(dataPackData).forEach(function(childDataKey) {

            var childData = dataPackData[childDataKey];

            if (!childData || childDataKey.indexOf('.') != -1) {
                delete dataPackData[childDataKey];
            } else if (Array.isArray(childData)) {
                childData.forEach(function(child) {
                    self.removeUnhashableFields(dataPackType, child);
                });
            } else if (typeof childData === 'object') {
                self.removeUnhashableFields(dataPackType, childData);
            } else if (typeof childData === 'string') {
                try {
                    // Remove extra line endings if there 
                    dataPackData[childDataKey] = stringify(JSON.parse(dataPackData[childDataKey]));
                } catch (e) {
                    // Can ignore
                }
            }
        });
    }
}

DataPacksUtils.prototype.getDisplayName = function(dataPack) {
    var name = '';
    var self = this;

    if (dataPack.VlocityDataPackRelationshipType == 'Children') {
        return 'Child Records For ' + dataPack.VlocityDataPackName;
    }

    var dataPackType = dataPack.VlocityDataPackType;
    var dataPackKey;
    
    if (dataPack.VlocityDataPackKey) {
        dataPackKey = dataPack.VlocityDataPackKey.substring(dataPack.VlocityDataPackKey.indexOf('/') + 1);
    } else if (dataPack.VlocityDataPackKeyForManifest) {
        dataPackKey = dataPack.VlocityDataPackKeyForManifest.substring(dataPack.VlocityDataPackKeyForManifest.indexOf('/') + 1);
    } else if (dataPack.VlocityRecordSourceKey) {
        dataPackKey = dataPack.VlocityRecordSourceKey.substring(dataPack.VlocityRecordSourceKey.indexOf('/') + 1);
    }

    if (dataPack.VlocityDataPackData) {
        var dataField = self.vlocity.datapacksutils.getDataField(dataPack);

        dataPack = dataPack.VlocityDataPackData[dataField][0];
    }

    self.getExpandedDefinition(dataPackType, dataPack.VlocityRecordSObjectType, 'DisplayName').forEach(function(field) {
        if (dataPack[field]) {
            if (name) {
                name += '_';
            }

            name += dataPack[field] ;
        }
    });

    if (!name) {
        name = dataPackKey;
    }
    
    if (dataPackKey && name.indexOf(dataPackKey) == -1) {
        name += ' (' + dataPackKey + ')';
    }


    return name;
}

DataPacksUtils.prototype.getSingleSObjectHash = function(dataPackType, dataPack) {
    var self = this;

    var dataPackData = JSON.parse(JSON.stringify(dataPack));

    var unhashableFields = self.getUnhashableFields(dataPackType, dataPackData.VlocityRecordSObjectType);

    if (unhashableFields) {
        unhashableFields.forEach(function(field) {
            delete dataPackData[field];
        });
    }

    var filterFields = self.getFilterFields(dataPackType, dataPackData.VlocityRecordSObjectType);

    if (filterFields) {
        filterFields.forEach(function(field) {
            delete dataPackData[field];
        });
    }

    delete dataPackData.VlocityMatchingRecordSourceKey;
    delete dataPackData.VlocityRecordSourceKey;
    delete dataPackData.VlocityRecordSourceKeyOriginal;
    delete dataPackData.VlocityLookupRecordSourceKey;
    delete dataPackData.VlocityDataPackType;
    delete dataPackData.Id;

    Object.keys(dataPackData).forEach(function(childDataKey) {

        var childData = dataPackData[childDataKey];

        if (Array.isArray(childData)) {
            delete dataPackData[childDataKey];
        } else if (dataPackData[childDataKey] instanceof Object) {
            delete dataPackData[childDataKey].VlocityMatchingRecordSourceKey;
            delete dataPackData[childDataKey].VlocityRecordSourceKey;
            delete dataPackData[childDataKey].VlocityRecordSourceKeyOriginal;
            delete dataPackData[childDataKey].VlocityLookupRecordSourceKey;
            delete dataPackData[childDataKey].VlocityDataPackType;
            delete dataPackData[childDataKey].Id;
        }
    });

    return self.hashCode(stringify(dataPackData));
}

DataPacksUtils.prototype.getDataPackHashable = async function(dataPack, jobInfo) {
    var self = this;

    var clonedDataPackData = JSON.parse(JSON.stringify(dataPack));

    await self.vlocity.datapacksexpand.preprocessDataPack(clonedDataPackData, jobInfo);

    // Remove these as they would not be real changes
    clonedDataPackData.VlocityDataPackParents = null;
    clonedDataPackData.VlocityDataPackAllRelationships = null;

    var dataField = self.getDataField(clonedDataPackData);

    if (dataField) {
        clonedDataPackData.VlocityDataPackData[dataField].forEach(function(sobjectData) {
            self.removeUnhashableFields(clonedDataPackData.VlocityDataPackType, sobjectData);
        });
    }

    return clonedDataPackData;
};

DataPacksUtils.prototype.getAllIndividualSObjectsInDataPack = function(dataPackData) {
    var self = this;
    var allSObjects = [];

    if (dataPackData && dataPackData.VlocityRecordSObjectType) {

        var individualSObject = JSON.parse(JSON.stringify(dataPackData));
        allSObjects.push(individualSObject);

        Object.keys(dataPackData).forEach(function(childDataKey) {

            var childData = dataPackData[childDataKey];

            if (Array.isArray(childData)) {

                delete individualSObject[childDataKey];
                childData.forEach(function(child) {
                    child.VlocityDiffParentKey = individualSObject.VlocityRecordSourceKey;
                    child.VlocityDiffParentField = childDataKey;
                    allSObjects = allSObjects.concat(self.getAllIndividualSObjectsInDataPack(child));
                });
            }
        });
    }

    return allSObjects;
};

DataPacksUtils.prototype.getFieldDiffs = async function(allSourceDataPacks, allTargetDataPacks, jobInfo) {
    var allKeys = Object.keys(allSourceDataPacks);
    var allDiffsPromises = [];

    for (var dataPackKey of allKeys) {
        allDiffsPromises.push(this.getFieldDiffsIndividual(allSourceDataPacks, allTargetDataPacks, jobInfo, dataPackKey));
    }

    await Promise.all(allDiffsPromises);
}

DataPacksUtils.prototype.getFieldDiffsIndividual = async function(allSourceDataPacks, allTargetDataPacks, jobInfo, dataPackKey) {
    try {
        var sourceDataPack = allSourceDataPacks[dataPackKey];
        var targetDataPack = allTargetDataPacks[dataPackKey];
        var dataPackType = dataPackKey.substring(0, dataPackKey.indexOf('/'));

        // Backwards Compatibility = Always run diff
        if (!sourceDataPack.dataHashCode) {
            sourceDataPack.dataHashCode = Math.random();
        }

        if (targetDataPack && !targetDataPack.dataHashCode) {
            targetDataPack.dataHashCode = Math.random();
        }
       
        jobInfo.sourceHashCodes[dataPackKey] = sourceDataPack.dataHashCode;
        
        if (targetDataPack && targetDataPack.dataHashCode) {
            jobInfo.targetHashCodes[dataPackKey] = targetDataPack.dataHashCode;
        }

        if (!targetDataPack) {
            jobInfo.currentStatus[dataPackKey] = 'Ready';   
            jobInfo.diffType[dataPackKey] = 'New';
        } else if (sourceDataPack.dataHashCode == targetDataPack.dataHashCode) {
            jobInfo.currentStatus[dataPackKey] = 'Success';   
            jobInfo.diffType[dataPackKey] = 'Unchanged';
        } else {
            jobInfo.currentStatus[dataPackKey] = 'Ready';   
            jobInfo.diffType[dataPackKey] = 'Changed';
        }

        var existingCompare = jobInfo.existingComparison[dataPackKey];

        if (existingCompare 
            && existingCompare.sourceHashCode
            && existingCompare.sourceHashCode == sourceDataPack.dataHashCode 
            && ((targetDataPack == null && existingCompare.targetHashCode == null)
                || (existingCompare.targetHashCode && targetDataPack && existingCompare.targetHashCode == targetDataPack.dataHashCode))) {
            
            jobInfo.sObjectsInfo[dataPackKey] = existingCompare.SObjects;
            jobInfo.currentStatus[dataPackKey] = existingCompare.VlocityDataPackStatus;   
            jobInfo.diffType[dataPackKey] = existingCompare.DiffType;
            
            return;
        }

        if (sourceDataPack.hasOwnProperty('SFDXData')) {
            this.getDiffsForSfdx(jobInfo, jobInfo.diffType[dataPackKey], sourceDataPack, targetDataPack);
        } else {
            
            var dataPackStatus = jobInfo.diffType[dataPackKey];

            if (!jobInfo.diffType) {
                dataPackStatus = 'New';
            }

            var allFieldDiffsByRecordSourceKey = [];

            var dataField = this.getDataField(sourceDataPack);

            var allSourceSObjects = this.getAllIndividualSObjectsInDataPack(sourceDataPack.VlocityDataPackData[dataField][0]);

            if (dataPackStatus == 'Changed') {
                
                var allTargetSObjects = [];

                if (targetDataPack) {
                    allTargetSObjects = this.getAllIndividualSObjectsInDataPack(targetDataPack.VlocityDataPackData[dataField][0]);
                }

                // Target are most important 
                var targetDiffKeys = this.getAllByUniqueKey(sourceDataPack.VlocityDataPackType, allTargetSObjects);

                // For Target need to keep track of Unique
                var sourceDiffKeys = this.getAllByUniqueKey(sourceDataPack.VlocityDataPackType, allSourceSObjects, targetDiffKeys);

                var foundTarget = new Set();

                for (var uniqueKey in sourceDiffKeys) {

                    var obj = { editable: this.deserializeAll(JSON.parse(JSON.stringify(sourceDiffKeys[uniqueKey])))};

                    if (obj.editable == false) {
                        continue;
                    }
                    
                    var diffParentKey = obj.editable.VlocityDiffParentKey;
                    var diffParentField = obj.editable.VlocityDiffParentField;

                    delete obj.editable.VlocityDiffParentKey;
                    delete obj.editable.VlocityDiffParentField;

                    if (targetDiffKeys[uniqueKey]) {
                        foundTarget.add(targetDiffKeys[uniqueKey].VlocityRecordSourceKey);
                    }

                    obj.diffType = targetDiffKeys[uniqueKey] ? "Changed" : 'New';
                    obj.fieldDiffs = await this.getFieldDiffsForSObjects(sourceDataPack.VlocityDataPackType, sourceDiffKeys[uniqueKey], targetDiffKeys[uniqueKey] || {});
                    obj.VlocityRecordSourceKey = obj.editable.VlocityRecordSourceKey;
                    obj.VlocityDataPackKey = dataPackKey;
                    obj.VlocityDataPackType = dataPackType;

                    if (obj.fieldDiffs.length != 0) {
                        allFieldDiffsByRecordSourceKey.push(obj);
                    }
                }

                for (var obj of allTargetSObjects) {

                    var diffParentKey = obj.VlocityDiffParentKey;
                    var diffParentField = obj.VlocityDiffParentField;

                    delete obj.VlocityDiffParentKey;
                    delete obj.VlocityDiffParentField;

                    if (!foundTarget.has(obj.VlocityRecordSourceKey)) {
                        let deletedObj = {
                            editable: this.deserializeAll(JSON.parse(JSON.stringify(obj))),
                            diffType: 'Deleted',
                            VlocityDiffParentKey: diffParentKey,
                            VlocityDiffParentField: diffParentField,
                            VlocityRecordSourceKey: obj.VlocityRecordSourceKey,
                            VlocityDataPackKey: dataPackKey,
                            VlocityDataPackType: dataPackType
                        };

                        deletedObj.fieldDiffs = await this.getFieldDiffsForSObjects(sourceDataPack.VlocityDataPackType, {}, obj, true);

                        allFieldDiffsByRecordSourceKey.push(deletedObj);
                    }
                }
            }

            var primaryDataPack = allSourceSObjects[0];

            if (allFieldDiffsByRecordSourceKey.length == 0 
                || allFieldDiffsByRecordSourceKey[0].editable.VlocityRecordSourceKey != primaryDataPack.VlocityRecordSourceKey) {

                allFieldDiffsByRecordSourceKey.unshift({ 
                    editable: this.deserializeAll(JSON.parse(JSON.stringify(primaryDataPack))),
                    diffType: 'Unchanged',
                    fieldDiffs: [],
                    VlocityDataPackKey: dataPackKey,
                    VlocityDataPackType: dataPackType
                });
            }

            await this.getTitleFieldsForDataPack(sourceDataPack, targetDataPack, allFieldDiffsByRecordSourceKey[0]);

            for (var obj of allFieldDiffsByRecordSourceKey) {

                if (!obj.VlocitySObjectRecordLabel) {
                    var labelFields = this.getRecordLabel(null, obj.editable.VlocityRecordSObjectType);

                    var label = this.objectLabels[obj.editable.VlocityRecordSObjectType];

                    if (!label) {
                        label = obj.editable.VlocityRecordSObjectType
                    }

                    if (labelFields) {
                        for (labelField of labelFields) {
                            if (obj.editable[labelField]) {
                                label += ` / ${obj.editable[labelField]}`;
                            }
                        }
                    }
                    
                    obj.VlocitySObjectRecordLabel = label.replace('%vlocity_namespace%__', '');
                }
            }

            var titleObjects = await this.getTitleObjectsForDataPack(sourceDataPack, targetDataPack);

            if (titleObjects) {
                for (var i = titleObjects.length-1; i >= 0; i--) {
                    allFieldDiffsByRecordSourceKey.splice(1, 0, titleObjects[i]);
                }
            }

            jobInfo.sObjectsInfo[sourceDataPack.VlocityDataPackKey] = allFieldDiffsByRecordSourceKey;

            if (jobInfo.diffType[dataPackKey] == 'Changed') {
                jobInfo.currentStatus[dataPackKey] = 'Success';  
                jobInfo.diffType[dataPackKey] = 'Unchanged';

                for (var change of allFieldDiffsByRecordSourceKey) {
                    if (change.diffType == 'Changed' || change.diffType == 'New') {
                        jobInfo.diffType[dataPackKey] = 'Changed';
                        break;
                    }
                }
            }
        }
    } catch (e) {
        VlocityUtils.error('Diffing Error', dataPackKey, e);
        jobInfo.errors.push(`Diffing Error ${dataPackKey} ${e.stack}`);
    }
    
};

var ignoredFields = new Set([ 'VlocityRecordSourceKey',  'VlocityRecordSourceKeyOriginal', 'CurrencyIsoCode', 'VlocityRecordSObjectType', 'VlocityDataPackIsIncluded', 'VlocityDataPackType', 'VlocityDiffParentField', 'VlocityDiffParentKey' ]);
DataPacksUtils.prototype.getTitleFieldsForDataPack = async function(sourceDataPack, targetDataPack, diffObject) {

    let currentFieldDiffFields = [];

    for (var fieldDiff of diffObject.fieldDiffs) {
        currentFieldDiffFields.push(fieldDiff.field);
    }

    var dataField = this.getDataField(sourceDataPack);

    var sourcePrimarySObject = sourceDataPack.VlocityDataPackData[dataField][0];
    var targetPrimarySObject;
    
    if (targetDataPack) {
        targetPrimarySObject = targetDataPack.VlocityDataPackData[dataField][0];
    }

    var titleSettings = this.getTitleFields(sourceDataPack.VlocityDataPackType, sourcePrimarySObject.VlocityRecordSObjectType);

    var titleFields = [];

    for (var titleField of titleSettings) {
        titleFields.push({ field: titleField });
    }

    for (var i = titleFields.length-1; i >= 0; i--) {

        var fieldDiff = titleFields[i];
        var field = fieldDiff.field;

        if (currentFieldDiffFields.includes(field)) {
            continue;
        }

        var fieldType = fieldDiff.fieldType ? fieldDiff.fieldType : this.getFieldDisplayType(sourceDataPack.VlocityDataPackType, diffObject.editable.VlocityRecordSObjectType, field);
        let fieldLabel = await this.getFieldLabel(diffObject.editable.VlocityRecordSObjectType, field);

        var sourceValue = sourcePrimarySObject[field];
        var targetValue = targetPrimarySObject ? targetPrimarySObject[fieldDiff.field] : null;

        if (targetValue && sourceValue != targetValue) {
            diffObject.diffType = 'Changed';
        }

        diffObject.fieldDiffs.unshift({
            fieldImportance: 'Title',
            diffKey: this.guid(),
            fieldType: fieldType,
            status: (sourceValue == targetValue || targetValue == null) ? 'Title' : 'Changed',
            readOnly: (sourceValue == targetValue || targetValue == null),
            value: typeof sourceValue == 'object' ? stringify(sourceValue, { space: 4 }) : sourceValue,
            old: (targetValue && typeof targetValue == 'object') ? stringify(targetValue, { space: 4 }) : targetValue,
            field: field,
            label: fieldLabel ? fieldLabel : field.replace('%vlocity_namespace%', this.vlocity.namespace),
            VlocityRecordSourceKey: diffObject.editable.VlocityRecordSourceKey
        });
    }

    if (sourceDataPack.VlocityDataPackParents || (targetDataPack && targetDataPack.VlocityDataPackParents)) {
        var sourceParentsJSON = sourceDataPack && sourceDataPack.VlocityDataPackParents ? sourceDataPack.VlocityDataPackParents.join('\n') : '';
        var targetParentsJSON = targetDataPack && targetDataPack.VlocityDataPackParents ? targetDataPack.VlocityDataPackParents.join('\n') : null;

        var gitDiffForParents = this.getGitDiffs(targetParentsJSON || sourceParentsJSON, sourceParentsJSON, 'json', true);

        diffObject.fieldDiffs.push({
            fieldImportance: 'Title',
            fieldType: 'DisplayOnly',
            gitDiff: gitDiffForParents[0].diffString,
            diffKey: this.guid(),
            status: (targetParentsJSON == null || sourceParentsJSON == targetParentsJSON) ? 'Title' : 'Changed',
            value: sourceParentsJSON,
            old: targetParentsJSON,
            field: 'Related DataPacks',
            label: 'Related DataPacks',
            readOnly: true
        });
    }

    var sourceCounts = {};
    var targetCounts;
    this.countByType(sourceDataPack, sourceCounts);

    if (targetDataPack) {
        targetCounts = {};
        this.countByType(targetDataPack, targetCounts);
    }

    var allCounts = new Set(Object.keys(sourceCounts).concat(Object.keys(targetCounts || {})).sort());

    for (var countType of allCounts) {
        // Skip this type as it will always be 1
        if (countType == diffObject.editable.VlocityRecordSObjectType) {
            continue;
        }

        diffObject.fieldDiffs.push({
            fieldImportance: 'Title',
            fieldType: 'number',
            diffKey: this.guid(),
            status: (targetCounts == null || sourceCounts[countType] == targetCounts[countType]) ? 'Title' : 'Changed',
            value: sourceCounts[countType],
            old: (targetCounts && targetCounts[countType]) ? targetCounts[countType] : 0,
            field: `Total ${countType}`.replace('%vlocity_namespace%__', ''),
            label: `Total ${countType}`.replace('%vlocity_namespace%__', ''),
            readOnly: true
        });
    }
};


DataPacksUtils.prototype.getTitleObjectsForDataPack = async function(sourceDataPack, targetDataPack) {

    var titleObjects = [];

    // Dynamically get title field data from DataPackType Specific JavaScript classes
    var sourceTitleObjects = await this.handleDataPackEvent('createTitleObjects', sourceDataPack.VlocityDataPackType, { dataPackData: sourceDataPack });
    var targetTitleObjects;
    
    if (targetDataPack) {
        targetTitleObjects = await this.handleDataPackEvent('createTitleObjects', targetDataPack.VlocityDataPackType, { dataPackData: targetDataPack });
    }

    if (sourceTitleObjects) {

        for (var i = 0; i < sourceTitleObjects.length; i++) {

            var titleObjectForType = sourceTitleObjects[i];
            var sourceValue = sourceTitleObjects[i].value;
            var targetValue = targetTitleObjects && targetTitleObjects[i] ? targetTitleObjects[i].value : null;

            var titleObject = {
                editable: {
                    VlocityRecordSourceKey: titleObjectForType.VlocityRecordSourceKey,
                    VlocityRecordSObjectType: titleObjectForType.field,
                    VlocityRecordEditField: titleObjectForType.VlocityRecordEditField
                },
                diffType: targetValue == null ? 'New' : (targetValue != sourceValue ? 'Changed' : 'Unchanged'),
                isDisplayOnly: titleObjectForType.fieldType == 'DisplayOnly',
                fieldDiffs: [],
                VlocityDataPackKey: sourceDataPack.VlocityDataPackKey,
                VlocityDataPackType: sourceDataPack.VlocityDataPackType,
                VlocitySObjectRecordLabel: titleObjectForType.VlocitySObjectRecordLabel,
                VlocityRecordSourceKey: titleObjectForType.VlocityRecordSourceKey,
                VlocityRecordEditField: titleObjectForType.VlocityRecordEditField
            };

            if (titleObjectForType.fieldType == 'DisplayOnly') {
                titleObject.editable.TitleObjectDisplay = titleObjectForType.value;
            } else {
                titleObject.editable.TitleObjectCode = titleObjectForType.value;
            }
            
            var gitDiffForTitle = this.getGitDiffs(targetValue || sourceValue, sourceValue, 'json');

            for (var gitHunk of gitDiffForTitle) {
                
                titleObject.fieldDiffs.push({
                    fieldImportance: 'Title',
                    fieldType: titleObjectForType.fieldType,
                    status: gitHunk.hasDiffs ? 'Changed' : 'Title',
                    gitDiff: gitHunk.diffString,
                    value: typeof sourceValue == 'object' ? stringify(sourceValue, { space: 4 }) : sourceValue,
                    old: (targetValue && typeof targetValue == 'object') ? stringify(targetValue, { space: 4 }) : targetValue,
                    field: (titleObjectForType.fieldType == 'DisplayOnly' ? 'TitleObjectDisplay' : 'TitleObjectCode'),
                    diffKey: this.guid(),
                    revertHandler: titleObjectForType.revertHandler,
                    fieldKeyForDiff: titleObjectForType.field,
                    label: titleObjectForType.fieldLabel,
                    VlocityRecordSourceKey: titleObjectForType.VlocityRecordSourceKey,
                    VlocityDataPackKey: sourceDataPack.VlocityDataPackKey,
                    VlocityDataPackType: sourceDataPack.VlocityDataPackType,
                    VlocityRecordEditField: titleObjectForType.VlocityRecordEditField
                });
            }

            titleObjects.push(titleObject);
        }
    }

    return titleObjects;
}

DataPacksUtils.prototype.countByType = function(dataPackData, counts) {
    var self = this;

    if (dataPackData) {
        if (dataPackData.VlocityDataPackData) {
            var dataField = self.vlocity.datapacksutils.getDataField(dataPackData);

            if (dataField) {
                self.countByType(dataPackData.VlocityDataPackData[dataField][0], counts);
            }
        } else { 
            if (Array.isArray(dataPackData)) {
                dataPackData.forEach(function(childData) {
                    self.countByType(childData, counts);
                });
            } else if (dataPackData.VlocityDataPackType == 'SObject') {
                Object.keys(dataPackData).forEach(function(key) {
                    self.countByType(dataPackData[key], counts);
                });

                if (!counts[dataPackData.VlocityRecordSObjectType]) {
                    counts[dataPackData.VlocityRecordSObjectType] = 0;
                }

                counts[dataPackData.VlocityRecordSObjectType]++;
            }
        }
    }
};

DataPacksUtils.prototype.getFieldDiffsForSObjects = async function(dataPackType, sourceObject, targetObject, isDeleted) {
    var self = this;
    var fieldDiffs = [];

    var unhashableFields = this.getUnhashableFields(dataPackType, sourceObject.VlocityRecordSObjectType) || [];

    await this.handleDataPackEvent('hashSObjectData', dataPackType, { sobject: sourceObject });
    await this.handleDataPackEvent('hashSObjectData', dataPackType, { sobject: targetObject });

    var sObjectType = sourceObject.VlocityRecordSObjectType || targetObject.VlocityRecordSObjectType;
    var recordSourceKey = sourceObject.VlocityRecordSourceKey ? sourceObject.VlocityRecordSourceKey : targetObject.VlocityRecordSourceKey;

    let allFields = [];

    Object.keys(sourceObject).forEach((field) => {
        allFields.push(field);
    });

    Object.keys(targetObject).forEach((field) => {

        if (allFields.indexOf(field) == -1) {
            allFields.push(field);
        }
    });

    for (var i = 0; i < allFields.length; i++) {

        var field = allFields[i];

        var ignoreFieldDiffsForType = this.getIgnoreFieldDiffs(dataPackType, sourceObject.VlocityRecordSObjectType);

        if (!ignoredFields.has(field) 
        && !Array.isArray(sourceObject[field]) 
        && field.indexOf('.') == -1
        && unhashableFields.indexOf(field) == -1
        && ignoreFieldDiffsForType.indexOf(field) == -1
        && stringify(sourceObject) != stringify(targetObject)) {
            let sourceObjParsed;
            let targetObjParsed;

            try {
                if (typeof sourceObject[field] == 'string') {
                    sourceObjParsed = JSON.parse(sourceObject[field]);
                }

                if (typeof targetObject[field] == 'string') {
                    targetObjParsed = JSON.parse(targetObject[field]);
                }
            } catch (e) {
                // Should be ignorable
            }

            let fieldLabel = await this.getFieldLabel(sObjectType, field);
          
            if ((sourceObjParsed != null && typeof sourceObjParsed == 'object') 
                || (targetObjParsed != null && typeof targetObjParsed == 'object')) {

                if (Array.isArray(sourceObjParsed) || Array.isArray(targetObjParsed)) {
                    var stringifiedSource = sourceObjParsed ? stringify(sourceObjParsed, {space: 4}) : null; 
                    var stringifiedTarget = targetObjParsed ? stringify(targetObjParsed, {space: 4}) : null; 

                    if (stringifiedSource != stringifiedTarget) {

                        for (var diffHunk of this.getGitDiffs(stringifiedTarget, stringifiedSource, 'json')) {
                            fieldDiffs.push({
                                fieldImportance: this.getFieldImportance(dataPackType, sObjectType, field),
                                fieldType: this.getFieldDisplayType(dataPackType, sObjectType, field),
                                gitDiff: diffHunk.diffString,
                                diffKey: this.guid(),
                                status: isDeleted ? 'Deleted' : diffHunk.hasDiffs ? 'Changed' : 'Unchanged',
                                value: sourceObject[field],
                                old: targetObject[field],
                                field: field,
                                label: fieldLabel ? fieldLabel : field.replace('%vlocity_namespace%', self.vlocity.namespace),
                                VlocityRecordSourceKey: recordSourceKey,
                            });
                        }
                    }
                } else {
                    await self.setNestedFieldDiffs(sourceObjParsed || {}, targetObjParsed || {}, field, fieldDiffs, recordSourceKey,  sObjectType);
                }
                
                continue;
            }

            if ((sourceObject[field] != null && typeof sourceObject[field] == 'object') 
                || (targetObject[field] != null && typeof targetObject[field] == 'object')) {
                let sourceMatchingKey;
                let targetMatchingKey;

                if (sourceObject[field] != null && typeof sourceObject[field] == 'object') {
                    sourceMatchingKey = sourceObject[field].VlocityMatchingRecordSourceKey ? sourceObject[field].VlocityMatchingRecordSourceKey : sourceObject[field].VlocityLookupRecordSourceKey;
                }
               
                if (targetObject[field] != null && typeof targetObject[field] == 'object') {
                    targetMatchingKey = targetObject[field].VlocityMatchingRecordSourceKey ? targetObject[field].VlocityMatchingRecordSourceKey : targetObject[field].VlocityLookupRecordSourceKey;
                }
                
                if (sourceMatchingKey != targetMatchingKey) {
                    fieldDiffs.push({
                        fieldImportance: this.getFieldImportance(dataPackType, sObjectType, field),
                        diffKey: this.guid(),
                        fieldType: 'Reference',
                        status: isDeleted ? 'Deleted' : (targetMatchingKey ? (sourceMatchingKey == targetMatchingKey ? 'Unchanged' : 'Changed') : 'New'),
                        value: sourceMatchingKey,
                        old: targetMatchingKey,
                        field: field,
                        label: fieldLabel ? fieldLabel : field.replace('%vlocity_namespace%', self.vlocity.namespace),
                        VlocityRecordSourceKey: recordSourceKey
                    });
                }
            } else {

                var sourceObjectValue = sourceObjParsed ? stringify(sourceObjParsed, { space: 4 }) : sourceObject[field];
                var targetObjectValue = targetObjParsed ? stringify(targetObjParsed, { space: 4 }) : targetObject[field];    

                var fieldStatus;
                
                if (targetObject[field] != null) {
                    if (sourceObjectValue == null) {
                        fieldStatus = 'Deleted';
                    } else {
                        fieldStatus = (sourceObjectValue == targetObjectValue) ? 'Unchanged' : 'Changed'
                    }
                } else {
                    fieldStatus = 'New';
                }

                if (fieldStatus == 'Unchanged') {
                    continue;
                } else if (fieldStatus == 'New' && sourceObject[field] == "") {
                    continue;
                }  else if (fieldStatus == 'Deleted' && targetObject[field] == "") {
                    continue;
                }

                var expansionType = self.vlocity.datapacksutils.getExpandedDefinition(dataPackType, sObjectType, field);

                if (expansionType && expansionType.FileType) {
                    expansionType = expansionType.FileType;
                }
                for (var diffHunk of this.getGitDiffs(targetObjectValue, sourceObjectValue, expansionType)) {

                    fieldDiffs.push({
                        fieldImportance: this.getFieldImportance(dataPackType, sObjectType, field),
                        fieldType: this.getFieldDisplayType(dataPackType, sObjectType, field),
                        gitDiff: diffHunk.diffString,
                        diffKey: this.guid(),
                        status: diffHunk.hasDiffs == true ? 'Changed' : fieldStatus,
                        value: sourceObjectValue,
                        old: fieldStatus == 'Unchanged' ? null : targetObjectValue,
                        field: field,
                        label: fieldLabel ? fieldLabel : field.replace('%vlocity_namespace%', self.vlocity.namespace),
                        VlocityRecordSourceKey: recordSourceKey,
                    });
                }
            }
        }
    }

    fieldDiffs.sort(function(a, b) {
        return self.fieldDiffsSortBy(a, b);
    });

    return fieldDiffs;
};

var blacklistedTypes = ['svg'];

DataPacksUtils.prototype.getDiffsForSfdx = function(jobInfo, diffType, sourceSfdxObject, targetSfdxObject) {
    let thisDiff = [ null ];

    if (targetSfdxObject == null) {
        targetSfdxObject = {};
    }

    if (sourceSfdxObject == null) {
        sourceSfdxObject = {};
    }

    var type = targetSfdxObject.SFDXDataType ? targetSfdxObject.SFDXDataType : sourceSfdxObject.SFDXDataType;

    if (type == 'utf8') {
        type = path.extname(sourceSfdxObject.VlocityDataPackKey).substr(1);

        if (blacklistedTypes.includes(type)) {
            thisDiff = [ { diffString: this.getNoDiffs('(Hidden)', 'txt', diffType), hasDiffs: false }];
        } else if (sourceSfdxObject.SFDXData.length > 500000) {
            thisDiff = [ { diffString: this.getNoDiffs('(Hidden Too Large)', 'txt', diffType), hasDiffs: false }];
        } else {
            VlocityUtils.report('Diffing...', sourceSfdxObject.VlocityDataPackKey);
            thisDiff = this.getGitDiffs(targetSfdxObject.SFDXData || sourceSfdxObject.SFDXData, sourceSfdxObject.SFDXData, type);
            VlocityUtils.report('Diffed', sourceSfdxObject.VlocityDataPackKey);
        }
    } else {
        thisDiff =  [ { diffString: this.getNoDiffs('(Hidden)', 'txt', diffType), hasDiffs: false }];
    }

    var fieldDiffs = [];
    for (var diffHunk of thisDiff) {
        fieldDiffs.push({
            VlocityRecordSourceKey: sourceSfdxObject.VlocityDataPackKey,
            field: "SFDXData",
            diffKey: this.guid(),
            gitDiff: diffHunk.diffString,
            label: "Data",
            status: diffHunk.hasDiffs ? 'Changed' : 'Unchanged',
            dataType: sourceSfdxObject.SFDXDataType,
            hideFieldName: true
        });
    }

    jobInfo.sObjectsInfo[sourceSfdxObject.VlocityDataPackKey] = [{
        VlocitySObjectRecordLabel: sourceSfdxObject.VlocityDataPackKey,
        diffType: diffType,
        editable: {
            SFDXData: sourceSfdxObject.SFDXData,
            VlocityRecordSourceKey: sourceSfdxObject.VlocityDataPackKey
        }, 
        VlocityRecordSourceKey: sourceSfdxObject.VlocityDataPackKey,
        fieldDiffs: fieldDiffs
    }];
};

DataPacksUtils.prototype.deserializeAll = function(obj) {

    for (var field in obj) {

        if (typeof obj[field] === 'string' && (obj[field][0] == '[' || obj[field][0] == '{')) {
            try {
                obj[field] = JSON.parse(obj[field]);
            } catch (e) {
                
            }
        }
    }

    return obj;
}


DataPacksUtils.prototype.fieldDiffsSortBy = function(obj1, obj2) {

    if (obj1.priority && !obj2.priority) {
        return -1;
    } else if (obj2.priority && !obj1.priority) {
        return 1;
    } else if (obj1.priority && obj2.priority && obj1.priority != obj2.priority) {
        return obj1.priority > obj2.priority ? -1 : 1;
    } else if (obj1.label != obj2.label) {
        return obj1.label < obj2.label ? -1 : 1;
    }

    return 0;
};

DataPacksUtils.prototype.getFieldImportance = function(dataPackType, sObjectType, field) {
    if (!this.fieldImportance[dataPackType]) {
        this.fieldImportance[dataPackType] = {};
    }

    if (!this.fieldImportance[dataPackType][sObjectType]) {
        this.fieldImportance[dataPackType][sObjectType] = {};

        var importances = this.getExpandedDefinition(dataPackType, sObjectType, 'FieldImportance') || {};

        for (var imp in importances) {
            for (var field of importances[imp]) {
                this.fieldImportance[dataPackType][sObjectType][field] = imp;
            }
        }
    }

    return this.fieldImportance[dataPackType][sObjectType][field] || 'Low'; 
} 

DataPacksUtils.prototype.getFieldDisplayType = function(dataPackType, sObjectType, fieldPath) {
    var diffFields = this.getExpandedDefinition(dataPackType, sObjectType, 'FieldDisplayType') || {};
    
    return diffFields[fieldPath];
}

DataPacksUtils.prototype.setNestedFieldDiffs = async function(sourceObject, targetObject, currentPath, fieldDiffs,  vlocityRecordSourceKey, sObjectType) {
    var self = this;

    for (var field in sourceObject) {
        var fieldPath = `${currentPath}.${field}`;

        var unhashableFields = this.getUnhashableFields(null, sObjectType) || [];

        if (unhashableFields.indexOf(fieldPath) != -1) {
            continue;
        }

        let fieldLabel = await self.getFieldLabel(sObjectType, fieldPath);
        var fieldType = this.getFieldDisplayType(null, sObjectType, fieldPath);

        var sourceObjectValue = typeof sourceObject[field] == 'object' ? stringify(sourceObject[field],  { space: 4 }) :  sourceObject[field];
        var targetObjectValue = typeof targetObject[field] == 'object' ? stringify(targetObject[field],  { space: 4 }) :  targetObject[field];

        if (sourceObject[field] != targetObject[field]
            && sourceObjectValue != targetObjectValue) {

            if (typeof sourceObject[field] == 'object' 
            && !Array.isArray(sourceObject[field])
            && fieldType !== 'object') {
                await self.setNestedFieldDiffs(sourceObject[field], targetObject[field] || {}, `${currentPath}.${field}`, fieldDiffs, vlocityRecordSourceKey, sObjectType);
            } else if (Array.isArray(sourceObject[field]) || Array.isArray(targetObject[field])) {
                if (sourceObjectValue != targetObjectValue) {

                    for (var diffHunk of this.getGitDiffs(targetObjectValue, sourceObjectValue, fieldType ? fieldType : 'json')) {
                        fieldDiffs.push({
                            //fieldImportance: this.getFieldImportance(dataPackType, sObjectType, field),
                            fieldType: 'json' ,
                            gitDiff: diffHunk.diffString,
                            diffKey: this.guid(),
                            status: diffHunk.hasDiffs ? 'Changed' : 'Unchanged',
                            //value: sourceObject[field],
                            //old: targetObject[field],
                            field: field,
                            label: fieldLabel ? fieldLabel : fieldPath.replace('%vlocity_namespace%', self.vlocity.namespace),
                            VlocityRecordSourceKey: vlocityRecordSourceKey
                        });
                    }
                }
            } else if (targetObject[field] != null 
            && sourceObjectValue != targetObjectValue) {

                for (var diffHunk of this.getGitDiffs(targetObjectValue, sourceObjectValue, 'json')) {
                    fieldDiffs.push({
                        gitDiff: diffHunk.diffString,
                        diffKey: this.guid(),
                        status: diffHunk.hasDiffs ? 'Changed' : 'Unchanged',
                        value: diffHunk.diffString == null ? sourceObjectValue : '',
                        old:  diffHunk.diffString == null ? targetObjectValue : '',
                        field: fieldPath,
                        label: fieldLabel ? fieldLabel : fieldPath.replace('%vlocity_namespace%__', ''),
                        VlocityRecordSourceKey: vlocityRecordSourceKey
                    });
                }
            } else if (sourceObject[field] != '' 
            && sourceObject[field] != null 
            && sourceObjectValue != '{\n}') {

                fieldDiffs.push({
                    status: 'New',
                    value: sourceObjectValue,
                    diffKey: this.guid(),
                    field: fieldPath,
                    label: fieldLabel ? fieldLabel : fieldPath.replace('%vlocity_namespace%__', ''),
                    VlocityRecordSourceKey: vlocityRecordSourceKey
                });
            }
        }
    }
}

DataPacksUtils.prototype.getAllByUniqueKey = function(dataPackType, sObjects, validKeys) {
    var self = this;
    var allByUniqueKeys = {};

    for (var sObject of sObjects) {

        if (sObject.VlocityRecordSObjectType == '%vlocity_namespace%__OverrideDefinition__c') {
            var i = 0;
        }
        var diffKeys = self.getDiffKeys(dataPackType, sObject.VlocityRecordSObjectType);
        
        if (diffKeys) {
            var addedValidKey = false;
            var i = 1;

            while (diffKeys[i]) {
                var diffKey = sObject.VlocityRecordSObjectType + '|';

                for (var field of diffKeys[i]) {
                    let value;

                    if (field.indexOf('_') == 0) {
                        value = field;
                    } else if (field.indexOf('.') != -1) {
                        var currentObj = JSON.parse(JSON.stringify(sObject));

                        var splitFields = field.split('.');
                        for (var j = 0; j < splitFields.length; j++) {
                            nestedField = splitFields[j];

                            if (j == splitFields.length-1) {
                                value = currentObj[nestedField];
                            } else if (currentObj[nestedField]) {
                                if (typeof currentObj[nestedField] == 'string') {
                                    currentObj = JSON.parse(currentObj[nestedField]);
                                } else {
                                    currentObj = currentObj[nestedField];
                                }
                            } else {
                                break;
                            }
                        }
                    } else {
                        value = sObject[field];
                    }

                    if (value && typeof value == 'object') {
                        value = value.VlocityMatchingRecordSourceKey ? value.VlocityMatchingRecordSourceKey : value.VlocityLookupRecordSourceKey
                    }

                    if (value == null || value == "") {
                        diffKey = null;
                        break;
                    }

                    diffKey += field + '|' + value + '|';
                }

                if (validKeys && !validKeys[diffKey]) {
                    diffKey = null;
                }

                if (diffKey) {
                    if (allByUniqueKeys[diffKey] == null) {
                        allByUniqueKeys[diffKey] = sObject;

                        if (validKeys) {
                            addedValidKey = true;
                            break;
                        }

                    } else {
                        allByUniqueKeys[diffKey] = false;
                    }
                }
            
                i++;
            }

            if (validKeys && !addedValidKey) {
                allByUniqueKeys[ this.guid() ] = sObject;
            }
        } else {
            allByUniqueKeys[ sObject.VlocityRecordSourceKey ] = sObject;
        }
        
        
    }

    return allByUniqueKeys;
};

DataPacksUtils.prototype.endsWith = function(str, suffix) {
    return str.indexOf(suffix, str.length - suffix.length) !== -1;
}

DataPacksUtils.prototype.countRemainingInManifest = function(jobInfo) {

    jobInfo.exportRemaining = 0;

    Object.keys(jobInfo.fullManifest).forEach(function(dataPackType) {

        if (!jobInfo.alreadyExportedIdsByType[dataPackType]) {
            jobInfo.alreadyExportedIdsByType[dataPackType] = [];
        }

        if (!jobInfo.alreadyErroredIdsByType[dataPackType]) {
            jobInfo.alreadyErroredIdsByType[dataPackType] = [];
        }

        Object.keys(jobInfo.fullManifest[dataPackType]).forEach(function(dataPackKey) {

            var dataPackId = jobInfo.fullManifest[dataPackType][dataPackKey].Id;

            if (jobInfo.alreadyExportedIdsByType[dataPackType].indexOf(dataPackId) == -1
                && jobInfo.alreadyExportedIdsByType[dataPackType].indexOf(dataPackKey) == -1
                && jobInfo.alreadyErroredIdsByType[dataPackType].indexOf(dataPackId) == -1
                && jobInfo.alreadyExportedKeys.indexOf(dataPackKey) == -1
                && jobInfo.currentStatus[dataPackKey] != 'Error'
                && jobInfo.currentStatus[dataPackKey] != 'Ignored') {
                jobInfo.exportRemaining++;
            }
        });
    });
}

DataPacksUtils.prototype.printJobStatus = function(jobInfo, forceWrite) {

    if (!jobInfo.currentStatus) {
        return;
    }

    var statusCount = { Remaining: 0, Success: 0, Error: 0 };
    var statusReportFunc = {
        Success: VlocityUtils.success,
        Error: VlocityUtils.error,
        Remaining: VlocityUtils.warn,
        Ignored: VlocityUtils.verbose
    };
    
    var statusKeyMap = {
        'Ready': 'Remaining',
        'Header': 'Remaining',
        'Added': 'Remaining',
        'AddedHeader': 'Remaining',
        'ReadySeparate': 'Remaining'
    };
    var keysByStatus = {};
    
    Object.keys(jobInfo.currentStatus).forEach(function(dataPackKey) { 

        // Count statuses by status type
        var status = jobInfo.currentStatus[dataPackKey];
        status = statusKeyMap[status] || status;
        statusCount[status] = (statusCount[status] || 0) + 1;
        keysByStatus[status] = keysByStatus[status] || {};
    
        // For Exports
        var keyForStatus = jobInfo.vlocityKeysToNewNamesMap[dataPackKey] ? jobInfo.vlocityKeysToNewNamesMap[dataPackKey] : dataPackKey;

        if (keyForStatus.indexOf('/') != -1) {

            var slashIndex = keyForStatus.indexOf('/');
            var beforeSlash = keyForStatus.substring(0, slashIndex);
            var afterSlash = keyForStatus.substring(slashIndex+1);

            if (!keysByStatus[status][beforeSlash]) {
                keysByStatus[status][beforeSlash] = [];
            }
            var dataPackName = jobInfo.generatedKeysToNames[keyForStatus];

            if (dataPackName && afterSlash.indexOf(dataPackName) == -1) {
                afterSlash = dataPackName + ' - ' + afterSlash;
            }

            if (keysByStatus[status][beforeSlash].indexOf(afterSlash) == -1) {
                keysByStatus[status][beforeSlash].push(afterSlash);
            }
        }
    });

    if (jobInfo.jobAction == 'Export' 
        || jobInfo.jobAction == 'GetDiffs'
        || jobInfo.jobAction == 'GetDiffsAndDeploy'
        || jobInfo.jobAction == 'GetDiffsCheck') {
        this.countRemainingInManifest(jobInfo);
        statusCount.Remaining = jobInfo.exportRemaining; 
    }

    var totalCount = Object.values(statusCount).reduce((a,b) => a+b);
    if (totalCount == 0) {
        return;
    }

    var elapsedTime = (Date.now() - jobInfo.startTime) / 1000;

    if (jobInfo.headersOnly) {
        VlocityUtils.report('Uploading Only Parent Objects');
    }

    if (jobInfo.ignoreAllParents) {
        VlocityUtils.report('Ignoring Parents');
    }
    
    if (this.vlocity.username) {
        VlocityUtils.report('Salesforce Org', this.vlocity.username);
    }
    
    VlocityUtils.report('Version Info', 'v'+VLOCITY_BUILD_VERSION, this.vlocity.namespace, this.vlocity.PackageVersion ? this.vlocity.PackageVersion : '');
    VlocityUtils.verbose('Log File', path.join(this.vlocity.tempFolder, 'logs', jobInfo.logName));
    
    if (jobInfo.forceDeploy) {
        VlocityUtils.report('Force Deploy', 'On');
    }

    VlocityUtils.report('Current Status', jobInfo.jobAction);
    Object.keys(statusCount).forEach(status => (statusReportFunc[status] || VlocityUtils.report)(status, statusCount[status]));
    VlocityUtils.report('Elapsed Time', Math.floor((elapsedTime / 60)) + 'm ' + Math.floor((elapsedTime % 60)) + 's');

    var countByStatus = {};

    Object.keys(keysByStatus).forEach(function(statusKey) {
        countByStatus[statusKey] = {};

        Object.keys(keysByStatus[statusKey]).forEach(function(typeKey) {
            countByStatus[statusKey][typeKey] = keysByStatus[statusKey][typeKey].length;

            if (jobInfo.fullStatus) {

                var messageBeginning = typeKey + ' - ' + statusKey;
                var total = keysByStatus[statusKey][typeKey].length;

                if (statusKey == 'Success') {
                    VlocityUtils.success(messageBeginning, total);
                } else if (statusKey == 'Error') {
                    VlocityUtils.error(messageBeginning, total);
                } else {
                    VlocityUtils.warn(messageBeginning, total);
                }
            }
            
            keysByStatus[statusKey][typeKey].sort();
        });
    });

    if (jobInfo.jobAction == 'Export' && statusCount.Success > 1) {
        VlocityUtils.milestone(`Retrieved ${statusCount.Success} items`, `Exporting`);
    }

    if (jobInfo.jobAction == 'Deploy' && statusCount.Success > 1) {
        VlocityUtils.milestone(`Migrated ${statusCount.Success} items`, `Deploying`);
    }

    var logInfo = {
        Org: this.vlocity.username,
        Version: VLOCITY_BUILD_VERSION,
        Node: process.version,
        PackageVersion: this.vlocity.PackageVersion,
        Namespace: this.vlocity.namespace, 
        Job: jobInfo.jobName,
        Action: jobInfo.jobAction,
        ProjectPath: jobInfo.projectPath,
        TotalTime: Math.floor((elapsedTime / 60)) + 'm ' + Math.floor((elapsedTime % 60)) + 's',
        Count: countByStatus,
        Errors: jobInfo.errors,
        Status: keysByStatus,
        StatusCount: statusCount,
        id: this.vlocity.id
    };

    if (VlocityUtils.verboseLogging) {
        logInfo.FullLog = VlocityUtils.fullLog;
    }

    var errorLog = '';

    errorLog += 'Org: ' + this.vlocity.username + '\n';
    errorLog += 'Version: ' + VLOCITY_BUILD_VERSION + '\n';
    errorLog += 'PackageVersion: ' + this.vlocity.PackageVersion + '\n';
    errorLog += 'Namespace: ' + this.vlocity.namespace + '\n';
    errorLog += 'Job: ' + jobInfo.jobName + '\n';
    errorLog += 'Action: ' + jobInfo.jobAction + '\n';
    errorLog += 'ProjectPath: ' + jobInfo.projectPath + '\n';
    errorLog += 'Errors:' + (jobInfo.errors && jobInfo.errors.length > 0 ? ('\n' + jobInfo.errors.join('\n')) : ' None');

    try {
        if (forceWrite || !this.lastWriteTimeLog || (Date.now() - this.lastWriteTimeLog > 60000)) {
            fs.outputFileSync('VlocityBuildLog.yaml', yaml.dump(logInfo, { lineWidth: 1000 }));
            fs.copySync('VlocityBuildLog.yaml', path.join(this.vlocity.tempFolder, 'logs', jobInfo.logName));
            fs.outputFileSync('VlocityBuildErrors.log', errorLog);
            this.lastWriteTimeLog = Date.now();
        }
    } catch (e) {
        VlocityUtils.log(e);
    }
};

DataPacksUtils.prototype.updateStatusIPC = function(logInfo) {
    let ipcRenderer;
    if ('electron' in process.versions) {
        ipcRenderer = require('electron').ipcRenderer;
    } else {
        return;
    }

    if (ipcRenderer) {
        VlocityUtils.verbose('Sending IPC Message -  Update', logInfo);
        ipcRenderer.send('vdxupdate', logInfo);
    }
}

DataPacksUtils.prototype.saveCurrentJobInfo = async function(jobInfo, force) {
    if (!jobInfo.skipSaveJobInfo && (force || !this.lastWriteTimeJobInfo || (Date.now() - this.lastWriteTimeJobInfo > 60000))) {
        var startSaveTime = Date.now();
        VlocityUtils.verbose('Saving File Start');

        var nonWriteable = [ 'sObjectsInfo', 'errorHandling' ];

        var savedData = {}

        for (var key of nonWriteable) {
            savedData[key] = jobInfo[key];
            delete jobInfo[key];
        }

        try {
            this.lastWriteTimeJobInfo = Date.now();
            await fs.outputFile(CURRENT_INFO_FILE, JSON.stringify(jobInfo, null, 4), 'utf8');
            await fs.copy(CURRENT_INFO_FILE, CURRENT_INFO_FILE + '.bak');
            
            for (var key of nonWriteable) {
                jobInfo[key] = savedData[key];
            }

            VlocityUtils.verbose('Saving File End', Date.now() - startSaveTime);
        } catch (e) {
            VlocityUtils.verbose('Error Saving File', e);
        }
    }
};

DataPacksUtils.prototype.loadCurrentJobInfo = async function(jobInfo) {
    try {
        Object.assign(jobInfo, JSON.parse(fs.readFileSync(CURRENT_INFO_FILE, 'utf8')));
        await this.saveCurrentJobInfo(jobInfo);
    } catch (e) {
        try {
            Object.assign(jobInfo, JSON.parse(fs.readFileSync(CURRENT_INFO_FILE + '.bak', 'utf8')));
            await this.saveCurrentJobInfo(jobInfo);
        } catch (ex) {
            VlocityUtils.error('Error Loading Saved Job', e, ex);
        }
    }
};

DataPacksUtils.prototype.loadFilesAtPath = function(srcpath) {
    var self = this;
    var dirName = srcpath.substr(srcpath.lastIndexOf('/')+1);

    if (!dirName.startsWith('.')) {
        self.loadedFiles[dirName] = {};
        self.getFiles(srcpath).forEach(function(filename) {
            self.loadedFiles[dirName][filename] = fs.readFileSync(path.join(srcpath + '/', filename), 'utf8');
        });
    }

    return self.loadedFiles;
}

DataPacksUtils.prototype.loadFilesFromDir = function(srcpath) {
    var dirNames = fs.readdirSync(srcpath);

    for (var i = 0; i < dirNames.length; i++) {
        this.loadFilesAtPath(srcpath + '/' + dirNames[i]);
    }

    return this.loadedFiles;
}

DataPacksUtils.prototype.jsRemote = async function(action, method, data, page) {
    
    var body = {
        "action": action,
        "method": method,
        "data": data, 
        "type": "rpc",
        "tid": 3,
        "ctx": {
            "csrf": "1",
            "vid": "1",
            "ns": this.vlocity.namespace,
            "ver": 42 
        }
    };

    var siteUrl = this.vlocity.jsForceConnection.instanceUrl; 
    
    var request = {
        method: "POST",
        url: `${siteUrl}/apexremote`,
        body: JSON.stringify(body),
        headers: { 
            "content-type": "application/json", 
            Referer: `${siteUrl}/apex/${page}` 
        }
    };

    return await this.vlocity.jsForceConnection.request(request)
}

DataPacksUtils.revertGitDiff = function(gitDiffString, currentString) {

    try {
        VlocityUtils.error('gitDiffString ' + gitDiffString);
        VlocityUtils.error('currentString ' + currentString)
        var gitDiffStringArray = gitDiffString.split('\n');
        var gitHeader = gitDiffStringArray[1];

        var startingLine = parseInt(gitHeader.substring(gitHeader.indexOf('-') + 1, gitHeader.indexOf(',')));
        var currentStringSplit = currentString.split('\n');

        VlocityUtils.error('Starting Line', startingLine);

        var updatedStringArray = [];
        var currentStringIndex = 0;

        // Build Start
        for (; currentStringIndex < startingLine - 1; currentStringIndex++) {
            VlocityUtils.error('Adding Start', currentStringSplit[currentStringIndex]);
            updatedStringArray.push(currentStringSplit[currentStringIndex]);
        }

        // Only put in minuses - for any + add to currentStringIndex
        for (var i = 2; i < gitDiffStringArray.length; i++) {
            if (gitDiffStringArray[i][0] == '-') {
                VlocityUtils.error('Adding Diff', gitDiffStringArray[i].substr(1));
                updatedStringArray.push(gitDiffStringArray[i].substr(1));
            } else if (gitDiffStringArray[i][0] == '+') {
                VlocityUtils.error('Skipping Diff', gitDiffStringArray[i][0]);
                currentStringIndex++;
            }
        }

        for (; currentStringIndex < currentStringSplit.length; currentStringIndex++) {
            VlocityUtils.error('Adding End', currentStringSplit[currentStringIndex]);
            updatedStringArray.push(currentStringSplit[currentStringIndex]);
        }

        return updatedStringArray.join('\n');
    }catch (e) {
        VlocityUtils.error(e.stack);
    }
}

DataPacksUtils.prototype.getNoDiffs = function(data, type, isDeletedOrNew) {

    var formattedData = '';
    var isDeletedOrNewChar = ' ';

    if (isDeletedOrNew === 'Deleted') {
        isDeletedOrNewChar = '-';
    } else if (isDeletedOrNew === 'New') {
        isDeletedOrNewChar = '+';
    }

    for (var line of data.split('\n')) {
        formattedData += `\n${isDeletedOrNewChar}${line}`; 
    }

    return `diff --git File.${type} File.${type}\n@@ -1,0 +1,0 @@${formattedData}`;
}

// Return array of Git Hunks
DataPacksUtils.prototype.getGitDiffs = function(target, source, type, skipCreatingHunks) {
    if (type != null && type != 'base64') {
        if (target && typeof target == 'string' 
            && source && typeof source == 'string') {

            target = target.replace(new RegExp(this.vlocity.namespace, 'g'), '%vlocity_namespace%');
            source = source.replace(new RegExp(this.vlocity.namespace, 'g'), '%vlocity_namespace%');

            if (target == source) {
                return [ { diffString: this.getNoDiffs(target, type), hasDiffs: false }];
            }

            let diffString = gitDiff(target, source, { forceFake: true });

            if (diffString) {
                var hunks = [];

                var currentHunk = '';
                var currentHunkHasChanges = false;
                var currentAddLine = 1;
                var currentDeleteLine = 1;
                var currentHeader = `@@ -${currentDeleteLine},0 +${currentAddLine},0 @@\n`;

                if (skipCreatingHunks) {
                    return [{ diffString: `diff --git File.${type} File.${type}\n${currentHeader}${diffString}`, hasDiffs: true }];
                }

                var allLines = diffString.split('\n');

                for (var i = 0; i < allLines.length; i++) {
                    var currentLine = allLines[i];

                    if (currentLine === '' && currentHunk) {
                        currentHunk += `${currentLine}\n`;
                    } else if (currentLine[0] === ' ') {
                        if (!currentHunkHasChanges) {
                            currentHunk += `${currentLine}\n`;
                        } else {
                            hunks.push({ diffString: `diff --git File.${type} File.${type}\n${currentHeader}${currentHunk}`, hasDiffs: currentHunkHasChanges });
                            currentHunk = `${currentLine}\n`;
                            currentHunkHasChanges = false;
                            currentHeader = `@@ -${currentDeleteLine},0 +${currentAddLine},0 @@\n`; 
                        }

                        currentAddLine++;
                        currentDeleteLine++;
                    } else {
                        if (currentHunk == '' || currentHunkHasChanges) {
                            currentHunk += `${currentLine}\n`;
                        } else {
                            hunks.push({ diffString: `diff --git File.${type} File.${type}\n${currentHeader}${currentHunk}`, hasDiffs: currentHunkHasChanges });
                            currentHunk = `${currentLine}\n`;
                            currentHeader = `@@ -${currentDeleteLine},0 +${currentAddLine},0 @@\n`;
                        }

                        if (currentLine[0] === '+') {
                            currentAddLine++;
                        } else if (currentLine[0] === '-') {
                            currentDeleteLine++;
                        }

                        currentHunkHasChanges = true;
                    }
                }

                if (currentHunk.trim()) {
                    hunks.push({ diffString: `diff --git File.${type} File.${type}\n${currentHeader}${currentHunk}`, hasDiffs: currentHunkHasChanges } );
                }
                
                return hunks;
            } else {
                return [ { diffString: this.getNoDiffs(target, type), hasDiffs: false } ];
            }
        } else if (target && typeof target == 'string') {
            return [ { diffString: this.getNoDiffs(target, type, 'Deleted'), hasDiffs: true }  ];
        } else if (source && typeof source == 'string') {
            return [ { diffString: this.getNoDiffs(source, type, 'New'), hasDiffs: true }  ];
        }
    }

    return [{}];
}

DataPacksUtils.prototype.handleDataPackEvent = async function(eventName, dataPackType, input) {
    if (!this[dataPackType] && fs.existsSync(path.join(__dirname, 'datapacktypes', dataPackType.toLowerCase() + '.js'))) {
        let requiredDataPack = require(path.join(__dirname, 'datapacktypes', dataPackType.toLowerCase() + '.js'));
        this[dataPackType] = new requiredDataPack(this.vlocity);
    }

	if (this[dataPackType] && this[dataPackType][eventName]) {
		return await this[dataPackType][eventName](input);
	}
}

DataPacksUtils.handleStaticDataPackEventSync = async function(eventName, dataPackType, input) {
    if (fs.existsSync(path.join(__dirname, 'datapacktypes', dataPackType.toLowerCase() + '.js'))) {
        let requiredDataPack = require(path.join(__dirname, 'datapacktypes', dataPackType.toLowerCase() + '.js'));
		return requiredDataPack[eventName](input);
	}
}

DataPacksUtils.prototype.createBulkJob = async function (objectName, operation, data, randomNum) {

    let promise = await new Promise((resolve) => {

        var self = this;
        var maxBatchSize = 10000;//as per bulk api limits
        var batchStartIndex = 0;
        var dataLength = data.length;
        var batchCnt = 0;
        var numBatches = Math.max(1, Math.ceil(dataLength / maxBatchSize));

        // Create job and batch
        var job = self.vlocity.jsForceConnection.bulk.createJob(objectName, operation);

        while (batchStartIndex < dataLength) {

            var thisBatchSize = Math.min(dataLength - batchStartIndex, maxBatchSize);
            var batch = job.createBatch();
            batch.execute(data.splice(0, thisBatchSize))
                .on("error", function (batchInfo) {
                    VlocityUtils.error('Error', batchInfo);
                    resolve('Batch Upload Error');
                })
                .on("queue", function (batchInfo) {
                    VlocityUtils.verbose(`Batch Queued - ${operation} - ${randomNum}`);
                    batch.poll(5000 /* interval(ms) */, 300000 /* timeout(ms) */);

                })
                .on("response", function (rets) {
                   
                    for (var i = 0; i < rets.length; i++) {

                        var hasError = false;
                        if (rets[i].success) {
                            if (self.vlocity.insertIndexToSfIdMap[randomNum + '-' + i]) {
                                self.vlocity.insertIndexToSfIdMap[randomNum + '-' + i].id = rets[i].id;
                                self.vlocity.nameToSfIdMap[self.vlocity.insertIndexToSfIdMap[randomNum + '-' + i].name] = rets[i].id;
                            }
                        } else {
                            VlocityUtils.error('Batch Insert Error', rets[i]);
                            hasError = true;
                        }
                    }

                    if (hasError) {                           
                        VlocityUtils.error('Error inserting Batch');
                    } else {
                        VlocityUtils.verbose(`Batch Response - ${operation} - ${randomNum}`);
                    }

                    batchCnt++;
                    if (batchCnt == numBatches) {
                        VlocityUtils.verbose(`Batch ${operation} job finished`);
                        job.close();
                        resolve();
                    }
                });

            batchStartIndex += thisBatchSize;
        }
    })
        .catch((err) => {
            VlocityUtils.error('Error', err);
        });
    return promise;
}

DataPacksUtils.prototype.deleteBulkRecords = async function (query, objectName, salesforceId, salesforceIdDeleteBatch) {
    let promise = await new Promise((resolve) => {
        var self = this;

        var maxRowFetch = 100000;
        var records = [];

        salesforceIdDeleteBatch[salesforceId] = 'false';

        self.vlocity.jsForceConnection.query(query)
            .on("record", function (record) {
                records.push(record);
            })
            .on("end", async function () {
                if (records.length > 0 && salesforceIdDeleteBatch[salesforceId] != 'true') {
                    salesforceIdDeleteBatch[salesforceId] = 'true';

                    var result = await self.createBulkJob(objectName, 'delete', records);
                    if (result == 'Batch Upload Error') {
                        return resolve(result);
                    }
                }
                resolve();
            })
            .on("error", function (err) {
                VlocityUtils.error(err);
            })
            .run({ autoFetch: true, maxFetch: maxRowFetch });
    
    })
    .catch((err) => {
        VlocityUtils.error('Error Builk Deleting', err);
    });

    return promise;
}


DataPacksUtils.prototype.shouldRetrieveSalesforceType = function(jobInfo, metaDesc) {

    if (jobInfo.allAllowedTypes) {
        if (jobInfo.allAllowedTypes.Salesforce[metaDesc.xmlName] || jobInfo.allAllowedTypes.Salesforce[metaDesc.type]) {
            return true;
        } else if (metaDesc.childXmlNames) {
            for (var metaChild of metaDesc.childXmlNames) {
                if (jobInfo.allAllowedTypes.Salesforce[metaChild]) {
                    return true;
                }
            }
        }
    }

    return false;    
}

DataPacksUtils.prototype.retrieveIndividualMetadata = async function(inputMap) {

    try {
        var jobInfo = inputMap.jobInfo;
        var deploymentOptions = inputMap.deploymentOptions;
        var metaDesc = inputMap.metaDesc;

        if (!this.shouldRetrieveSalesforceType(jobInfo, metaDesc)) {
            return;
        }

        var thisMetadata = '';

        var promResult;
        if (metaDesc.xmlName == 'Layout') {
            promResult = await this.getLayoutsFromToolingAPI(metaDesc.xmlName, deploymentOptions.allSFDXFileNames);
        } else {
            promResult = await this.retrieveByType(deploymentOptions, metaDesc, jobInfo);
        }

        if (promResult) {

            for (retrieveInfo of promResult) {
                if (retrieveInfo && retrieveInfo.metadata) {

                    if (thisMetadata) {
                        thisMetadata += ',';
                    }

                    thisMetadata += retrieveInfo.metadata;
                }
            }
        }
        
        if (thisMetadata) {
            deploymentOptions.metadata.push(thisMetadata);
        }
    } catch (e) {
        VlocityUtils.error(e);
    }
}

var folderOnlyMetadata = [ "aura", "layouts", "lwc" ]

DataPacksUtils.prototype.retrieveSalesforce = async function(jobInfo, listOnly) {

    VlocityUtils.report('Retrieving Salesforce');

    let allMetadata = await this.vlocity.jsForceConnection.metadata.describe(VLOCITY_BUILD_SALESFORCE_API_VERSION); 

    var deploymentOptions =  { targetusername: this.vlocity.sfdxUsername };

    this.metadataTypesByFolder = {};
    this.folderByMetadataType = {};
   
    for (var metaDesc of allMetadata.metadataObjects) {
        this.metadataTypesByFolder[metaDesc.directoryName] = metaDesc;
        this.folderByMetadataType[metaDesc.xmlName] = metaDesc.directoryName;
    }

    var sfdxProject = this.getSFDXProject(jobInfo);
    var sfdxFolder = sfdxProject.sfdxProject.packageDirectories[0].path;
   
    var createdFiles = [];

    var existingFiles = [];
    this.getFilesRecursive(path.join(sfdxProject.sfdxPath, sfdxFolder, 'main', 'default'), existingFiles);

    if (jobInfo.specificManifestKeys) {
        deploymentOptions.sourcepath = '';

        for (var key of jobInfo.specificManifestKeys) {

            var typeIndex = key.indexOf('/');

            if ((typeIndex == -1 && this.metadataTypesByFolder[key]) || this.metadataTypesByFolder[key.substring(0, typeIndex)]) {

                var typeForKey = key.substring(0, typeIndex);
                var nameForKey = key.substring(typeIndex + 1) || '';

                if (folderOnlyMetadata.includes(typeForKey)) {
                    if (!deploymentOptions.metadata) {
                        deploymentOptions.metadata = '';
                    }

                    if (deploymentOptions.metadata) {
                        deploymentOptions.metadata += ',';
                    }

                    deploymentOptions.metadata += `${this.metadataTypesByFolder[typeForKey].xmlName}:${nameForKey}`;

                } else {
                    if (deploymentOptions.sourcepath) {
                        deploymentOptions.sourcepath += ',';
                    }
                    
                    var retrieveFile = path.join(sfdxProject.sfdxPath, sfdxFolder, 'main', 'default', key).replace(/%vlocity_namespace%/g, this.vlocity.namespace);
                   
                    deploymentOptions.sourcepath += retrieveFile;
                    
                    createdFiles.push(retrieveFile);
    
                    if (!fs.existsSync(retrieveFile)){   
                        if (retrieveFile.endsWith('xml')) {
                            fs.outputFileSync(retrieveFile, '<?xml version="1.0" encoding="UTF-8"?>');
                        } else {
                            fs.outputFileSync(retrieveFile, '');
                            createdFiles.push(retrieveFile + '-meta.xml');
                        }
                    }
                }
            }
        }

        await this.runRetrieve(deploymentOptions, jobInfo);

        var filesAfterRetrieve = [];
        this.getFilesRecursive(path.join(sfdxProject.sfdxPath, sfdxFolder, 'main', 'default', 'objects'), filesAfterRetrieve);

        for (var file of filesAfterRetrieve) {
            if (!existingFiles.includes(file) && !createdFiles.includes(file)) {
                fs.removeSync(file);
            }
        }

        var allFilesAfter = []
        this.getFilesRecursive(path.join(sfdxProject.sfdxPath, sfdxFolder, 'main', 'default'), allFilesAfter);

        for (var file of allFilesAfter) {
            try {
                await this.removeInvalidXMLNodes(file);
            } catch (e) {
                // Ignore
            }
        }

        if (createdFiles.length > 0) {
            for (var createdFile of createdFiles) {
                if (fs.existsSync(createdFile)){   
                    var createdFileData = fs.readFileSync(createdFile, { encoding: 'utf8' });

                    if (createdFileData == '' || createdFileData == '<?xml version="1.0" encoding="UTF-8"?>') {
                        fs.removeSync(createdFile);
                    }
                }
            }
        }
    } else {
        var allPromises = [];

        deploymentOptions.metadata = [];
        deploymentOptions.allSFDXFileNames = new Set();
        
        for (var metaDesc of allMetadata.metadataObjects) {
            allPromises.push({ context: this, func: 'retrieveIndividualMetadata', argument: { deploymentOptions: deploymentOptions, jobInfo: jobInfo, metaDesc: metaDesc }});
        }

        try {
            await this.vlocity.utilityservice.parallelLimit(allPromises, 5);
        } catch (e) {
            VlocityUtils.error(e);
        }

        for (var fileName of deploymentOptions.allSFDXFileNames) {
            
            var indexOfSlash = fileName.indexOf('/');

            var type = fileName.substring(0, indexOfSlash);
            var name = fileName.substring(indexOfSlash+1);

            if (!jobInfo.fullManifest[type]) {
                jobInfo.fullManifest[type] = {};
            }

            jobInfo.fullManifest[type][name] = { 
                isSFDXData: true,
                VlocityDataPackDisplayLabel: name,
                VlocityRecordSObjectType: type,
                VlocityDataPackType: type,
                VlocityDataPackKey: fileName
            }
        }

        if (listOnly) {
            return;
        }

        for (var metaList of deploymentOptions.metadata) {

            var metaSingle = {
                targetusername: deploymentOptions.targetusername,
                metadata: metaList
            }

            // Try to get all together
            var result = await this.runRetrieve(metaSingle, jobInfo);

            // If that fails get all separate
            if (!result) {
                VlocityUtils.error('Error Getting From SFDX');
            }
        }
    }
}

DataPacksUtils.prototype.removeInvalidXMLNodes = async function(file) {
    return new Promise(resolve => { 

       
        if (file.indexOf('-meta.xml') != -1) {
            var fileData = fs.readFileSync(file, { encoding: 'utf8' });

            var patterns = [ '//xmlns:packageVersions' ];
            var namespaces = {xmlns: "http://soap.sforce.com/2006/04/metadata"};
            VlocityUtils.log('removeInvalidXMLNodes', file)

            filterxml(fileData, patterns, namespaces, function (err, xmlOut) {
                VlocityUtils.log('removeInvalidXMLNodes', xmlOut)
                if (fileData != xmlOut) {
                    fs.outputFileSync(file, xmlOut, { encoding: 'utf8' });
                }
                
                resolve();
            });
        } else {
            resolve();
        }
    });
}

DataPacksUtils.prototype.getLayoutsFromToolingAPI = async function(objectType, allSFDXFileNames) {

    var metadata = '';

    let metaList = await this.vlocity.jsForceConnection.tooling.query(`Select Name, TableEnumOrId, NamespacePrefix from ${objectType}`);

    let customObjectData = await this.vlocity.jsForceConnection.tooling.query(`Select Id, DeveloperName, NamespacePrefix from CustomObject`);
    var customObjectsById = {};

    var allCustomObjMetadata = await this.vlocity.utilityservice.getAllValidSObjects();

    var customObjectsById = {};

    for (var obj of Object.values(allCustomObjMetadata)) {

        if (obj.id) {
            customObjectsById[obj.id] = obj.fullName;
        }
    }

    for (var obj of customObjectData.records) {

        if (!customObjectsById[obj.Id] && obj.NamespacePrefix) {
            customObjectsById[obj.Id] = `${obj.NamespacePrefix}__${obj.DeveloperName}__c`;
        }
    }

    for (var met of metaList.records) {
        if (metadata) {
            metadata += ',';    
        }

        if (met.NamespacePrefix) {
            allSFDXFileNames.add(`layouts/${customObjectsById[met.TableEnumOrId] ? customObjectsById[met.TableEnumOrId] : met.TableEnumOrId}-${met.NamespacePrefix}__${met.Name.replace('(', '%28').replace(')', '%29')}`);
        
            metadata += `${objectType}:${customObjectsById[met.TableEnumOrId] ? customObjectsById[met.TableEnumOrId] : met.TableEnumOrId}-${met.NamespacePrefix}__${met.Name.replace('(', '%28').replace(')', '%29')}`;
        } else {
            allSFDXFileNames.add(`layouts/${customObjectsById[met.TableEnumOrId] ? customObjectsById[met.TableEnumOrId] : met.TableEnumOrId}-${met.Name.replace('(', '%28').replace(')', '%29')}`);
        
            metadata += `${objectType}:${customObjectsById[met.TableEnumOrId] ? customObjectsById[met.TableEnumOrId] : met.TableEnumOrId}-${met.Name.replace('(', '%28').replace(')', '%29')}`;
        }
        
    }
                        
    return [{ metadata: metadata }];
}

DataPacksUtils.prototype.runRetrieve = async function(deploymentOptions, jobInfo) {
    VlocityUtils.verbose('Run Retrieve Start', deploymentOptions);
    var finalResult = true;

    if (deploymentOptions.sourcepath || deploymentOptions.metadata) {
        var deploymentOptionsArray = [];
        
        if (deploymentOptions.metadata) {
            var chunk = 50;
            var metadataArray = deploymentOptions.metadata.split(',');
            
            for (var i = 0, j = metadataArray.length; i < j; i += chunk) {
                deploymentOptionsArray.push({
                    targetusername: deploymentOptions.targetusername,
                    metadata: metadataArray.slice(i, i + chunk).join(',')
                })
            }
        }

        if (deploymentOptions.sourcepath) {
            var chunk = 50;
            var sourceArray = deploymentOptions.sourcepath.split(',');
            
            for (var i = 0, j = sourceArray.length; i < j; i += chunk) {
                temparray = sourceArray.slice(i, i + chunk);

                deploymentOptionsArray.push({
                    targetusername: deploymentOptions.targetusername,
                    sourcepath: sourceArray.slice(i, i + chunk).join(',')
                })
            }
        }

        for (var deployments of deploymentOptionsArray) {

            try {
                VlocityUtils.verbose('Run Retrieve SFDX', deployments);

                var response = await this.vlocity.utilityservice.sfdx('source:retrieve', deployments);

                VlocityUtils.verbose('Retrieve Response', response);
    
                for (var includedFile of response.inboundFiles || []) {
                    var metadataKey;
                    var folder = 'default' + path.sep;
                
                    if (includedFile.filePath) {
                        metadataKey = includedFile.filePath.substring(includedFile.filePath.lastIndexOf(folder)+folder.length);
                    } else {
                        metadataKey = `${this.folderByMetadataType[includedFile.type] ? this.folderByMetadataType[includedFile.type] : includedFile.type}/${includedFile.fullName}`;
                    }
                    
                    VlocityUtils.success('Metadata Retrieved', metadataKey);
                    jobInfo.currentStatus[metadataKey] = 'Success';
                }
            } catch (e) {
                VlocityUtils.error('Metadata Retrieve Error', e);
                finalResult = false;
            }
        }
    }

    return finalResult;
}

DataPacksUtils.prototype.retrieveByType = async function(deploymentOptions, metaDesc, jobInfo) {
    var tries = 0;
    
    while (tries < 10) {
        try {
            var deploymentOptionsForNames = JSON.parse(JSON.stringify(deploymentOptions));

            deploymentOptionsForNames.metadata = '';

            let metaList = [];

            if (metaDesc.inFolder) {
                var folderMetadataType = `${metaDesc.xmlName}Folder`;

                if (metaDesc.xmlName == 'EmailTemplate') {
                    folderMetadataType = 'EmailFolder';
                }

                var folderList = await this.vlocity.jsForceConnection.metadata.list([{ type: folderMetadataType, folder: null }], VLOCITY_BUILD_SALESFORCE_API_VERSION);

                if (!Array.isArray(folderList)) {
                    folderList = [ folderList ];
                }

                for (var folderName of folderList) {
                    if (folderName.manageableState == 'unmanaged') {
                        var inFolderFiles = await this.vlocity.jsForceConnection.metadata.list([{ type: metaDesc.xmlName, folder: folderName.fullName }], VLOCITY_BUILD_SALESFORCE_API_VERSION);
                        
                        if (!Array.isArray(inFolderFiles)) {
                            inFolderFiles = [ inFolderFiles ];
                        }

                        for (var folderFile of inFolderFiles) {
                            metaList.push(folderFile);
                        }
                    }
                }
            } else {
                metaList = await this.vlocity.jsForceConnection.metadata.list([{ type: metaDesc.xmlName, folder: null }], VLOCITY_BUILD_SALESFORCE_API_VERSION);
            } 

            var allPromises = [];

            if (metaList) {
                
                if (!Array.isArray(metaList)) {
                    metaList = [ metaList ];
                }
                
                for (var meta of metaList) {

                    VlocityUtils.verbose('Processing Metadata', meta.fileName, meta.namespacePrefix, this.vlocity.orgNamespace);
                    
                    if (meta.type == 'CustomObject') {
                        if (!meta.namespacePrefix && this.shouldRetrieveSalesforceType(jobInfo, meta)) {    
                            deploymentOptions.allSFDXFileNames.add(`objects/${meta.fullName}/${meta.fullName}.object-meta.xml`);
                        }

                        allPromises.push(this.getCustomObjectInfo(deploymentOptionsForNames, meta, jobInfo));
                    } else if (meta.type == 'Profile' ) {
                        deploymentOptions.allSFDXFileNames.add(meta.fileName);
                        allPromises.push(this.isCustomProfileOrAdmin(meta));
                    } else if (!meta.namespacePrefix 
                        || meta.type == 'InstalledPackage' 
                        || meta.namespacePrefix == this.vlocity.orgNamespace) {
                        if (deploymentOptionsForNames.metadata) {
                            deploymentOptionsForNames.metadata += ',';
                        }

                        deploymentOptions.allSFDXFileNames.add(meta.fileName);

                        deploymentOptionsForNames.metadata += `${meta.type}:${meta.fullName}`;
                    }
                }
            }

            if (allPromises.length > 0) {
                var allCustomObject = await Promise.all(allPromises);

                if (metaDesc.xmlName == 'CustomObject') {
                    deploymentOptionsForNames.metadata = 'CustomObject';

                    VlocityUtils.log('deploymentOptions', deploymentOptions);

                    for (var obj of allCustomObject) {
                        if (obj) {
                            if (obj.metadata) {
                                deploymentOptionsForNames.metadata += ',' + obj.metadata;
                            }

                            if (obj.allSFDXFileNames) {

                                for (var item of obj.allSFDXFileNames) {
                                    deploymentOptions.allSFDXFileNames.add(item);
                                }
                            }
                        }
                    }
                }

                return [ deploymentOptionsForNames ];
            } 
            
            return [ deploymentOptionsForNames ];
        } catch (e) {
            tries++;
           
            if (tries > 10) {
                VlocityUtils.error(e, metaDesc);
            } else {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
    }
}

DataPacksUtils.prototype.isCustomProfileOrAdmin = async function(profile) {

    if (profile.fullName != 'Admin') {

        return null;
        let read = await this.vlocity.jsForceConnection.metadata.read('Profile', [ profile.fullName ]);

        if (read.custom == "false") {
            return null;
        }
    }

    return { metadata: `Profile:${profile.fullName}`};
}

DataPacksUtils.prototype.getCustomObjectInfo = async function(deploymentOptions, customObject, jobInfo) {

    var tries = 0;
    var deploymentOptionsForNames = JSON.parse(JSON.stringify(deploymentOptions));
    deploymentOptionsForNames.allSFDXFileNames = new Set();
    deploymentOptionsForNames.metadata = '';

    while (tries < 3) {
        try {

            VlocityUtils.verbose('Reading Custom Object', customObject.fullName);

            let read = await this.vlocity.jsForceConnection.metadata.read('CustomObject', [ customObject.fullName ]);

            if (read && !Array.isArray(read)) {
                read = [ read ];
            }

            for (var sobj of read) {

                if (!jobInfo.allAllowedTypes || jobInfo.allAllowedTypes.Salesforce.BusinessProcess) {
                    this.getIsCustomSObjectMetadata(sobj, 'businessProcesses', 'BusinessProcess', 'fullName', 0, deploymentOptionsForNames);
                }

                if (!jobInfo.allAllowedTypes || jobInfo.allAllowedTypes.Salesforce.CompactLayout) {
                    this.getIsCustomSObjectMetadata(sobj, 'compactLayouts', 'CompactLayout', 'fullName', 0, deploymentOptionsForNames);
                }

                if (!jobInfo.allAllowedTypes || jobInfo.allAllowedTypes.Salesforce.CustomField) {
                    this.getIsCustomSObjectMetadata(sobj, 'fields', 'CustomField', 'fullName', 1, deploymentOptionsForNames);
                }

                if (!jobInfo.allAllowedTypes || jobInfo.allAllowedTypes.Salesforce.FieldSet) {
                    this.getIsCustomSObjectMetadata(sobj, 'fieldSets', 'FieldSet', 'fullName', 0, deploymentOptionsForNames);
                }

                if (!jobInfo.allAllowedTypes || jobInfo.allAllowedTypes.Salesforce.ListView) {
                    this.getIsCustomSObjectMetadata(sobj, 'listViews', 'ListView', 'fullName', 0, deploymentOptionsForNames);
                }

                if (!jobInfo.allAllowedTypes || jobInfo.allAllowedTypes.Salesforce.RecordType) {
                    this.getIsCustomSObjectMetadata(sobj, 'recordTypes', 'RecordType', 'fullName', 0, deploymentOptionsForNames);
                }

                if (!jobInfo.allAllowedTypes || jobInfo.allAllowedTypes.Salesforce.SharingReason) {
                    this.getIsCustomSObjectMetadata(sobj, 'sharingReasons', 'SharingReason', 'fullName', 0, deploymentOptionsForNames);
                }

                if (!jobInfo.allAllowedTypes || jobInfo.allAllowedTypes.Salesforce.ValidationRule) {
                    this.getIsCustomSObjectMetadata(sobj, 'validationRules', 'ValidationRule', 'fullName', 0, deploymentOptionsForNames);
                }

                if (!jobInfo.allAllowedTypes || jobInfo.allAllowedTypes.Salesforce.WebLink) {
                    this.getIsCustomSObjectMetadata(sobj, 'webLinks', 'WebLink', 'fullName', 0, deploymentOptionsForNames);
                }

                if (!jobInfo.allAllowedTypes || jobInfo.allAllowedTypes.Salesforce.Index) {
                    this.getIsCustomSObjectMetadata(sobj, 'index', 'Index', 'fullName', 0, deploymentOptionsForNames);
                }
            }           

            if (deploymentOptionsForNames.metadata) {
                return deploymentOptionsForNames;
            }

            return null;
        } catch (e) {
            tries++;
            VlocityUtils.error('Custom Objects Failed', e);
        }
    }
}

DataPacksUtils.prototype.getIsCustomSObjectMetadata = function(meta, type, metaType, nameField, countOfUnderscores, deploymentOptions) {

   if (meta[type]) {
       if (!Array.isArray(meta[type])) {
            meta[type] = [ meta[type] ];
       }
       
       for (var met of meta[type]) {
            // Not vlocity_cmt__FieldName__c or Standard Field
            if (met[nameField] && ((met[nameField].match(/\_\_/g) || []).length == countOfUnderscores) || met[nameField].indexOf(this.vlocity.orgNamespace) == 0) {

                if (deploymentOptions.metadata) {
                    deploymentOptions.metadata += ',';
                }

                var fileName = `objects/${meta.fullName}/${type}/${met[nameField]}.${type.substring(0, type.length-1)}-meta.xml`;

                deploymentOptions.allSFDXFileNames.add(fileName);

                deploymentOptions.metadata += `${metaType}:${meta.fullName}.${met[nameField]}`;
            }
        }
    }

    return deploymentOptions.metadata;
}

DataPacksUtils.prototype.getSFDXProject = function(jobInfo) {
    // Must exist in folder where command is being run no matter what
    if (!fs.existsSync('sfdx-project.json') || jobInfo.deleteSfdxProject || jobInfo.resetSfdxProjectLocation) { 

        if (!jobInfo.sfdxExpandFolder) {
            jobInfo.sfdxExpandFolder = this.vlocity.tempFolder;
        }
        
        var sfdxTempFolder = path.relative('.', `${jobInfo.sfdxExpandFolder}/DX/salesforce_sfdx`);
        var salesforceProject = {
            "packageDirectories": [
                {
                    "path": sfdxTempFolder,
                    "default": true
                }
            ],
            "namespace": "",
            "sfdcLoginUrl": "https://login.salesforce.com",
            "sourceApiVersion": VLOCITY_BUILD_SALESFORCE_API_VERSION
        };

        if (jobInfo.deleteSfdxProject && fs.existsSync(sfdxTempFolder)) {

            try {
                fs.removeSync(sfdxTempFolder);
            } catch (e) {
               VlocityUtils.error('Failed to Delete Directory', sfdxTempFolder, e);
            }
        }
        
        fs.ensureDirSync(sfdxTempFolder);
        fs.outputFileSync(path.join('sfdx-project.json'), JSON.stringify(salesforceProject), { encoding: 'utf8' });
        fs.outputFileSync(path.join(sfdxTempFolder, '..', 'sfdx-project.json'), JSON.stringify({
            "packageDirectories": [
                {
                    "path": 'salesforce_sfdx',
                    "default": true
                }
            ],
            "namespace": "",
            "sfdcLoginUrl": "https://login.salesforce.com",
            "sourceApiVersion": VLOCITY_BUILD_SALESFORCE_API_VERSION
        }), { encoding: 'utf8' });

        VlocityUtils.report('SFDX Project Path', path.join(sfdxTempFolder, '..', 'sfdx-project.json'));
    }

    var sfdxPath;

    var projectSfdx = jobInfo.projectPath;
    var tempSfdx = path.join(jobInfo.projectPath, '..', 'DX');

    if (fs.existsSync(path.join(projectSfdx, 'sfdx-project.json')) || jobInfo.useProjectPathForSFDX) {
        sfdxPath = projectSfdx;
    } else if (fs.existsSync(path.join(tempSfdx, 'sfdx-project.json'))) {
        sfdxPath = tempSfdx;
    } else {
        sfdxPath = '.';
    }

    if (!fs.existsSync(path.join(sfdxPath, 'sfdx-project.json'))) {
        throw 'No sfdx-project.json found';
    }

    VlocityUtils.report('Found SFDX Project', path.join(sfdxPath, 'sfdx-project.json'));

    return { sfdxPath: sfdxPath, sfdxProject: JSON.parse(fs.readFileSync(path.join(sfdxPath, 'sfdx-project.json'))) };
}

DataPacksUtils.prototype.getSfdxData = async function(jobInfo) {
    var allDataByKey = {};

    jobInfo.sfdxData = [];
    var sfdxProject;
    try {
        sfdxProject = this.getSFDXProject(jobInfo);
    } catch (e) {
        VlocityUtils.error('SFDX Project Error', e);
        return null;
    } 
   
    var sfdxFolder = sfdxProject.sfdxProject.packageDirectories[0].path;
    var directories = this.getDirectories(path.join(sfdxProject.sfdxPath, sfdxFolder), true);

    for (let dir of directories) {
     //  VlocityUtils.report('Dir', dir);
        for (let file of this.getFiles(path.join(sfdxProject.sfdxPath, sfdxFolder, dir))) {
            //VlocityUtils.report('File', file);
            if (file[0] != '.') {
                var folder = 'default' + path.sep;
                var dataPackType = dir.substring(dir.lastIndexOf(folder)+folder.length);
                try {
                    var dataPackKey = `${dataPackType}/${file}`;

                    VlocityUtils.report(dataPackKey);

                    var staticResourcesStr = 'staticresources/';

                    var staticResourceStart = dataPackKey.indexOf(staticResourcesStr);

                    if (staticResourceStart != -1) {
                        var dataPackName = dataPackKey.substr(staticResourceStart+staticResourcesStr.length);

                        if (dataPackName.indexOf('/') != -1) {
                            dataPackName = dataPackName.substring(0, dataPackName.indexOf('/')-1);
                        }
                        
                        dataPackKey = `staticresources/${dataPackName}`;
                    }

                    var fileData = {
                        VlocityDataPackDisplayLabel: dataPackKey,
                        VlocityDataPackKey: dataPackKey,
                        VlocityDataPackStatus: "Ready",
                        VlocityDataPackType: dataPackType,
                        VlocityRecordSourceKey: dataPackKey
                    };

                    var fileBuffer = fs.readFileSync(path.join(sfdxProject.sfdxPath, sfdxFolder, dir, file));

                    if (staticResourceStart != -1) {

                        if (allDataByKey[dataPackKey]) {
                            fileData = allDataByKey[dataPackKey];
                        } else {
                            fileData.SFDXData = '[]';
                            fileData.SFDXDataType = 'staticresources';
                            allDataByKey[dataPackKey] = fileData;
                            jobInfo.sfdxData.push(fileData);
                        }

                        fileData.SFDXData = fileData.SFDXData.substring(0, fileData.SFDXData.length - 1);
                        
                        if (fileData.SFDXData != '[') {
                            fileData.SFDXData += ',';
                        }

                        if (isUtf8(fileBuffer)) {
                            fileData.SFDXData += `{"encoding":"utf8","filePath": "${path.join(dir, file)}", fileData": "${fileBuffer.toString('utf8')}" }]`;
                        } else {
                            fileData.SFDXData += `{"encoding":"base64","filePath": "${path.join(dir, file)}", fileData": "${fileBuffer.toString('base64')}" }]`;
                        }
                    } else {

                        if (isUtf8(fileBuffer)) {
                            fileData.SFDXData = fileBuffer.toString('utf8');
                            fileData.SFDXDataType = 'utf8';
                        } else {
                            fileData.SFDXData = fileBuffer.toString('base64');
                            fileData.SFDXDataType = 'base64';
                        }

                        jobInfo.sfdxData.push(fileData);
                    }
                } catch (e) {
                    VlocityUtils.error(e);
                }
            }
        }
    }
};

DataPacksUtils.prototype.withoutMetadataExtension = function(filePath) {
    return DataPacksUtils.withoutMetadataExtension(filePath);
}

DataPacksUtils.withoutMetadataExtension = function(filePath) {
    var metaFileIndex = filePath.indexOf('-meta.xml');
    var baseFilePath = filePath;

    if (metaFileIndex > 0) {
        baseFilePath = filePath.substring(0, metaFileIndex);
    }

    return baseFilePath;
}

DataPacksUtils.prototype.deploySalesforce = async function(jobInfo) {

    VlocityUtils.verbose('Deploying Metadata');

    var sfdxProject = this.getSFDXProject(jobInfo);
    var sfdxFolder = sfdxProject.sfdxProject.packageDirectories[0].path;

    var deploymentOptions = { targetusername: this.vlocity.sfdxUsername };

    if (jobInfo.specificManifestKeys && !jobInfo.deployAllSalesforce) {
        
        deploymentOptions.sourcepath = '';

        for (var key of jobInfo.specificManifestKeys) {

            var keyWithNamespace = key.replace(/%vlocity_namespace%/g, this.vlocity.namespace);

            if (fs.existsSync(path.join(sfdxFolder, 'main', 'default', keyWithNamespace))) {
                VlocityUtils.verbose('Checking file true', keyWithNamespace);
                if (deploymentOptions.sourcepath) {
                    deploymentOptions.sourcepath += ',';
                }
                
                deploymentOptions.sourcepath += path.join(sfdxFolder, 'main', 'default', keyWithNamespace);
            }
        }
    } else {
        deploymentOptions.sourcepath = sfdxFolder;
    }

    if (deploymentOptions.sourcepath) {
        
        VlocityUtils.verbose('Deploying Metadata', deploymentOptions.sourcepath);
        try {
            var response = await this.vlocity.utilityservice.sfdx('source:deploy', deploymentOptions);
            for (var includedFile of response.deployedSource) {
                var metadataKey;

                if (includedFile.filePath) {
                    var folder = 'default' + path.sep;
                    metadataKey = includedFile.filePath.substring(includedFile.filePath.lastIndexOf(folder)+folder.length);
                } else {
                    metadataKey = `${includedFile.type}/${includedFile.fullName}`;
                }
              
                metadataKey = metadataKey.replace(this.vlocity.namespace, '%vlocity_namespace%').replace(/\\/g, '/');

                VlocityUtils.success('Metadata Deployed', metadataKey);
                jobInfo.currentStatus[metadataKey] = 'Success';
            }
        } catch (deploymentErrors) {
            VlocityUtils.verbose('Salesforce Metadata Deploy Error', JSON.stringify(deploymentErrors, null, 2));
            jobInfo.hasError = true;

            var resultsByFilePath = {};

            if (Array.isArray(deploymentErrors)) {
                for (var deployedFile of deploymentErrors) {

                    if (resultsByFilePath[deployedFile.filePath]) {

                        if (deployedFile.error) {
                            resultsByFilePath[deployedFile.filePath].error += `\n${deployedFile.error}`;
                        }
                        
                    } else {
                        resultsByFilePath[deployedFile.filePath] = deployedFile;
                    }
                }
            }

            var allDeployedFiles = jobInfo.specificManifestKeys;
            if (!allDeployedFiles) {
                allDeployedFiles = [];
                var allFiles = []
                this.getFilesRecursive(deploymentOptions.sourcepath, allFiles);
                allFiles.forEach(file => {
                    allDeployedFiles.push(path.relative(path.join(sfdxFolder, 'main', 'default'), file));
                });
            }

            for (var keyFromFile of allDeployedFiles) {
                var key = keyFromFile.replace(/\\/g, '/');
                var filePath = path.join(sfdxFolder, 'main', 'default', key);
                
                if (fs.existsSync(filePath)) {
                    var metaFileIndex = filePath.indexOf('-meta.xml');
                    var baseFilePath = filePath;

                    if (metaFileIndex > 0) {
                        baseFilePath = filePath.substring(0, metaFileIndex);
                    }
                    if (deploymentErrors.message == 'Unknown SFDX Error') {
                        jobInfo.currentErrors[key] = 'Unknown SFDX Error. Check Salesforce Setup -> Deployment Status Page for Full Error Details.';
                        jobInfo.currentStatus[key] = 'Error';
                    } else if (resultsByFilePath[filePath] && resultsByFilePath[filePath].error) {
                        jobInfo.currentStatus[key] = 'Error';
                        jobInfo.currentErrors[key] = resultsByFilePath[filePath].error;
                    } else if (resultsByFilePath[baseFilePath] && resultsByFilePath[baseFilePath].error) {
                        jobInfo.currentStatus[key] = 'Error';
                        jobInfo.currentErrors[key] = resultsByFilePath[baseFilePath].error;
                    } else {
                        jobInfo.currentStatus[key] = 'Not Deployed';
                    }
                }
            }
        }
    }
}

DataPacksUtils.prototype.loadIgnoreFile = function (projectPath) {
    const ignoreFilePath = path.resolve(projectPath, '.vlocityignore');

    if (fs.existsSync(ignoreFilePath)) {
        this.ignoreFileMap = ignore().add(fs.readFileSync(ignoreFilePath, 'utf8').split('\n'));
    }
}


DataPacksUtils.prototype.getBulkJobObjectName =  function (dataPackType) {
    if(dataPackType === 'CalculationMatrix') {
        return this.vlocity.namespacePrefix + "CalculationMatrixRow__c";
    }
    else if(dataPackType === 'OmniScript') {
        return this.vlocity.namespacePrefix + "Element__c";
    }
}
DataPacksUtils.prototype.getBulkJobObjectKey =  function (dataPackType) {
    if(dataPackType === 'CalculationMatrix') {
        return this.vlocity.namespacePrefix + "CalculationMatrixVersionId__c";
    }
    else if(dataPackType === 'OmniScript') {
        return this.vlocity.namespacePrefix + "OmniScriptId__c";
    }
}