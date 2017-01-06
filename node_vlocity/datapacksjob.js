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
	source: 'source' 
};

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
    		prePromise = self.vlocity.datapacksutils.runApex(jobInfo.projectPath, jobInfo.preJobApex[action]);
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
						console.log('\x1b[31m', 'Query result had error >>' ,'\x1b[0m', err);
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

	async.eachSeries(Object.keys(jobInfo.manifest), function(dataPackType, callback) {
		var dataList = jobInfo.manifest[dataPackType];
		var exportData = [];

		dataList.forEach(function(exData) {
			if (typeof exData === 'object') {
				exportData.push(exData);
			} else {
				exportData.push({ Id: exData });
			}
		});

		self.vlocity.datapacks.export(dataPackType, exportData, self.getOptionsFromJobInfo(jobInfo),
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

			        if (jobInfo.expansionPath) {
			        	self.vlocity.datapacksexpand.expand(jobInfo.projectPath + '/' + jobInfo.expansionPath, dataPackData, jobInfo);
			        }

			        var afterDelete = function() {
			        	callback();
			        }

					self.vlocity.datapacks.delete(result.VlocityDataPackId, self.getOptionsFromJobInfo(jobInfo), afterDelete, afterDelete);
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
		        }
				else {
					self.getJobErrors(err, jobInfo, onComplete);
				}
		});
	}, function(err, result) {
        onComplete(jobInfo);
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

