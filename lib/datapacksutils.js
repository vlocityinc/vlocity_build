var fs = require("fs-extra");
var path  = require('path');
var stringify = require('json-stable-stringify');
var async = require('async');
var yaml = require('js-yaml');

// use consts for setting the namespace prefix so that we easily can reference it later on in this file
const namespacePrefix = 'vlocity_namespace';
const namespaceFieldPrefix = '%' + namespacePrefix + '%__';

var CURRENT_INFO_FILE;

var DataPacksUtils = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};

    CURRENT_INFO_FILE = path.join(vlocity.tempFolder, 'currentJobInfo.json');

    this.dataPacksExpandedDefinition = yaml.safeLoad(fs.readFileSync(path.join(__dirname, 'datapacksexpanddefinition.yaml'), 'utf8'));

    this.runJavaScriptModules = {};

    this.startTime = new Date().toISOString();
    this.alreadyWrittenLogs = [];
    this.perfTimers = {};
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
    var dataKey;

    if (dataPackData.VlocityDataPackData) {
        Object.keys(dataPackData.VlocityDataPackData).forEach(function(key) {

            if (Array.isArray(dataPackData.VlocityDataPackData[key]) && dataPackData.VlocityDataPackData[key].length > 0 && dataPackData.VlocityDataPackData[key][0].VlocityRecordSObjectType) {
                dataKey = dataPackData.VlocityDataPackData[key][0].VlocityRecordSObjectType;
            }
        });
    }
    return dataKey; 
}

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
    return this.getExpandedDefinition(dataPackType, null, "ExportGroupSize");
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

DataPacksUtils.prototype.getApexSObjectTypeList = function(dataPackType, SObjectType, field) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "ApexSObjectTypeList");
}

DataPacksUtils.prototype.isCompiledField = function(dataPackType, SObjectType, field) {
    var compiledFields = this.getExpandedDefinition(dataPackType, SObjectType, "CompiledFields");
    return compiledFields && compiledFields.indexOf(field) != -1;
}

DataPacksUtils.prototype.hasExpandedDefinition = function(dataPackType, SObjectType) {
    return this.dataPacksExpandedDefinition[dataPackType] && this.dataPacksExpandedDefinition[dataPackType][SObjectType];
}

