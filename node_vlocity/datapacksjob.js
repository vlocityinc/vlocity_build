var fs = require('fs-extra');
var async = require('async');
var stringify = require('json-stable-stringify');

var DataPacksJob = module.exports = function(vlocity) {
	this.vlocity = vlocity || {};
};

var SUPPORTED_JOB_KEY_TO_OPTION_MAP = {
	ignoreAllErrors: 'ignoreAllErrors', 
	maxDepth: 'maxDepth', 
	processMultiple: 'processMultiple', 
	dataPackName: 'name', 
	description: 'description', 
	version: 'version', 
	source: 'source',
	alreadyExportedKeys: 'alreadyExportedKeys'
};

var MAX_PER_GROUP = 5;

DataPacksJob.prototype.getOptionsFromJobInfo = function(jobInfo) {
	var options = {};

	Object.keys(SUPPORTED_JOB_KEY_TO_OPTION_MAP).forEach(function(jobKey) {

		if (jobInfo[jobKey] != null) {
			options[SUPPORTED_JOB_KEY_TO_OPTION_MAP[jobKey]] = jobInfo[jobKey];
		}
	});

	return options;
}

DataPacksJob.prototype.runJob = function(jobData, jobName, action, onSuccess, onError, skipUpload) {
	var self = this;

    var jobInfo = jobData[jobName];

    jobInfo.jobName = jobName;
    jobInfo.jobAction = action;

    if (!jobInfo.projectPath) {
    	jobInfo.projectPath = './';
    }

    if (jobInfo.queries) {
	    for (var i = 0; i < jobInfo.queries.length; i++) {
	    	if (typeof jobInfo.queries[i] === 'string') {
	    		jobInfo.queries[i] = jobData.QueryDefinitions[jobInfo.queries[i]];
	    	}
	    }
	}

    var toolingApi = self.vlocity.jsForceConnection.tooling;

	function executeJob() {
		var prePromise;

    	if (jobInfo.preJobApex && jobInfo.preJobApex[action]) {

    		// Builds the JSON Array sent to Anon Apex that gets run before deploy
    		// Issues when > 32000 chars. Need to add chunking for this. 
    		if (action == 'Deploy') {
    			self.vlocity.datapacksbuilder.initializeImportStatus(jobInfo.projectPath + '/' + jobInfo.expansionPath, jobInfo.manifest);
    		}

    		prePromise = self.vlocity.datapacksutils.runApex(jobInfo.projectPath, jobInfo.preJobApex[action], self.vlocity.datapacksbuilder.importDataSummary);
    	} else {
    		prePromise = Promise.resolve(true);
    	}

    	prePromise.then(function() {
    		return new Promise(function(resolve, reject) {
    			try {
	    			self.doRunJob(jobInfo, action, resolve);
	    		} catch (e) {
	    			jobInfo.hasError = true;
	    			jobInfo.errorMessage = e.message;
	    			reject(jobInfo);
	    		}
    		});
    	})
    	.then(function(jobStatus) {
    		
	    	if (!jobStatus.hasError && jobInfo.postJobApex && jobInfo.postJobApex[action]) {
				return self.vlocity.datapacksutils.runApex(jobInfo.projectPath, jobInfo.postJobApex[action]);
	    	} else {
	    		return Promise.resolve(jobStatus);
	    	}
    	})
    	.then(function(jobStatus) {

    		if (self.vlocity.verbose) {
				console.log('\x1b[36m', '>>' ,'\x1b[0m', jobStatus);
			}

    		if (!jobStatus.hasError) {
				if (onSuccess) {
					onSuccess(jobStatus);
				} else {
					console.log('jobStatus', stringify(jobStatus, { space: 2 }));
				}
			} else {
				if (onError) {
					onError(jobStatus);
				} else {
					console.log('jobStatus', jobStatus.errorMessage);
				}
			}
    	}, onError);
   	}

   	if (skipUpload) {
   		executeJob();
   	} else {
    	self.vlocity.checkLogin(executeJob);
    }
};

