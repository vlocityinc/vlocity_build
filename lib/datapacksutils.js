var fs = require("fs-extra");
var path  = require('path');
var stringify = require('json-stable-stringify');
var async = require('async');
var yaml = require('js-yaml');
var gitDiff = require('git-diff');
var ignore = require( 'ignore');
const fileType = require('file-type');
const isUtf8 = require('is-utf8');


// use consts for setting the namespace prefix so that we easily can reference it later on in this file
const namespacePrefix = 'vlocity_namespace';
const namespaceFieldPrefix = '%' + namespacePrefix + '%__';

var CURRENT_INFO_FILE;

const SALEFORCE_API_VERSION = '44.0';

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

DataPacksUtils.prototype.getFilterFields = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "FilterFields");
}

DataPacksUtils.prototype.getSummaryFields = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "SummaryFields");
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

DataPacksUtils.prototype.fileExists = function(srcpath) {
    try {
        fs.statSync(srcpath);
    } catch (e) {
        return false;
    }
    
    return true;
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

    if (self.vlocity.namespace == 'NoNamespace') {
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

DataPacksUtils.prototype.removeUnhashableFields = function(dataPackType, dataPackData) {
    var self = this;

    if (dataPackData && dataPackData.VlocityRecordSObjectType) {

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

DataPacksUtils.prototype.getDataPackHashable = function(dataPack, jobInfo) {
    var self = this;

    var clonedDataPackData = JSON.parse(JSON.stringify(dataPack));

    self.vlocity.datapacksexpand.preprocessDataPack(clonedDataPackData, jobInfo);

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

    for (var dataPackKey of allKeys) {
        var sourceDataPack = allSourceDataPacks[dataPackKey];
        var targetDataPack = allTargetDataPacks[dataPackKey];
        var dataPackType = dataPackKey.substring(0, dataPackKey.indexOf('/'));
       
        if (jobInfo.diffType[dataPackKey]) {
            if (sourceDataPack.SFDXData) {
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

                            deletedObj.fieldDiffs = await this.getFieldDiffsForSObjects(sourceDataPack.VlocityDataPackType, {}, obj);

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
            }
        }
    }
};

var ignoredFields = new Set([ 'VlocityRecordSourceKey', 'CurrencyIsoCode', 'VlocityRecordSObjectType', 'VlocityDataPackIsIncluded', 'VlocityDataPackType', 'VlocityDiffParentField', 'VlocityDiffParentKey' ]);
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
            gitDiff: gitDiffForParents[0],
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
        // Put values into primary SObject to simplify later adding fieldDiff
        for (var i = 0; i < sourceTitleObjects.length; i++) {

            var titleObjectForType = sourceTitleObjects[i];
            var sourceValue = sourceTitleObjects[i].value;
            var targetValue = targetTitleObjects && targetTitleObjects[i] ? targetTitleObjects[i].value : null;

            var titleObject = {
                editable: {
                    VlocityRecordSourceKey: titleObjectForType.VlocityRecordSourceKey,
                    VlocityRecordSObjectType: titleObjectForType.field
                },
                diffType: targetValue == null ? 'New' : (targetValue != sourceValue ? 'Changed' : 'Unchanged'),
                fieldDiffs: [],
                VlocityDataPackKey: sourceDataPack.VlocityDataPackKey,
                VlocityDataPackType: sourceDataPack.VlocityDataPackType,
                VlocitySObjectRecordLabel: titleObjectForType.VlocitySObjectRecordLabel
            };

            if (titleObjectForType.fieldType == 'DisplayOnly') {
                titleObject.editable.TitleObjectDisplay = titleObjectForType.value;
            } else {
                titleObject.editable.TitleObjectCode = titleObjectForType.value;
            }
            
            var gitDiffForTitle = this.getGitDiffs(targetValue || sourceValue, sourceValue, 'json');
            var hunkIndex = 0;
            for (var gitHunk of gitDiffForTitle) {
                
                titleObject.fieldDiffs.push({
                    fieldImportance: 'Title',
                    fieldType: titleObjectForType.fieldType,
                    status: (sourceValue == targetValue || targetValue == null) ? 'Title' : 'Changed',
                    gitDiff: gitHunk,
                    value: typeof sourceValue == 'object' ? stringify(sourceValue, { space: 4 }) : sourceValue,
                    old: (targetValue && typeof targetValue == 'object') ? stringify(targetValue, { space: 4 }) : targetValue,
                    field: (titleObjectForType.fieldType == 'DisplayOnly' ? 'TitleObjectDisplay' : 'TitleObjectCode') + (hunkIndex++),
                    label: titleObjectForType.fieldLabel,
                    VlocityRecordSourceKey: titleObjectForType.VlocityRecordSourceKey
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

DataPacksUtils.prototype.getFieldDiffsForSObjects = async function(dataPackType, sourceObject, targetObject) {
    var self = this;
    var fieldDiffs = [];

    var unhashableFields = self.getUnhashableFields(dataPackType, sourceObject.VlocityRecordSObjectType) || [];

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

        if (!ignoredFields.has(field) 
        && !Array.isArray(sourceObject[field]) 
        && field.indexOf('.') == -1
        && unhashableFields.indexOf(field) == -1
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
                                gitDiff: diffHunk,
                                status: 'Changed',
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
                        fieldType: 'Reference',
                        status: targetMatchingKey ? (sourceMatchingKey == targetMatchingKey ? 'Unchanged' : 'Changed') : 'New',
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
                        gitDiff: diffHunk,
                        status: fieldStatus,
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

        if (!blacklistedTypes.includes(type)) {
            VlocityUtils.report('Diffing...', sourceSfdxObject.VlocityDataPackKey);
            thisDiff = this.getGitDiffs(targetSfdxObject.SFDXData || sourceSfdxObject.SFDXData, sourceSfdxObject.SFDXData, type);
            VlocityUtils.report('Diffed', sourceSfdxObject.VlocityDataPackKey);
        } else {
            thisDiff = this.getNoDiffs('(Hidden)', 'txt', diffType);
        }
    } else {
        thisDiff = this.getNoDiffs('(Hidden)', 'txt', diffType);
    }

    var fieldDiffs = [];

    for (var diffHunk of thisDiff) {
        fieldDiffs.push({
            VlocityRecordSourceKey: sourceSfdxObject.VlocityDataPackKey,
            field: "SFDXData",
            gitDiff: diffHunk,
            label: "Data",
            //old: diffHunk == null && targetSfdxObject && (sourceSfdxObject.SFDXData != targetSfdxObject.SFDXData) ? targetSfdxObject.SFDXData : null,
            status: diffType ? diffType : "Unchanged",
            //value: sourceSfdxObject.SFDXData,
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

    if (obj1.status == 'Changed' && obj2.status != 'Changed') {
        return -1;
    } else if (obj2.status == 'Changed') {
        return 1;
    } else if (obj1.priority && !obj2.priority) {
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
                            gitDiff: diffHunk,
                            status: 'Changed',
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
                        gitDiff: diffHunk,
                        status: 'Changed',
                        value: diffHunk == null ? sourceObjectValue : '',
                        old:  diffHunk == null ? targetObjectValue : '',
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

    var logInfo = {
        Org: this.vlocity.username,
        Version: VLOCITY_BUILD_VERSION,
        PackageVersion: this.vlocity.PackageVersion,
        Namespace: this.vlocity.namespace, 
        Job: jobInfo.jobName,
        Action: jobInfo.jobAction,
        ProjectPath: jobInfo.projectPath,
        TotalTime: Math.floor((elapsedTime / 60)) + 'm ' + Math.floor((elapsedTime % 60)) + 's',
        Count: countByStatus,
        Errors: jobInfo.errors,
        Status: keysByStatus
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

        this.lastWriteTimeJobInfo = Date.now();
        await fs.outputFile(CURRENT_INFO_FILE, JSON.stringify(jobInfo, null, 4), 'utf8');
        await fs.copy(CURRENT_INFO_FILE, CURRENT_INFO_FILE + '.bak');
        
        for (var key of nonWriteable) {
            jobInfo[key] = savedData[key];
        }

        VlocityUtils.verbose('Saving File End', Date.now() - startSaveTime);
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
                return [ this.getNoDiffs(target, type) ];
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
                    return [ `diff --git File.${type} File.${type}\n${currentHeader}${diffString}` ];
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
                            hunks.push(`diff --git File.${type} File.${type}\n${currentHeader}${currentHunk}`);
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
                            hunks.push(`diff --git File.${type} File.${type}\n${currentHeader}${currentHunk}`);
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
                    hunks.push(`diff --git File.${type} File.${type}\n${currentHeader}${currentHunk}`);
                }
                
                return hunks;
            } else {
                return [ this.getNoDiffs(target, type) ];
            }
        } else if (target && typeof target == 'string') {
            return [ this.getNoDiffs(target, type, 'Deleted') ];
        } else if (source && typeof source == 'string') {
            return [ this.getNoDiffs(source, type, 'New') ];
        }
    }

    return [ null ];
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
                    //VlocityUtils.log('queue, batchInfo:', batchInfo);
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
        VlocityUtils.log('error: ' + err);
    });

    return promise;
}

DataPacksUtils.prototype.retrieveSalesforce = async function(jobInfo) {

    VlocityUtils.report('Retrieving Salesforce');

    let allMetadata = await this.vlocity.jsForceConnection.metadata.describe(SALEFORCE_API_VERSION); 

    var deploymentOptions =  { targetusername: this.vlocity.sfdxUsername };

    var allFolderNames = [];

    for (var metaDesc of allMetadata.metadataObjects) {
        allFolderNames.push(metaDesc.directoryName);
    }

    var sfdxProject = this.getSFDXProject(jobInfo);
    var sfdxFolder = sfdxProject.sfdxProject.packageDirectories[0].path;
    
    if (jobInfo.specificManifestKeys) {
        
        deploymentOptions.sourcepath = '';

        for (var key of jobInfo.specificManifestKeys) {

            var typeIndex = key.indexOf('/');

            if ((typeIndex == -1 && allFolderNames.includes(key)) || allFolderNames.includes(key.substring(0, typeIndex))) {
                if (deploymentOptions.sourcepath) {
                    deploymentOptions.sourcepath += ',';
                }

                deploymentOptions.sourcepath += path.join(sfdxProject.sfdxPath, sfdxFolder, 'main', 'default', key);
            }
        }

        await this.runRetrieve(deploymentOptions, jobInfo);
    } else {
        var allPromises = [];

        for (var metaDesc of allMetadata.metadataObjects) {
            if (jobInfo.allAllowedTypes) {
                if (jobInfo.allAllowedTypes.Salesforce && !jobInfo.allAllowedTypes.Salesforce[metaDesc.xmlName]) {
                    continue;
                }
            } else if (unsupportedMetadataTypes.includes(metaDesc.xmlName) 
            || (jobInfo.salesforceMetadataTypes && !jobInfo.salesforceMetadataTypes.includes(metaDesc.xmlName)) 
            || (jobInfo.salesforceMetadataTypesBlacklist && jobInfo.salesforceMetadataTypesBlacklist.includes(metaDesc.xmlName))) {
                continue;
            }
            
            allPromises.push(this.retrieveByType(deploymentOptions, metaDesc, jobInfo));
        }

        var promiseResults = await Promise.all(allPromises);

        deploymentOptions.metadata = '';

        for (var promResult of promiseResults) {
            for (retrieveInfo of promResult) {
                if (retrieveInfo && retrieveInfo.metadata) {

                    if (deploymentOptions.metadata) {
                        deploymentOptions.metadata += ',';
                    }

                    deploymentOptions.metadata += retrieveInfo.metadata;
                }
            }
        }

        // Try to get all together
        var result = await this.runRetrieve(deploymentOptions, jobInfo);

        // If that fails get all separate
        if (!result) {
            for (var promResult of promiseResults) {
                for (retrieveInfo of promResult) {
                    if (retrieveInfo && retrieveInfo.metadata) {
                        await this.runRetrieve(retrieveInfo, jobInfo);
                    }
                }
            }
        }
    }
}

DataPacksUtils.prototype.runRetrieve = async function(deploymentOptions, jobInfo) {
    VlocityUtils.verbose('Run Retrieve', deploymentOptions);
    var response = await this.vlocity.utilityservice.sfdx('source:retrieve', deploymentOptions);

    if (response) {   
        for (var includedFile of response.inboundFiles || []) {
            var metadataKey = `${includedFile.type}/${includedFile.fullName}`;
            var folder = 'default/';
        
            if (includedFile.filePath) {
                metadataKey = includedFile.filePath.substring(includedFile.filePath.lastIndexOf(folder)+folder.length);
            }
            
            VlocityUtils.success('Metadata Retrieved', metadataKey);
            jobInfo.currentStatus[metadataKey] = 'Success';
        }

        return true;
    } else {
        VlocityUtils.error('Metadata Retrieve Error', deploymentOptions);
    }
}

DataPacksUtils.prototype.retrieveByType = async function(deploymentOptions, metaDesc, jobInfo) {
    var deploymentOptionsForNames = JSON.parse(JSON.stringify(deploymentOptions));

    deploymentOptionsForNames.metadata = '';

    let metaList = await this.vlocity.jsForceConnection.metadata.list([{ type: metaDesc.xmlName, folder: null }], SALEFORCE_API_VERSION);

    var allPromises = [];
            
    if (metaList) {
        
        if (!Array.isArray(metaList)) {
            metaList = [ metaList ];
        }
        
        for (var meta of metaList) {
            VlocityUtils.verbose('Processesing Metadata', meta.fullName);

            if (meta.type == 'CustomObject') {
                allPromises.push(this.getCustomObjectInfo(deploymentOptionsForNames, meta, jobInfo));
            } else if (meta.type == 'Profile' ) {
                allPromises.push(this.isCustomProfileOrAdmin(meta));
            } else if (meta.namespacePrefix == null) {
                if (deploymentOptionsForNames.metadata) {
                    deploymentOptionsForNames.metadata += ',';
                }

                deploymentOptionsForNames.metadata += `${meta.type}:${meta.fullName}`;
            }
        }
    }

    if (allPromises.length > 0) {
        var allCustomObject = await Promise.all(allPromises);

        if (metaDesc.xmlName == 'CustomObject') {
            deploymentOptionsForNames.metadata = 'CustomObject';

            for (var obj of allCustomObject) {
                if (obj && obj.metadata) {
                    deploymentOptionsForNames.metadata += ',' + obj.metadata;
                }
            }
        }

        return [ deploymentOptionsForNames ];
    } else {
        return [ deploymentOptionsForNames ];
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

    if ((customObject.fullName.match(/\_\_/g) || []).length == 1) {
        return null; 
    }

    var deploymentOptionsForNames = JSON.parse(JSON.stringify(deploymentOptions));

    deploymentOptionsForNames.metadata = '';

    VlocityUtils.verbose('Reading Custom Object', customObject.fullName);

    let read = await this.vlocity.jsForceConnection.metadata.read('CustomObject', [ customObject.fullName ]);

    if (read && !Array.isArray(read)) {
        read = [ read ];
    }

    for (var sobj of read) {
        this.getIsCustomSObjectMetadata(sobj, 'businessProcesses', 'BusinessProcess', 'fullName', 0, deploymentOptionsForNames);
        this.getIsCustomSObjectMetadata(sobj, 'compactLayouts', 'CompactLayout', 'fullName', 0, deploymentOptionsForNames);
        this.getIsCustomSObjectMetadata(sobj, 'fields', 'CustomField', 'fullName', 1, deploymentOptionsForNames);
        this.getIsCustomSObjectMetadata(sobj, 'fieldSets', 'FieldSet', 'fullName', 0, deploymentOptionsForNames);
        this.getIsCustomSObjectMetadata(sobj, 'listViews', 'ListView', 'fullName', 0, deploymentOptionsForNames);
        this.getIsCustomSObjectMetadata(sobj, 'recordTypes', 'RecordType', 'fullName', 0, deploymentOptionsForNames);
        this.getIsCustomSObjectMetadata(sobj, 'sharingReasons', 'SahringReason', 'fullName', 0, deploymentOptionsForNames);
        this.getIsCustomSObjectMetadata(sobj, 'validationRules', 'ValidationRule', 'fullName', 0, deploymentOptionsForNames);
        this.getIsCustomSObjectMetadata(sobj, 'webLinks', 'WebLink', 'fullName', 0, deploymentOptionsForNames);
    }

    if (deploymentOptionsForNames.metadata) {
       return deploymentOptionsForNames;
    }
}

DataPacksUtils.prototype.getIsCustomSObjectMetadata = function(meta, type, metaType, nameField, countOfUnderscores, deploymentOptions) {

   if (meta[type]) {
       if (!Array.isArray(meta[type])) {
            meta[type] = [ meta[type] ];
       }

       for (var met of meta[type]) {
            // Not vlocity_cmt__FieldName__c or 
            if (met[nameField] && (met[nameField].match(/\_\_/g) || []).length == countOfUnderscores) {

                if (deploymentOptions.metadata) {
                    deploymentOptions.metadata += ',';
                }

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
            "sourceApiVersion": SALEFORCE_API_VERSION
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
        fs.outputFileSync(path.join(sfdxTempFolder,'..','sfdx-project.json'), JSON.stringify({
            "packageDirectories": [
                {
                    "path": 'salesforce_sfdx',
                    "default": true
                }
            ],
            "namespace": "",
            "sfdcLoginUrl": "https://login.salesforce.com",
            "sourceApiVersion": SALEFORCE_API_VERSION
        }), { encoding: 'utf8' });

        VlocityUtils.report('SFDX Project Path', path.join(sfdxTempFolder, '..', 'sfdx-project.json'));
    }

    var sfdxPath;

    var projectSfdx = jobInfo.projectPath;
    var tempSfdx = path.join(jobInfo.projectPath, '..', 'DX');

    if (fs.existsSync(path.join(projectSfdx, 'sfdx-project.json'))) {
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
    
    jobInfo.sfdxData = [];

    var sfdxProject = this.getSFDXProject(jobInfo);
    var sfdxFolder = sfdxProject.sfdxProject.packageDirectories[0].path;
    var directories = this.getDirectories(path.join(sfdxProject.sfdxPath, sfdxFolder), true);

    for (let dir of directories) {
        VlocityUtils.report('Dir', dir);
        for (let file of this.getFiles(path.join(sfdxProject.sfdxPath, sfdxFolder, dir))) {
            VlocityUtils.report('File', file);
            if (file[0] != '.') {
                var folder = 'default/';
                var dataPackType = dir.substring(dir.lastIndexOf(folder)+folder.length);
                try {
                    var fileData = {
                        VlocityDataPackDisplayLabel: `${dataPackType}/${file}`,
                        VlocityDataPackKey: `${dataPackType}/${file}`,
                        VlocityDataPackStatus: "Ready",
                        VlocityDataPackType: dataPackType,
                        VlocityRecordSourceKey: `${dataPackType}/${file}`
                    };

                    var fileBuffer = fs.readFileSync(path.join(sfdxProject.sfdxPath, sfdxFolder, dir, file));

                    if (isUtf8(fileBuffer)) {
                        fileData.SFDXData = fileBuffer.toString('utf8');
                        fileData.SFDXDataType = 'utf8';
                    } else {
                        fileData.SFDXData = fileBuffer.toString('base64');
                        fileData.SFDXDataType = 'base64';

                    }
    
                    jobInfo.sfdxData.push(fileData);

                } catch (e) {
                    VlocityUtils.error(e);
                }
            }
        }
    }
};

DataPacksUtils.prototype.deploySalesforce = async function(jobInfo) {

    VlocityUtils.verbose('Deploying Metadata');

    var sfdxProject = this.getSFDXProject(jobInfo);
    var sfdxFolder = sfdxProject.sfdxProject.packageDirectories[0].path;

    var deploymentOptions = { targetusername: this.vlocity.sfdxUsername };

    if (jobInfo.specificManifestKeys) {
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

        VlocityUtils.verbose('Deploying Metadata', deploymentOptions);

        var response = await this.vlocity.utilityservice.sfdx('source:deploy', deploymentOptions);

        if (response) {   
            for (var includedFile of response) {
                var metadataKey;

                if (includedFile.filePath) {
                    var folder = 'default/';
                    metadataKey = includedFile.filePath.substring(includedFile.filePath.lastIndexOf(folder)+folder.length);
                } else {
                    metadataKey = `${includedFile.type}/${includedFile.fullName}`;
                }
              
                metadataKey = metadataKey.replace(this.vlocity.namespace, '%vlocity_namespace%');

                VlocityUtils.success('Metadata Deployed', metadataKey);
                jobInfo.currentStatus[metadataKey] = 'Success';
            }
        } else {
            jobInfo.hasError = true;

            if (jobInfo.specificManifestKeys) {

                for (var key of jobInfo.specificManifestKeys) {
                    if (fs.existsSync(path.join(sfdxFolder, 'main', 'default', key))) {

                        jobInfo.currentStatus[key] = 'Error';
                        jobInfo.currentErrors[key] = 'Unknown Salesforce Deployment Error';
                    }
                }
            }
            
            VlocityUtils.error('Salesforce Metadata Deploy Error');
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