DataPacksUtils.prototype.getExpandedDefinition = function(dataPackType, SObjectType, dataKey) {
    var definitionValue;

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
                    dirs = dirs.concat(this.getDirectories(packName, recusive, rootpath || srcpath))
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

DataPacksUtils.prototype.initializeFromProject = function(jobInfo) {
    var self = this;

    if (!self.fileExists(jobInfo.projectPath)) {
        return;
    }

    var jobInfoTemp = JSON.parse(stringify(jobInfo));

    jobInfoTemp.singleFile = true;
    VlocityUtils.silence = true;
    jobInfoTemp.compileOnBuild = false;
    jobInfoTemp.manifest = null;

    self.vlocity.datapacksbuilder.buildImport(jobInfo.projectPath, jobInfoTemp, {}, function(dataJson) { 
        VlocityUtils.silence = false;

        if (dataJson && dataJson.dataPacks) {
            dataJson.dataPacks.forEach(function(dataPack) {
                self.getParents(jobInfo, dataPack);
            });
        }
    });
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

DataPacksUtils.prototype.loadApex = function(projectPath, filePath) {
    var possiblePaths = [
        path.join(projectPath, filePath),
        path.join(__dirname, '..', 'apex', filePath),
        filePath
    ];

    var apexFilePath = possiblePaths.find(apexFilePath => 
        this.vlocity.datapacksutils.fileExists(apexFilePath));

    if (!apexFilePath) {
        return Promise.reject('The specified file \'' + filePath + '\' does not exist.');
    }

    VlocityUtils.report('Loading Apex', apexFilePath);

    var apexFileData = fs.readFileSync(apexFilePath, 'utf8');
    var includes = apexFileData.match(/\/\/include(.*?);/gi);
    var includePromises = [];

    if (includes) {
        var srcdir = path.dirname(apexFilePath);
        includes.forEach(replacement => {        
            var className = replacement.match(/\/\/include(.*?);/i)[1].trim();  
            includePromises.push(
                this.loadApex(srcdir, className).then(includedFileData => {
                    return {
                        replacement: replacement,
                        fileData: includedFileData
                    };
                }
            ));         
        });
    }

    return Promise.all(includePromises).then(includedClasses => {        
        includedClasses.forEach(value => {
            apexFileData = apexFileData.replace(value.replacement, value.fileData);
        });
        return apexFileData;
    });
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

DataPacksUtils.prototype.runApex = function(projectPath, filePaths, currentContextData) {
    var self = this;
    filePaths = Array.isArray(filePaths) ? filePaths : [ filePaths ];

    return new Promise((resolve, reject) =>
        async.eachSeries(filePaths, function(filePath, callback) {
            self.loadApex(projectPath, filePath).then(function(loadedApex) {
                async.eachSeries(self.splitApex(loadedApex, currentContextData), function(apexChunk, callbackApex) {
                    self.vlocity.jsForceConnection.tooling.executeAnonymous(apexChunk, (err, res) => {
                        if (!res || res.success === true) {
                            VlocityUtils.success('Apex Success', filePath);
                            return callbackApex();
                        }

                        if (res.compileProblem) {
                            VlocityUtils.error('APEX Compilation Error', res.compileProblem);
                        } 
                        if (res.exceptionMessage) {
                            VlocityUtils.error('APEX Exception Message', res.exceptionMessage);
                        }
                        if (res.exceptionStackTrace) {
                            VlocityUtils.error('APEX Exception StackTrace', res.exceptionStackTrace);
                        }

                        callbackApex('Apex Error >> ' + (err || res.compileProblem || res.exceptionMessage || 'APEX code failed to execute but no exception message was provided'));
                    })
                }, 
                function(err, result) {
                    if (err) {
                        callback(err);
                    } else {
                        callback();
                    }
                });
            }).catch(function(reason) {
                VlocityUtils.error('APEX Error', reason);
                callback(reason);
            });
    }, function(err, result) {
        if (err) {
            reject(err);
        } else {
            resolve();
        }
    }));
};

DataPacksUtils.prototype.runJavaScript = function(projectPath, filePath, currentContextData, jobInfo, callback) {
    var self = this;
    
    var pathToRun = path.join(projectPath, filePath);

    var defaultJSPath = path.resolve(path.join(__dirname, '..', 'javascript', filePath));

    if (!self.fileExists(pathToRun) && self.fileExists(defaultJSPath)) {
        pathToRun = defaultJSPath;
    }

    pathToRun = path.resolve(pathToRun);
    if (!self.runJavaScriptModules[pathToRun]) {
        self.runJavaScriptModules[pathToRun] = require(pathToRun);
    }

    self.runJavaScriptModules[pathToRun](self.vlocity, currentContextData, jobInfo, callback);
};

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

    self.getExpandedDefinition(dataPack.VlocityDataPackType, null, 'DisplayName').forEach(function(field) {
        if (dataPack[field]) {
            if (name) {
                name += ' ';
            }

            name += dataPack[field] ;
        }
    });

    if (!name && dataPack.Name) {
        name = dataPack.Name;
    }

    if (dataPack.Id) {
        if (name) {
            name += ' (' + dataPack.Id + ')';
        } else {
            name = dataPack.Id;
        }
    }

    return name;
}

DataPacksUtils.prototype.getDataPackHashable = function(dataPack, jobInfo) {
    var self = this;

    var clonedDataPackData = JSON.parse(stringify(dataPack));

    self.vlocity.datapacksexpand.preprocessDataPack(clonedDataPackData, jobInfo);

    // Remove these as they would not be real changes
    clonedDataPackData.VlocityDataPackParents = null;
    clonedDataPackData.VlocityDataPackAllRelationships = null;

    var dataField = self.getDataField(clonedDataPackData);

    clonedDataPackData.VlocityDataPackType, clonedDataPackData.VlocityDataPackData[dataField].forEach(function(sobjectData) {
        self.removeUnhashableFields(clonedDataPackData.VlocityDataPackType, sobjectData);
    });

    return clonedDataPackData;
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

DataPacksUtils.prototype.printJobStatus = function(jobInfo) {

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
    VlocityUtils.verbose('Log File', path.join('vlocity-temp', 'logs', jobInfo.logName));
    
    if (jobInfo.forceDeploy) {
        VlocityUtils.report('Force Deploy', 'On');
    }

    VlocityUtils.report('Current Status', jobInfo.jobAction);
    Object.keys(statusCount).forEach(status => (statusReportFunc[status] || VlocityUtils.report)(status, statusCount[status]));
    VlocityUtils.report('Elapsed Time', Math.floor((elapsedTime / 60)) + 'm ' + Math.floor((elapsedTime % 60)) + 's');

    if (jobInfo.hasError) {
        jobInfo.errorMessage = jobInfo.errors.join('\n').replace(/%vlocity_namespace%/g, this.vlocity.namespace);
    }

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

    try {
        fs.outputFileSync('VlocityBuildLog.yaml', yaml.dump(logInfo, { lineWidth: 1000 }));
        fs.copySync('VlocityBuildLog.yaml', path.join('vlocity-temp', 'logs', jobInfo.logName));
    } catch (e) {
        VlocityUtils.log(e);
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
        
    fs.outputFileSync('VlocityBuildErrors.log', errorLog);
};

DataPacksUtils.prototype.saveCurrentJobInfo = function(jobInfo) {
    fs.outputFileSync(CURRENT_INFO_FILE, stringify(jobInfo, { space: 4 }), 'utf8');
    fs.copySync(CURRENT_INFO_FILE, CURRENT_INFO_FILE + '.bak');
};

DataPacksUtils.prototype.loadCurrentJobInfo = function(jobInfo) {
    try {
        Object.assign(jobInfo, JSON.parse(fs.readFileSync(CURRENT_INFO_FILE, 'utf8')));
        this.saveCurrentJobInfo(jobInfo);
    } catch (e) {
        try {
            Object.assign(jobInfo, JSON.parse(fs.readFileSync(CURRENT_INFO_FILE + '.bak', 'utf8')));
            this.saveCurrentJobInfo(jobInfo);
        } catch (ex) {
            VlocityUtils.error('Error Loading Saved Job', e, ex);
        }
    }
};