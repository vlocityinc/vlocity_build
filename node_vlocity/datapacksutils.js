var fs = require("fs-extra");
var path  = require('path');
var stringify = require('json-stable-stringify');

// use consts for setting the namespace prefix so that we easily can reference it later on in this file
const namespacePrefix = 'vlocity_namespace';
const namespaceFieldPrefix = '%' + namespacePrefix + '%__';

var DataPacksUtils = module.exports = function(vlocity) {
	this.vlocity = vlocity || {};

	this.dataPacksExpandedDefinition = JSON.parse(fs.readFileSync(path.join(__dirname, "datapacksexpanddefinition.json"), 'utf8'));
};

DataPacksUtils.prototype.getSourceKeyDefinitionFields = function(SObjectType) {

	if (this.dataPacksExpandedDefinition.SourceKeyDefinitions[SObjectType]) {
		return this.dataPacksExpandedDefinition.SourceKeyDefinitions[SObjectType];
	}

	if (this.dataPacksExpandedDefinition.SourceKeyDefinitions[this.getWithNamespace(SObjectType)]) {
		return this.dataPacksExpandedDefinition.SourceKeyDefinitions[this.getWithNamespace(SObjectType)];
	}

	return []; 
}

DataPacksUtils.prototype.isValidType = function(dataPackType) {
	return this.dataPacksExpandedDefinition.hasOwnProperty(dataPackType); 
}

DataPacksUtils.prototype.isValidSObject = function(dataPackType, SObjectType) {
	return dataPackType == 'SObject' || (this.isValidType(dataPackType) && (this.dataPacksExpandedDefinition[dataPackType].hasOwnProperty(SObjectType) || this.dataPacksExpandedDefinition[dataPackType].hasOwnProperty(this.getWithNamespace(SObjectType)))); 
}

DataPacksUtils.prototype.getWithoutNamespace = function(field) {
	var nspos = field.indexOf(namespaceFieldPrefix);
	return nspos != -1 ? field.substring(nspos + namespaceFieldPrefix.length) : field;
}

DataPacksUtils.prototype.getWithNamespace = function(field) {
	return namespaceFieldPrefix + field;
}

DataPacksUtils.prototype.getDataField = function(dataPackData) {
	var dataKey;

	Object.keys(dataPackData.VlocityDataPackData).forEach(function(key) {

		if (Array.isArray(dataPackData.VlocityDataPackData[key]) && dataPackData.VlocityDataPackData[key].length > 0 && dataPackData.VlocityDataPackData[key][0].VlocityRecordSObjectType) {
			dataKey = dataPackData.VlocityDataPackData[key][0].VlocityRecordSObjectType;
		}
	});

	return dataKey; 
}

DataPacksUtils.prototype.getSortFields = function(dataPackType, SObjectType) {
	return this.getExpandedDefinition(dataPackType, SObjectType, "SortFields");
}

DataPacksUtils.prototype.getFilterFields = function(dataPackType, SObjectType) {
	return this.getExpandedDefinition(dataPackType, SObjectType, "FilterFields");
}

DataPacksUtils.prototype.getFileName = function(dataPackType, SObjectType) {
	return this.getExpandedDefinition(dataPackType, SObjectType, "FileName");
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

DataPacksUtils.prototype.isAllowParallel = function(dataPackType) {
	return this.getExpandedDefinition(dataPackType, null, "SupportParallel");
}

DataPacksUtils.prototype.isSoloDeploy = function(dataPackType) {
	return this.getExpandedDefinition(dataPackType, null, "SoloDeploy");
}

DataPacksUtils.prototype.isAllowHeadersOnly = function(dataPackType) {
	return this.getExpandedDefinition(dataPackType, null, "AllowHeadersOnly");
}

DataPacksUtils.prototype.getExportGroupSizeForType = function(dataPackType) {
	return this.getExpandedDefinition(dataPackType, null, "ExportGroupSize");
}

DataPacksUtils.prototype.getApexImportDataKeys = function(SObjectType) {
	var defaults = ["VlocityRecordSObjectType", "Name" ];
	var apexImportDataKeys = this.dataPacksExpandedDefinition.ApexImportDataKeys[SObjectType];

	if (apexImportDataKeys) {
		return defaults.concat(apexImportDataKeys);
	}

	return defaults;
}

DataPacksUtils.prototype.isCompiledField = function(dataPackType, SObjectType, field) {
	var compiledFields = this.getExpandedDefinition(dataPackType, SObjectType, "CompiledFields");
	return compiledFields && compiledFields.indexOf(field) != -1;
}

DataPacksUtils.prototype.getExpandedDefinition = function(dataPackType, SObjectType, dataKey) {
	var definitionValue;

	if (this.isValidType(dataPackType)) {

		if (SObjectType) {
			if (this.dataPacksExpandedDefinition[dataPackType][SObjectType]) {
				definitionValue = this.dataPacksExpandedDefinition[dataPackType][SObjectType][dataKey]; 
			} else if (this.dataPacksExpandedDefinition[dataPackType][this.getWithNamespace(SObjectType)]) {
				definitionValue = this.dataPacksExpandedDefinition[dataPackType][this.getWithNamespace(SObjectType)][dataKey];
			}
		} else {
			definitionValue = this.dataPacksExpandedDefinition[dataPackType][dataKey]; 
		}
	}
	if (!definitionValue) {
		definitionValue = this.dataPacksExpandedDefinition.DefaultValues[dataKey]; 
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
        return fs.statSync(path.join(srcpath, file)).isDirectory();
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

			if (typeof(man) == 'object') {
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
		return Promise.reject('The specified file \'' +filePath+ '\' does not exist.');
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

DataPacksUtils.prototype.getDataPackHash = function(dataPack) {

	var clonedDataPackData = JSON.parse(stringify(dataPack));

	// Remove these as they would not be real changes
	clonedDataPackData.VlocityDataPackParents = null;
	clonedDataPackData.VlocityDataPackAllRelationships = null;

	return this.hashCode(stringify(clonedDataPackData));
};

DataPacksUtils.prototype.printJobStatus = function(jobInfo) {

	var totalRemaining = 0;
	var successfulCount = 0;
	var errorsCount = 0;

	Object.keys(jobInfo.currentStatus).forEach(function(dataPackKey) {
		if (jobInfo.currentStatus[dataPackKey] == 'Ready') {
			totalRemaining++;
		} else if (jobInfo.currentStatus[dataPackKey] == 'Header') {
			totalRemaining++;
		} else if (jobInfo.currentStatus[dataPackKey] == 'Success') {
			successfulCount++;
		} else if (jobInfo.currentStatus[dataPackKey] == 'Error') {
			errorsCount++;
		}
	});

	var elapsedTime = (Date.now() - jobInfo.startTime) / 1000;

	console.log('\x1b[32m', 'Successful: ' + successfulCount + ' Errors: ' + errorsCount + ' Remaining: ' + totalRemaining + ' Elapsed Time: ' + Math.floor((elapsedTime / 60)) + 'm ' + Math.floor((elapsedTime % 60)) + 's');
};