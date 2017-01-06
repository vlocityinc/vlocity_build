var fs = require("fs-extra");
var path  = require('path');

var DataPacksUtils = module.exports = function(vlocity) {
	this.vlocity = vlocity || {};

	this.dataPacksExpandedDefinition = JSON.parse(fs.readFileSync("./node_vlocity/datapacksexpanddefinition.json", 'utf8'));
};

DataPacksUtils.prototype.getSourceKeyDefinitionFields = function(SObjectType) {

	if (this.dataPacksExpandedDefinition.SourceKeyDefinitions[SObjectType]) {
		return this.dataPacksExpandedDefinition.SourceKeyDefinitions[SObjectType];
	}

	return this.dataPacksExpandedDefinition.DefaultValues.SourceKeyFields; 
}

DataPacksUtils.prototype.isValidType = function(dataPackType) {
	return this.dataPacksExpandedDefinition.hasOwnProperty(dataPackType); 
}

DataPacksUtils.prototype.isValidSObject = function(dataPackType, SObjectType) {
	return dataPackType == 'SObject' || (this.isValidType(dataPackType) && this.dataPacksExpandedDefinition[dataPackType].hasOwnProperty(SObjectType)); 
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

DataPacksUtils.prototype.getFileType = function(dataPackType, SObjectType) {
	return this.getExpandedDefinition(dataPackType, SObjectType, "FileType");
}

DataPacksUtils.prototype.getJsonFields = function(dataPackType, SObjectType) {
	return this.getExpandedDefinition(dataPackType, SObjectType, "JsonFields");
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


DataPacksUtils.prototype.runApex = function(projectPath, filePath) {
	var self = this;

	console.log('Executing runApex: ' + projectPath + ' -- ' + filePath);
	if (projectPath && filePath) {			
		var apexFileName;

		if (self.vlocity.datapacksutils.fileExists(projectPath + '/' + filePath)) {
			apexFileName = projectPath + '/' + jobInfo.preJobApex[action];
		} else if (self.vlocity.datapacksutils.fileExists('apex/' + filePath)) {
			apexFileName = 'apex/' + filePath;
		}

		if (apexFileName) {
			var apexFileData = fs.readFileSync(apexFileName, 'utf8');

			var includedClasses = apexFileData.match(/\/\/include(.*?);/g);

			if (includedClasses) {
				var srcdir = path.dirname(apexFileName);

				for (var i = 0; i < includedClasses.length; i++) {

					var className = includedClasses[i].replace("//include ", "").replace(";", "");

					var includedFileData = fs.readFileSync(srcdir+'/'+className, 'utf8');

					apexFileData = apexFileData.replace(includedClasses[i], includedFileData);
				}		
			}

			apexFileData = apexFileData.replace(/vlocity_namespace/g, this.vlocity.namespace);

			return self.vlocity.jsForceConnection.tooling.executeAnonymous(apexFileData, function(err, res) {

				if (res.success === false) {
					if (res.compileProblem) {
						console.log('\x1b[36m', '>>' ,'\x1b[0m Compilation Error', res.compileProblem);
					} 
					if (res.exceptionMessage) {
						console.log('\x1b[36m', '>>' ,'\x1b[0m Exception Message', res.exceptionMessage);
					} 

					if (res.exceptionStackTrace) {
						console.log('\x1b[36m', '>>' ,'\x1b[0m Exception StackTrace', res.exceptionStackTrace);
					}

					return Promise.resolve(true);
				} else {
					return Promise.resolve(true);
				}				
			});
		} else {
			return Promise.resolve(true);
		}
	} else {
		return Promise.resolve(true);
	}
}