DataPacksJob.prototype.doRunJob = function(jobInfo, action, onComplete) {
	var self = this;

	// Will not continue a single DataPack, but will continue when there are breaks in the job
	if (action == 'Continue') {
		jobInfo = JSON.parse(fs.readFileSync('vlocity-deploy-temp/currentJobInfo.json', 'utf8'));
		action = jobInfo.jobAction;
	}

	if (action == 'Export') {
		self.exportJob(jobInfo, onComplete);
	} else if (action == 'Import') {
		self.importJob(jobInfo, onComplete);
	} else if (action == 'Deploy') {
		self.deployJob(jobInfo, onComplete);
	} else if (action == 'BuildFile') {
		self.buildFile(jobInfo, onComplete);
	} else if (action == 'ExpandFile') {
		self.expandFile(jobInfo, onComplete);
	} else {
		console.log('Bad Job Info', jobInfo);
	}
}

DataPacksJob.prototype.buildManifestFromQueries = function(jobInfo, onComplete) {
	var self = this;

	if (jobInfo.queries) {

		if (!jobInfo.manifest) {
			jobInfo.manifest = {};
		}

		async.eachSeries(jobInfo.queries, function(queryData, callback) {

			if (!jobInfo.manifest[queryData.VlocityDataPackType]) {
				jobInfo.manifest[queryData.VlocityDataPackType] = [];
			}

			var query = queryData.query.replace(/%vlocity_namespace%/g, self.vlocity.namespace);
			
			self.vlocity.jsForceConnection.query(query, function(err, res) {

				if (self.vlocity.verbose) {
					if (err) {
						console.log('\x1b[32m', 'Query result had error >>' ,'\x1b[0m', err);
					}
					if (res) {
						console.log('\x1b[36m', 'Query result >>' ,'\x1b[0m', res);
					}
				}

				res.records.forEach(function(record) {
					jobInfo.manifest[queryData.VlocityDataPackType].push(record.Id);
				});

				callback();
			});

		}, function(err, result) {
			onComplete(jobInfo);
		});
	} else {
		onComplete(jobInfo);
	}
}

DataPacksJob.prototype.exportJob = function(jobInfo, onComplete) {
	var self = this;

	self.vlocity.checkLogin(function(){
		self.buildManifestFromQueries(jobInfo, function(jobStatus) {
			self.exportFromManifest(jobStatus, onComplete);
		});
	});
}

