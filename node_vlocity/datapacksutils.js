var fs = require("fs-extra");
var path  = require('path');
var stringify = require('json-stable-stringify');
var async = require('async');

// use consts for setting the namespace prefix so that we easily can reference it later on in this file
const namespacePrefix = 'vlocity_namespace';
const namespaceFieldPrefix = '%' + namespacePrefix + '%__';

var DataPacksUtils = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};

    this.dataPacksExpandedDefinition = JSON.parse(fs.readFileSync(path.join(__dirname, "datapacksexpanddefinition.json"), 'utf8'));

    if (this.vlocity.namespace) {
        this.dataPacksExpandedDefinition = this.updateExpandedDefinitionNamespace(this.dataPacksExpandedDefinition);
    }
  
    this.runJavaScriptModules = {};

    this.startTime = new Date().toISOString();
    this.alreadyWrittenLogs = [];
};

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

        if (typeof currentData === 'string' && currentData.indexOf(namespaceFieldPrefix) == -1 && currentData.indexOf('__c') > 0) {
            return namespaceFieldPrefix + currentData;
        }

        return currentData;
    } 
};

DataPacksUtils.prototype.overrideExpandedDefinition = function(expandedDefinition) {
    this.overrideExpandedDefinitions = JSON.parse(JSON.stringify(expandedDefinition).replace(/vlocity_namespace/g, '%vlocity_namespace%'));
};

DataPacksUtils.prototype.getDataField = function(dataPackData) {
    var dataKey;

    Object.keys(dataPackData.VlocityDataPackData).forEach(function(key) {

        if (Array.isArray(dataPackData.VlocityDataPackData[key]) && dataPackData.VlocityDataPackData[key].length > 0 && dataPackData.VlocityDataPackData[key][0].VlocityRecordSObjectType) {
            dataKey = dataPackData.VlocityDataPackData[key][0].VlocityRecordSObjectType;
        }
    });

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

DataPacksUtils.prototype.getSortFields = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "SortFields");
}

DataPacksUtils.prototype.isDoNotExpand = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "DoNotExpand");
}

DataPacksUtils.prototype.getFilterFields = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "FilterFields");
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

DataPacksUtils.prototype.getFolderName = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "FolderName");
}

DataPacksUtils.prototype.getFileType = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "FileType");
}

DataPacksUtils.prototype.getJsonFields = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "JsonFields");
}

DataPacksUtils.prototype.getReplacementFields = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "ReplacementFields");
}

