var fs = require("fs-extra");
var path  = require('path');
var stringify = require('json-stable-stringify');

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
	return field.substring(field.indexOf('%vlocity_namespace%__') + 21);
}

DataPacksUtils.prototype.getWithNamespace = function(field) {
	return '%vlocity_namespace%__' + field;
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

DataPacksUtils.prototype.runApex = function(projectPath, filePath, currentContextData, shouldDebug, callback) {
	var self = this;

	console.log('Executing runApex: ' + projectPath + ' -- ' + filePath);
	if (projectPath && filePath) {
		var apexFileName;

		if (self.vlocity.datapacksutils.fileExists(projectPath + '/' + filePath)) {
			apexFileName = projectPath + '/' + filePath;
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

					var includedFileData = fs.readFileSync(srcdir + '/' + className, 'utf8');

					apexFileData = apexFileData.replace(includedClasses[i], includedFileData);
				}		
			}

			if (currentContextData) {
				apexFileData = apexFileData.replace(/CURRENT_DATA_PACKS_CONTEXT_DATA/g, JSON.stringify(currentContextData));
			}

			apexFileData = apexFileData.replace(/%vlocity_namespace%/g, this.vlocity.namespace);
			apexFileData = apexFileData.replace(/vlocity_namespace/g, this.vlocity.namespace);

			var thirtyMinutesLater = new Date();
            thirtyMinutesLater.setMinutes(thirtyMinutesLater.getMinutes() + 30);
            var thirtyMinutesLaterString = thirtyMinutesLater.toISOString();

    		return new Promise(function(resolve, reject) {

    			if (shouldDebug) {
	    			self.vlocity.jsForceConnection.tooling.sobject('DebugLevel').find({ DeveloperName: "SFDC_DevConsole" }).execute(function(err, debugLevel) {

	    				if (debugLevel[0].Id) {
				            self.vlocity.jsForceConnection.tooling.sobject('TraceFlag').create({
				                TracedEntityId: self.vlocity.jsForceConnection.userInfo.id,
				                DebugLevelId: debugLevel[0].Id,
				                ExpirationDate: thirtyMinutesLaterString,
				                LogType: 'DEVELOPER_LOG'
				            }, function(err, res) {
				                resolve();
				            });
				        } else {
				        	console.log('\x1b[36m', '>>' ,'\x1b[0 No Logging Level called: SFDC_DevConsole');
				        	resolve();
				        }
			        });
			    } else {
			    	resolve();
			    }
		    })
		    .then(function() {
		    	return new Promise(function(resolve, reject) {
			    	if (apexFileData.length > 32000)
			    	{
			    		console.log('\x1b[36m', '>>' ,'\x1b[o File Data Length: ' + apexFileData.length + ' is too large for a single Anonymous Apex call. Please use the preStepApex or remove the CURRENT_DATA_PACKS_CONTEXT_DATA variable from your Apex classes for preJobApex.');
			    		return reject();
			    	}

			    	console.log('Executing executeAnonymous: ', apexFileData);

					self.vlocity.jsForceConnection.tooling.executeAnonymous(apexFileData, function(err, res) {

						console.log('Executing res: ', res, err);
						if (res == null) {
							console.log('\x1b[36m', '>>' ,'\x1b[0m Compilation Error', err);
						}

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
						}

						if (shouldDebug) {
							self.vlocity.jsForceConnection.query("Select Id from ApexLog where Operation LIKE '%executeAnonymous' ORDER BY Id DESC LIMIT 1", function(err, res) {
								
	                            self.vlocity.jsForceConnection.request("/services/data/v37.0/tooling/sobjects/ApexLog/" + res.records[0].Id + "/Body/", function(err, logBody) {
	                            	
	                                if (err) { 
	                                    console.error('err', err); 
	                                }

	                                var allLoggingStatments = [];

	                                logBody.split("\n").forEach(function(line) {
	                                    var isDebug = line.indexOf('USER_DEBUG');

	                                    if (isDebug > -1) {
	                                       console.log(line);
	                                    }
	                                });

	                                if (callback) {
										callback();
									} else {
										return resolve();
									}
	                            });
		                    });
						} else {
							resolve();
						}
					});				
				});
		    }).then(function(){
		    	if (callback) {
		    		callback();
		    	}
		    });
		} else {
			return Promise.resolve();
		}
	} else {
		return Promise.resolve();
	}
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