DataPacksJob.prototype.exportFromManifest = function(jobInfo, onComplete) {
	var self = this;

	// All this allows continuing an in process
	if (jobInfo.extendedManifest == null) {
		jobInfo.extendedManifest = {};
	}

	if (jobInfo.alreadyExportedKeys == null) {
		jobInfo.alreadyExportedKeys = [];
	}

	if (jobInfo.alreadyExportedIdsByType == null) {
		jobInfo.alreadyExportedIdsByType = {};
	}

	if (jobInfo.totalExported == null) {
		jobInfo.totalExported = 0;
	}

	if (jobInfo.totalToExport == null) {
		jobInfo.totalToExport = 0;
	}

	if (jobInfo.vlocityKeysToNewNamesMap == null) {
		jobInfo.vlocityKeysToNewNamesMap = {};
	}

	if (jobInfo.vlocityRecordSourceKeyMap == null) {
		jobInfo.vlocityRecordSourceKeyMap = {};
	}

	if (jobInfo.toExportGroups == null) {
		jobInfo.toExportGroups = [[]];

		Object.keys(jobInfo.manifest).forEach(function(dataPackType) {
			
			jobInfo.manifest[dataPackType].forEach(function(exData) {
				if (jobInfo.toExportGroups[jobInfo.toExportGroups.length - 1].length >= MAX_PER_GROUP) {
					jobInfo.toExportGroups.push([]);
				}

				if (typeof exData === 'object') {
					if (exData.VlocityDataPackType == null) {
						exData.VlocityDataPackType = dataPackType;
					}

					jobInfo.toExportGroups[jobInfo.toExportGroups.length - 1].push(exData);
				} else {
					jobInfo.toExportGroups[jobInfo.toExportGroups.length - 1].push({ Id: exData, VlocityDataPackType: dataPackType });
				}

				jobInfo.totalToExport++;
			});
		});
	}

	async.eachSeries(jobInfo.toExportGroups, function(exportDataFromManifest, callback) {
		fs.outputFileSync('vlocity-deploy-temp/currentJobInfo.json', stringify(jobInfo, { space: 4 }), 'utf8');

		var exportData = exportDataFromManifest.filter(function(dataPack) {
			return jobInfo.alreadyExportedIdsByType[dataPack.VlocityDataPackType] == null || jobInfo.alreadyExportedIdsByType[dataPack.VlocityDataPackType].indexOf(dataPack.Id) == -1;
		});

		if (exportData.length == 0) {
			console.log('Skipping ');
			callback();
		} else {
			self.vlocity.datapacks.export('SObject', exportData, self.getOptionsFromJobInfo(jobInfo),
				function(result) {
					if (self.vlocity.verbose) {
						console.log('\x1b[36m', 'datapacks.export >>' ,'\x1b[0m', result);
					}
					if (!jobInfo.VlocityDataPackIds) {
						jobInfo.VlocityDataPackIds = [];
					}

					jobInfo.VlocityDataPackIds.push(result.VlocityDataPackId);

					self.vlocity.datapacks.getDataPackData(result.VlocityDataPackId, function(dataPackData) {
						if (self.vlocity.verbose) {
							console.log('\x1b[36m', 'datapacks.getDataPackData >>' ,'\x1b[0m', dataPackData);
						}

						if (dataPackData.dataPacks != null) {
							dataPackData.dataPacks.forEach(function(dataPack) {
								if (jobInfo.alreadyExportedKeys.indexOf(dataPack.VlocityDataPackKey) == -1) {

									if (dataPack.VlocityDataPackStatus == 'Success') {
										
										jobInfo.totalExported++;

										if (jobInfo.alreadyExportedIdsByType[dataPack.VlocityDataPackType] == null) {
											jobInfo.alreadyExportedIdsByType[dataPack.VlocityDataPackType] = [];
										}

										if (dataPack.VlocityDataPackData != null 
											&& dataPack.VlocityDataPackData.Id != null) {
											jobInfo.alreadyExportedIdsByType[dataPack.VlocityDataPackType].push(dataPack.VlocityDataPackData.Id);
										}
										
										jobInfo.alreadyExportedKeys.push(dataPack.VlocityDataPackKey);
									} else if (dataPack.VlocityDataPackStatus == 'Ready') {

										if (jobInfo.extendedManifest[dataPack.VlocityDataPackType] == null) {
											jobInfo.extendedManifest[dataPack.VlocityDataPackType] = [];
										}

										jobInfo.extendedManifest[dataPack.VlocityDataPackType].push(dataPack.VlocityDataPackData);
									}
								}
							});
						}
						
				        if (jobInfo.expansionPath) {
				        	self.vlocity.datapacksexpand.expand(jobInfo.projectPath + '/' + jobInfo.expansionPath, dataPackData, jobInfo);
				        }

				        console.log('\x1b[32m', 'Finished: ' + jobInfo.totalExported + ' To Export: ' + jobInfo.totalToExport);

				        var afterDelete = function() {
				        	callback();
				        }

				        if (jobInfo.delete != false) {
				        	self.vlocity.datapacks.delete(result.VlocityDataPackId, self.getOptionsFromJobInfo(jobInfo), afterDelete, afterDelete);
				        } else {
				        	callback();
				        }
					});
				}, 
				function(err) {
			   		if (self.vlocity.verbose) {
						console.error('\x1b[31m', 'datapacks.export >>' ,'\x1b[0m', err);
					}

			        if (jobInfo.expansionPath) {
			        	self.vlocity.datapacks.getDataPackData(err.VlocityDataPackId, function(dataPackData) {
					   		
			        		self.vlocity.datapacksexpand.expand(jobInfo.projectPath + '/' + jobInfo.expansionPath, dataPackData, jobInfo);

			        		if (self.vlocity.verbose) {
			        			console.error('\x1b[31m', 'writing error file to >>' ,'\x1b[0m', 'vlocity-deploy-temp/deployError.json');
								fs.outputFileSync('vlocity-deploy-temp/deployError.json', stringify(dataPackData, { space: 4 }), 'utf8');
							}

							self.getJobErrors(dataPackData, jobInfo, onComplete);
			        	});
			        } else {
						self.getJobErrors(err, jobInfo, onComplete);
					}
			});
		}
	}, function(err, result) {
		console.log('Chaining Job - Total Exports', Object.keys(jobInfo.extendedManifest).length);
		if (Object.keys(jobInfo.extendedManifest).length > 0) {
			jobInfo.manifest = jobInfo.extendedManifest;
			jobInfo.extendedManifest = {};
			jobInfo.toExportGroups = null;

			self.exportFromManifest(jobInfo, onComplete);
		} else {
			onComplete(jobInfo);
		}
	});	
};