DataPacksUtils.prototype.isNonUnique = function(dataPackType, SObjectType) {
    return this.getExpandedDefinition(dataPackType, SObjectType, "NonUnique");
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

DataPacksUtils.prototype.isAllowParallel = function(dataPackType) {
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

DataPacksUtils.prototype.getApexImportDataKeys = function(SObjectType) {
    var defaults = ["VlocityRecordSObjectType", "Name"];
    var apexImportDataKeys = this.getSourceKeyDefinitionFields(SObjectType); 

    if (apexImportDataKeys) {
        return defaults.concat(apexImportDataKeys);
    }

    return defaults;
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

DataPacksUtils.prototype.getDirectories = function(srcpath) {
    return fs.readdirSync(srcpath).filter(function(file) {
        return fs.statSync(path.join(srcpath, file)).isDirectory() && fs.readdirSync(path.join(srcpath, file)).length > 0;
    });
};

DataPacksUtils.prototype.getFiles = function(srcpath) {
    return fs.readdirSync(srcpath).filter(function(file) {
        return fs.statSync(path.join(srcpath, file)).isFile();
    });
};

DataPacksUtils.prototype.fileExists = function(srcpath) {
    try {
        fs.statSync(srcpath);
    } catch (e) {
        return false;
    }
    
    return true;
}

DataPacksUtils.prototype.isInManifest = function(dataPackData, manifest) {
    
    if (manifest[dataPackData.VlocityDataPackType]) {
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

DataPacksUtils.prototype.loadApex = function(projectPath, filePath, currentContextData) {
    console.log('Loading APEX code from: ' +  projectPath + '/' + filePath);

    if (this.vlocity.datapacksutils.fileExists(projectPath + '/' + filePath)) {
        var apexFileName = projectPath + '/' + filePath;
    } else if (this.vlocity.datapacksutils.fileExists('apex/' + filePath)) {
        var apexFileName = 'apex/' + filePath;
    } else {
        return Promise.reject('The specified file \'' + filePath + '\' does not exist.');
    }

    if (apexFileName) {
        var apexFileData = fs.readFileSync(apexFileName, 'utf8');
        var includes = apexFileData.match(/\/\/include(.*?);/g);
        var includePromises = [];

        if (includes) {
            var srcdir = path.dirname(apexFileName);
            for (var i = 0; i < includes.length; i++) {
                var replacement = includes[i];
                var className = replacement.replace("//include ", "").replace(";", "");             
                includePromises.push(
                    this.loadApex(srcdir, className, currentContextData).then((includedFileData) => {
                        apexFileData = apexFileData.replace(replacement, includedFileData);
                        return apexFileData;
                    }
                ));         
            }
        }

        return Promise.all(includePromises).then(() => {
            if (currentContextData) {
                apexFileData = apexFileData.replace(/CURRENT_DATA_PACKS_CONTEXT_DATA/g, JSON.stringify(currentContextData));
            }
            return apexFileData
                .replace(/%vlocity_namespace%/g, this.vlocity.namespace)
                .replace(/vlocity_namespace/g, this.vlocity.namespace);
        });
    } else {
        return Promise.reject('ProjectPath or filePath arguments passed as null or undefined.');        
    }
}

DataPacksUtils.prototype.runApex = function(projectPath, filePath, currentContextData) {

    return this
        .loadApex(projectPath, filePath, currentContextData)
        .then((apexFileData) => { 
            return new Promise((resolve, reject) => {
                this.vlocity.jsForceConnection.tooling.executeAnonymous(apexFileData, (err, res) => {

                    if (err) return reject(err);
                    if (res.success === true) return resolve(true);
                    if (res.compileProblem) {
                        console.log('\x1b[36m', '>>' ,'\x1b[0m APEX Compilation Error:', res.compileProblem);
                    } 
                    if (res.exceptionMessage) {
                        console.log('\x1b[36m', '>>' ,'\x1b[0m APEX Exception Message:', res.exceptionMessage);
                    }
                    if (res.exceptionStackTrace) {
                        console.log('\x1b[36m', '>>' ,'\x1b[0m APEX Exception StackTrace:', res.exceptionStackTrace);
                    }
                    return reject(res.compileProblem || res.exceptionMessage || 'APEX code failed to execute but no exception message was provided');
                });
            });
        });
};

DataPacksUtils.prototype.runJavaScript = function(projectPath, filePath, currentContextData, callback) {

    var pathToRun = path.join(projectPath, filePath);

    if (!this.runJavaScriptModules[pathToRun]) {
        this.runJavaScriptModules[pathToRun] = require(path.join(projectPath, filePath));
    }

    this.runJavaScriptModules[pathToRun](currentContextData, callback);
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

// Stolen from StackOverflow
DataPacksUtils.prototype.guid = function(seed) {

    if (typeof seed === 'string') {
        seed = this.hashCode(seed);
    } else if (!seed) {
        seed = Math.floor((1 + Math.random()) * 0x10000) 
    }

    function random() {
        var x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
    }

    function s4() {
        return Math.floor((1 + random()) * 0x10000)
        .toString(16)
        .substring(1);
    }

    return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
    s4() + '-' + s4() + s4() + s4();
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

            if (!childData) {
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

DataPacksUtils.prototype.getDataPackHash = function(dataPack, jobInfo) {

    var clonedDataPackData = JSON.parse(stringify(dataPack));

    var beforePreprocess = stringify(dataPack);

    this.vlocity.datapacksexpand.preprocessDataPack(clonedDataPackData, jobInfo);

    var afterPreprocess = stringify(clonedDataPackData);

    // Remove these as they would not be real changes
    clonedDataPackData.VlocityDataPackParents = null;
    clonedDataPackData.VlocityDataPackAllRelationships = null;

    var dataField = this.getDataField(clonedDataPackData);

    this.removeUnhashableFields(clonedDataPackData.VlocityDataPackType, clonedDataPackData.VlocityDataPackData[dataField][0]);

    return stringify(clonedDataPackData);
    return this.hashCode(stringify(clonedDataPackData));
};

DataPacksUtils.prototype.endsWith = function(str, suffix) {
    return str.indexOf(suffix, str.length - suffix.length) !== -1;
}

DataPacksUtils.prototype.printJobStatus = function(jobInfo) {

    var totalRemaining = 0;
    var successfulCount = 0;
    var errorsCount = 0;

    Object.keys(jobInfo.currentStatus).forEach(function(dataPackKey) {
        if (jobInfo.currentStatus[dataPackKey] == 'Ready' 
                || jobInfo.currentStatus[dataPackKey] == 'Header' || jobInfo.currentStatus[dataPackKey] == 'Added') {
                totalRemaining++;
        } else if (jobInfo.currentStatus[dataPackKey] == 'Error') {
            errorsCount++;
        } else if (jobInfo.currentStatus[dataPackKey] == 'Success') {
            successfulCount++;
        }
    });

    if (jobInfo.extendedManifest) {
        Object.keys(jobInfo.extendedManifest).forEach(function(dataPackType) {
            totalRemaining += jobInfo.extendedManifest[dataPackType].length;
        });
    }

    var elapsedTime = (Date.now() - jobInfo.startTime) / 1000;

    console.log('\x1b[36m', 'Current Status >>', '\x1b[0m', jobInfo.jobAction);
    console.log('\x1b[32m', 'Successful >>', '\x1b[0m', successfulCount);
    console.log('\x1b[31m', 'Errors >>', '\x1b[0m', errorsCount);
    console.log('\x1b[33m', 'Remaining >>', '\x1b[0m', totalRemaining);
    console.log('\x1b[36m', 'Elapsed Time >>', '\x1b[0m', Math.floor((elapsedTime / 60)) + 'm ' + Math.floor((elapsedTime % 60)) + 's');

    if (jobInfo.hasError) {
        jobInfo.errorMessage = jobInfo.errors.join('\n');
    }
};