DataPacksJob.prototype.importJob = function(jobInfo, onComplete) {
	var self = this;

	var dataJson = fs.readFileSync(jobInfo.projectPath + '/' + jobInfo.buildFile, 'utf8');
	
	self.vlocity.datapacks.import(JSON.parse(dataJson), self.getOptionsFromJobInfo(jobInfo), 
		function(result) {
			jobInfo.VlocityDataPackId = result.VlocityDataPackId;

			if (jobInfo.activate) {
				self.vlocity.datapacks.activate(jobInfo.VlocityDataPackId, ['ALL'], self.getOptionsFromJobInfo(jobInfo), 
					function(activateResult){
						if (onComplete) {
							onComplete(jobInfo);
						}
					},
					onComplete);
			} else if (onComplete) {
				onComplete(jobInfo);
			}
		}, 
		function(err) {
			self.getJobErrors(err, jobInfo, onComplete);
		});
	
};

DataPacksJob.prototype.buildFile = function(jobInfo, onComplete) {
	var self = this;

	var fullDataPath = jobInfo.projectPath;

	jobInfo.singleFile = true;

	if (self.vlocity.verbose) {
		console.log('\x1b[31m', 'buildImport >>' ,'\x1b[0m', fullDataPath, jobInfo.manifest, jobInfo);
	}
	var dataJson = self.vlocity.datapacksbuilder.buildImport(fullDataPath, jobInfo.manifest, jobInfo);

	if (dataJson && jobInfo.dataPackName) {
		dataJson.name = jobInfo.dataPackName;
	}

	if (dataJson) {
		fs.outputFileSync(jobInfo.projectPath + '/' + jobInfo.buildFile, stringify(dataJson, { space: 4 }), 'utf8');
		// also create .resource-meta.xml
		fs.outputFileSync(jobInfo.projectPath + '/' + jobInfo.buildFile + '-meta.xml', '<?xml version="1.0" encoding="UTF-8"?><StaticResource xmlns="http://soap.sforce.com/2006/04/metadata"><cacheControl>Public</cacheControl><contentType>text/json</contentType></StaticResource>',
				'utf8');
		console.log('\x1b[31m', 'Creating File >>' ,'\x1b[0m', jobInfo.projectPath + '/' + jobInfo.buildFile);

	} else {
		jobInfo.hasError = true;
		jobInfo.errorMessage = 'Project Path Empty: ' + fullDataPath;
	}

	onComplete(jobInfo);
}

DataPacksJob.prototype.expandFile = function(jobInfo, onComplete) {
	var self = this;

	self.vlocity.datapacksexpand.expandFile(jobInfo.projectPath + '/' + jobInfo.expansionPath, jobInfo.projectPath + '/' + jobInfo.buildFile, jobInfo);

	if (onComplete) {
		onComplete(jobInfo);
	}
}

DataPacksJob.prototype.deployJob = function(jobInfo, onComplete) {
	var self = this;

	if (!jobInfo.VlocityDataPackIds) {
		jobInfo.VlocityDataPackIds = [];
	}

	// If there are both queries and manifest then assume the user wants to deploy all
	// Otherwise only deploy the manifest
	var deployManifest = jobInfo.manifest;
	if (jobInfo.queries) {
		deployManifest = null;
	}

	var dataJson = self.vlocity.datapacksbuilder.buildImport(jobInfo.projectPath, deployManifest, jobInfo);

	if (dataJson) {
		fs.outputFileSync('./vlocity-deploy-temp/deploy.json', stringify(dataJson, { space: 4 }), 'utf8');
	}

	if (dataJson) {
		this.vlocity.datapacks.import(dataJson, self.getOptionsFromJobInfo(jobInfo),
			function(result) {
				jobInfo.VlocityDataPackIds.push(result.VlocityDataPackId);
				self.deployJob(jobInfo, onComplete);
			},
			function(err) {
				self.getJobErrors(err, jobInfo, onComplete);
			});
	} else {
		if ((jobInfo.activate || jobInfo.delete) && jobInfo.VlocityDataPackIds) {
			async.eachSeries(jobInfo.VlocityDataPackIds, function(dataPackId, callback) {
				if (jobInfo.activate) {
					if (!jobInfo.activationStatus) {
						jobInfo.activationStatus = {};
					}

					self.vlocity.datapacks.activate(dataPackId, ['ALL'], self.getOptionsFromJobInfo(jobInfo), 
						function(activateResult) {
							jobInfo.activationStatus[dataPackId] = 'Success';

							if (jobInfo.delete) {
								self.vlocity.datapacks.delete(dataPackId, self.getOptionsFromJobInfo(jobInfo), 
									function(res) {
										callback();
									},
									function(res) {
										callback();
									});
							} else {
								callback();
							}
						}, 
						function(error) {
							jobInfo.activationStatus[dataPackId] = 'Error';

							if (jobInfo.delete) {
								self.vlocity.datapacks.delete(dataPackId, self.getOptionsFromJobInfo(jobInfo), 
									function(res) {
										callback();
									}, 
									function(res) {
										callback();
									});
							} else {
								callback();
							}
					});

				} else if (jobInfo.delete) {
					self.vlocity.datapacks.delete(dataPackId, self.getOptionsFromJobInfo(jobInfo), 
						function(res) {
							callback();
						}, 
						function(res) {
							callback();
						});
				}
			}, function(err, result) {
				if (onComplete) {
					onComplete(jobInfo);
				}
			});
		} else if (onComplete) {
			onComplete(jobInfo);
		}
	}
};

DataPacksJob.prototype.getJobErrors = function(err, jobInfo, onComplete) {
	var self = this;

	var processErrors = function(errors) {
		if (!jobInfo.errors) {
			jobInfo.errors = [];
		}

		if (self.vlocity.verbose) {
			console.error('\x1b[31m', 'datapacks.getDataPackData.errors >>' ,'\x1b[0m', errors);
		}

		jobInfo.hasError = true;
		jobInfo.errors = jobInfo.errors.concat(errors);
		jobInfo.errorMessage = "Export Failed:\n" + jobInfo.errors.join("\n");

		var afterDelete = function() {
			onComplete(jobInfo);
		}

	    if (jobInfo.delete) {
	    	self.vlocity.datapacks.delete(err.VlocityDataPackId ? err.VlocityDataPackId : err.dataPackId, self.getOptionsFromJobInfo(jobInfo), afterDelete, afterDelete);
	    } else {
	    	onComplete(jobInfo);
	    }
	}

	if (err.VlocityDataPackId) {
		self.vlocity.datapacks.getErrors(err.VlocityDataPackId, processErrors );
	} else if (err.dataPackId) {
		self.vlocity.datapacks.getErrorsFromDataPack(err, processErrors);
	} else {
		onComplete(jobInfo);
	}
};

DataPacksJob.prototype.getPublishedDataPacks = function(jobInfo, onComplete) {
	var self = this;

	this.vlocity.datapacks.getAllDataPacks(function(allDataPacks) {

		async.eachSeries(allDataPacks, function(dataSummaryData, callback) {

			self.vlocity.datapacks.getDataPackData(dataSummaryData.dataPackId, function(dataPackData) {

				var filename = jobInfo.projectPath + '/' + dataPath + '/' + dataPackData.name + '.json';

		        fs.outputFileSync(filename, stringify(dataPackData, { space: 4 }));
		       
		        if (jobInfo.expansionPath) {
		        	self.vlocity.datapacksexpand.expand(jobInfo.projectPath + '/' + jobInfo.expansionPath, dataPackData, jobInfo);
		        }

				jobInfo.allStatus[dataSummaryData.dataPackId] = 'Success';

				callback();
			});
		}, function(err, result) {
			if (onComplete) {
				onComplete(jobInfo);
			}
		});
	});

}

