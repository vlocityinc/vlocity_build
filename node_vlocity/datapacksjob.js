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
    alreadyExportedKeys: 'alreadyExportedKeys',
    exportPacksMaxSize: 'exportPacksMaxSize',
    useVlocityTriggers: 'useVlocityTriggers'
};

var MAX_PER_GROUP = 5;
var CURRENT_INFO_FILE = 'vlocity-deploy-temp/currentJobInfo.json';

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

    if (jobInfo.queries) {
        for (var i = 0; i < jobInfo.queries.length; i++) {
            if (typeof jobInfo.queries[i] === 'string') {
                jobInfo.queries[i] = jobData.QueryDefinitions[jobInfo.queries[i]];
            }
        }
    }

    if (!jobInfo.projectPath) {
        jobInfo.projectPath = './';
    }

    if (jobInfo.OverrideExpandedDefinition) {
        self.vlocity.datapacksutils.updateExpandedDefinition(jobInfo.OverrideExpandedDefinition);
    }

    return self.runJobWithInfo(jobInfo, action, onSuccess, onError, skipUpload);
}

DataPacksJob.prototype.runJobWithInfo = function(jobInfo, action, onSuccess, onError, skipUpload) {
    var self = this;

    var toolingApi = self.vlocity.jsForceConnection.tooling;

    return new Promise(function(resolve, reject) {
        if (skipUpload) {
            resolve();
        } else {
            self.vlocity.checkLogin(resolve);
        }
    })
    .then(function() {
        if (jobInfo.preJobApex && jobInfo.preJobApex[action]) {

            // Builds the JSON Array sent to Anon Apex that gets run before deploy
            // Issues when > 32000 chars. Need to add chunking for this. 
            if (action == 'Deploy') {
                self.vlocity.datapacksbuilder.initializeImportStatus(jobInfo.projectPath + '/' + jobInfo.expansionPath, jobInfo.manifest, jobInfo);
            }

            self.vlocity.datapacksutils.runApex(jobInfo.projectPath, jobInfo.preJobApex[action], jobInfo.preDeployDataSummary).then(resolve);
        } else {
            return Promise.resolve();
        }
    })
    .then(function() {
        return new Promise(function(resolve, reject) {
            try {
                self.doRunJob(jobInfo, action, resolve);
            } catch (e) {
                console.log('\x1b[31m', e.stack);

                jobInfo.hasError = true;
                jobInfo.errorMessage = e.message;
                reject(jobInfo);
            }
        })
    })
    .then(function(jobStatus) {
        
        if (!jobStatus.hasError && jobInfo.postJobApex && jobInfo.postJobApex[action]) {
            return self.vlocity.datapacksutils.runApex(jobInfo.projectPath, jobInfo.postJobApex[action], jobInfo.postDeployResults);
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
                console.log('\x1b[31m', 'jobStatus', stringify(jobStatus, { space: 2 }));
            }
        } else {
            if (onError) {
                onError(jobStatus);
            } else {
                console.log('\x1b[31m', 'jobStatus', jobStatus.errorMessage);
            }
        }
    });
}

DataPacksJob.prototype.doRunJob = function(jobInfo, action, onComplete) {
    var self = this;

    // Will not continue a single DataPack, but will continue when there are breaks in the job
    if (action == 'Continue' || action == 'Retry') {
        jobInfo = JSON.parse(fs.readFileSync(CURRENT_INFO_FILE, 'utf8'));

        jobInfo.hasError = false;
        jobInfo.startTime = Date.now();
        jobInfo.supportParallel = jobInfo.defaultMaxParallel > 1;
        jobInfo.headersOnly = false;
        
        if (jobInfo.jobAction == 'Export') {
            if (action == 'Retry') {

                if (!jobInfo.extendedManifest) {
                    jobInfo.extendedManifest = {};
                }

                jobInfo.currentStatus = {};

                Object.keys(jobInfo.manifest).forEach(function(dataPackType) {

                    if (jobInfo.extendedManifest[dataPackType] == null) {
                        jobInfo.extendedManifest[dataPackType] = [];
                    }

                    jobInfo.extendedManifest[dataPackType] = jobInfo.extendedManifest[dataPackType].concat(jobInfo.manifest[dataPackType]);
                });

                if (jobInfo.queries) {
                    jobInfo.manifest = null;
                }
            }
        }

        if (jobInfo.jobAction == 'Deploy') {

            jobInfo.preDeployDataSummary = [];

            if (action == 'Retry') {
                console.log('\x1b[32m', 'Back to Ready');

                Object.keys(jobInfo.currentStatus).forEach(function(dataPackKey) {
                    if (jobInfo.currentStatus[dataPackKey] == 'Error' || jobInfo.currentStatus[dataPackKey] == 'Header') {
                        jobInfo.currentStatus[dataPackKey] = 'Ready';
                    };
                });
            }
        }

        if (action == 'Retry') {
            jobInfo.errors = [];
        }

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
    } else if (action == 'GetDiffs') {
        self.getExportDiffs(jobInfo, onComplete);
    } else if (action == 'GetDiffsAndDeploy') {
        self.getExportDiffsAndDeploy(jobInfo, onComplete);
    } else {
        console.log('\x1b[31m', 'Bad Job Info', jobInfo);
    }
}

DataPacksJob.prototype.buildManifestFromQueries = function(jobInfo, onComplete) {
    var self = this;

    if (jobInfo.queries && jobInfo.manifest == null) {
        jobInfo.manifest = {};

        var totalFound = 0;

        async.each(jobInfo.queries, function(queryData, callback) {

            if (!jobInfo.manifest[queryData.VlocityDataPackType]) {
                jobInfo.manifest[queryData.VlocityDataPackType] = [];
            }

            var query = queryData.query.replace(/%vlocity_namespace%/g, self.vlocity.namespace);

            console.log('\x1b[36m', 'Running Query >>', '\x1b[0m', query);
            
            self.vlocity.jsForceConnection.query(query, function(err, res) {

                if (err) {
                    console.log('\x1b[32m', 'Query result had error >>', '\x1b[0m', err);
                }

                if (self.vlocity.verbose) {
                    
                    if (res) {
                        console.log('\x1b[36m', 'Query result >>', '\x1b[0m', res);
                    }
                }

                console.log('\x1b[36m', 'Query results ' + queryData.VlocityDataPackType + ' >>' , '\x1b[0m', res.records.length);

                res.records.forEach(function(record) {

                    if (jobInfo.manifest[queryData.VlocityDataPackType].indexOf(record.Id) == -1) {
                        jobInfo.manifest[queryData.VlocityDataPackType].push(record.Id);
                        totalFound++;
                    }
                });

                callback();
            });

        }, function(err, result) {

            console.log('\x1b[32m', 'Query Total >>', '\x1b[0m', totalFound);
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

    if (jobInfo.currentStatus == null) {
        jobInfo.currentStatus = {};
    }
    
    if (jobInfo.alreadyExportedIdsByType == null) {
        jobInfo.alreadyExportedIdsByType = {};
    }

    if (jobInfo.vlocityKeysToNewNamesMap == null) {
        jobInfo.vlocityKeysToNewNamesMap = {};
    }

    if (jobInfo.vlocityRecordSourceKeyMap == null) {
        jobInfo.vlocityRecordSourceKeyMap = {};
    }

    if (jobInfo.vlocityAllParentFiles == null) {
        jobInfo.vlocityAllParentFiles = {};
    }

    if (jobInfo.startTime == null) {
        jobInfo.startTime = Date.now();
    }

    if (jobInfo.exportBuildFile && !jobInfo.addedToExportBuildFile) {
        jobInfo.addedToExportBuildFile = [];
        self.vlocity.datapacksexportbuildfile.resetExportBuildFile(jobInfo);
    }

    if (jobInfo.errors == null) {
        jobInfo.errors = [];
    }

    if (!jobInfo.VlocityDataPackIds) {
        jobInfo.VlocityDataPackIds = {};
    }

    jobInfo.toExportGroups = [[]];

    var seriesGroupMax = 1;
    if (jobInfo.defaultMaxParallel) {
        seriesGroupMax = jobInfo.defaultMaxParallel;
    }

    fs.outputFileSync(CURRENT_INFO_FILE, stringify(jobInfo, { space: 4 }), 'utf8');

    var addToExtendedManifest = false;

    Object.keys(jobInfo.manifest).forEach(function(dataPackType) {

        if (!jobInfo.alreadyExportedIdsByType[dataPackType]) {
            jobInfo.alreadyExportedIdsByType[dataPackType] = [];
        }
        
        jobInfo.manifest[dataPackType].forEach(function(exData) {

            if (typeof exData === 'object') {
                if (exData.VlocityDataPackType == null) {
                    exData.VlocityDataPackType = dataPackType;
                }
            } else {
                exData = { Id: exData, VlocityDataPackType: dataPackType };
            }

            // Skip if already exported by Key or by Id
            if (!((exData.Id && jobInfo.alreadyExportedIdsByType[dataPackType].indexOf(exData.Id) != -1) 
                || (exData.VlocityDataPackKey && jobInfo.alreadyExportedKeys.indexOf(exData.VlocityDataPackKey) != -1))) {

                var maxForType = self.vlocity.datapacksutils.getExportGroupSizeForType(dataPackType);

                if (!maxForType) {
                    maxForType = MAX_PER_GROUP;
                }

                if (!addToExtendedManifest && jobInfo.toExportGroups[jobInfo.toExportGroups.length - 1].length >= maxForType) {

                    if (jobInfo.toExportGroups.length < seriesGroupMax) {
                        jobInfo.toExportGroups.push([]);
                    } else {
                        addToExtendedManifest = true;
                    }
                }

                if (addToExtendedManifest) {
                    if (jobInfo.extendedManifest[exData.VlocityDataPackType] == null) {
                        jobInfo.extendedManifest[exData.VlocityDataPackType] = [];
                    }

                    jobInfo.extendedManifest[exData.VlocityDataPackType].push(exData);
                } else {
                    jobInfo.toExportGroups[jobInfo.toExportGroups.length - 1].push(exData);
                }
            }
        });
    });

    async.eachLimit(jobInfo.toExportGroups, seriesGroupMax, function(exportDataFromManifest, callback) {
        var exportData = exportDataFromManifest.filter(function(dataPack) {

            if ((dataPack.Id && jobInfo.alreadyExportedIdsByType[dataPack.VlocityDataPackType].indexOf(dataPack.Id) != -1) 
                || (dataPack.VlocityDataPackKey && jobInfo.alreadyExportedKeys.indexOf(dataPack.VlocityDataPackKey) != -1)) {
                return false;
            }

            console.log('\x1b[32m', 'Exporting', '\x1b[0m ', dataPack.VlocityDataPackType + ' ' + dataPack.Id);

            return true;
        });

        if (exportData.length == 0) {
            callback();
        } else {
            self.vlocity.datapacks.export(exportData[0].VlocityDataPackType, exportData, self.getOptionsFromJobInfo(jobInfo),
                function(result) {

                    fs.outputFileSync(CURRENT_INFO_FILE, stringify(jobInfo, { space: 4 }), 'utf8');
                    if (self.vlocity.verbose) {
                        console.log('\x1b[36m', 'datapacks.export >>', '\x1b[0m', result);
                    }

                    jobInfo.VlocityDataPackIds[result.VlocityDataPackId] = result.Status;

                    if (!result.VlocityDataPackId) {
                        console.log('\x1b[36m', 'datapacks.export >>', '\x1b[0m', result);
                        jobInfo.hasError = true;
                        jobInfo.errors.push(stringify(result));
                        callback();
                    } else {
                        self.vlocity.datapacks.getDataPackData(result.VlocityDataPackId, function(dataPackData) {
                            if (self.vlocity.verbose) {
                                console.log('\x1b[36m', 'datapacks.getDataPackData >>', '\x1b[0m', dataPackData);
                            }

                            if (dataPackData.dataPacks != null) {
                                dataPackData.dataPacks.forEach(function(dataPack) {

                                    if (jobInfo.currentStatus[dataPack.VlocityDataPackKey] != 'Success' && dataPack.VlocityDataPackRelationshipType != "Children") {
                                        jobInfo.currentStatus[dataPack.VlocityDataPackKey] = dataPack.VlocityDataPackStatus;
                                    }

                                    if (dataPack.VlocityDataPackStatus == 'Success') {
                                        
                                        if (jobInfo.alreadyExportedIdsByType[dataPack.VlocityDataPackType] == null) {
                                            jobInfo.alreadyExportedIdsByType[dataPack.VlocityDataPackType] = [];
                                        }

                                        if (!jobInfo.maxDepth || jobInfo.maxDepth == -1 || dataPack.VlocityDepthFromPrimary == 0) {

                                            if (dataPack.VlocityDataPackData != null 
                                                && dataPack.VlocityDataPackData.Id != null) {
                                                jobInfo.alreadyExportedIdsByType[dataPack.VlocityDataPackType].push(dataPack.VlocityDataPackData.Id);
                                            }

                                            var dataField = self.vlocity.datapacksutils.getDataField(dataPack);

                                            if (dataField && dataPack.VlocityDataPackData && dataPack.VlocityDataPackData[dataField]) {
                                                if (dataPack.VlocityDataPackData[dataField].length == 0) {
                                                    console.log('\x1b[31m', 'Error: ', '\x1b[0m','No records found for - ', dataPack.VlocityDataPackType + ' --- ' + dataPack.VlocityDataPackName);
                                                } else {
                                                    dataPack.VlocityDataPackData[dataField].forEach(function(dataEntry) {
                                                        
                                                        if (jobInfo.alreadyExportedIdsByType[dataPack.VlocityDataPackType].indexOf(dataEntry.Id) == -1) {

                                                            jobInfo.alreadyExportedIdsByType[dataPack.VlocityDataPackType].push(dataEntry.Id);
                                                        }
                                                    });
                                                }
                                            }

                                            jobInfo.alreadyExportedKeys.push(dataPack.VlocityDataPackKey);
                                        }
                                    } else if (jobInfo.exportPacksMaxSize && dataPack.VlocityDataPackStatus == 'Ready' && dataPack.VlocityDataPackRelationshipType != "Children") {

                                        if (jobInfo.extendedManifest[dataPack.VlocityDataPackType] == null) {
                                            jobInfo.extendedManifest[dataPack.VlocityDataPackType] = [];
                                        }

                                        jobInfo.extendedManifest[dataPack.VlocityDataPackType].push(JSON.parse(stringify(dataPack.VlocityDataPackData, { space: 4 })));
                                    } else if (dataPack.VlocityDataPackStatus == 'Error') {
                                        jobInfo.hasError = true;

                                        var errorMessage = dataPack.VlocityDataPackType + ' --- ' + dataPack.VlocityDataPackName + ' --- ' + dataPack.VlocityDataPackMessage;

                                        console.log('\x1b[31m', 'Error: ', '\x1b[0m', errorMessage);

                                        jobInfo.errors.push(errorMessage);          
                                    }
                                });
                            }
                            
                            if (jobInfo.expansionPath) {
                                self.vlocity.datapacksexpand.expand(jobInfo.projectPath + '/' + jobInfo.expansionPath, dataPackData, jobInfo, function() {

                                    if (jobInfo.exportBuildFile) {
                                        self.vlocity.datapacksexportbuildfile.addToExportBuildFile(jobInfo, dataPackData);
                                    }

                                    if (jobInfo.delete != false) {
                                        self.vlocity.datapacks.delete(result.VlocityDataPackId, self.getOptionsFromJobInfo(jobInfo), function() { callback(); }, function() { callback(); });
                                    } else {
                                        callback();
                                    }
                                });
                            } else {
                                if (jobInfo.exportBuildFile) {
                                    self.vlocity.datapacksexportbuildfile.addToExportBuildFile(jobInfo, dataPackData);
                                }

                                if (jobInfo.delete != false) {
                                    self.vlocity.datapacks.delete(result.VlocityDataPackId, self.getOptionsFromJobInfo(jobInfo), function() { callback(); }, function() { callback(); });
                                } else {
                                    callback();
                                }
                            }   
                        });
                    }
                });
            
        }
    }, function(err, result) {
        console.log('\x1b[32m', 'Export Series Finished');

        self.vlocity.datapacksutils.printJobStatus(jobInfo);

        if ((!jobInfo.hasError || jobInfo.continueAfterError) && Object.keys(jobInfo.extendedManifest).length > 0) {
            console.log('\x1b[32m', 'Chaining Job - Total Exports', '\x1b[0m', Object.keys(jobInfo.extendedManifest).length);
            jobInfo.manifest = jobInfo.extendedManifest;
            jobInfo.extendedManifest = {};
            jobInfo.toExportGroups = null;

            fs.outputFileSync(CURRENT_INFO_FILE, stringify(jobInfo, { space: 4 }), 'utf8');

            self.exportFromManifest(jobInfo, onComplete);
        } else {
            self.vlocity.datapacksexpand.refreshAllParentKeys(jobInfo);
            fs.outputFileSync(CURRENT_INFO_FILE, stringify(jobInfo, { space: 4 }), 'utf8');

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
        console.log('\x1b[31m', 'buildImport >>', '\x1b[0m', fullDataPath, jobInfo.manifest, jobInfo);
    }

    self.vlocity.datapacksbuilder.buildImport(fullDataPath, jobInfo.manifest, jobInfo, function(dataJson) { 

        if (dataJson && jobInfo.dataPackName) {
            dataJson.name = jobInfo.dataPackName;
        }

        if (dataJson) {

            var fileName = jobInfo.buildFile;

            fs.outputFileSync(jobInfo.projectPath + '/' + fileName, stringify(dataJson, { space: 4 }), 'utf8');

            if (fileName.indexOf('.resource') > 0) {
                // also create .resource-meta.xml
                fs.outputFileSync(jobInfo.projectPath + '/' + fileName + '-meta.xml', '<?xml version="1.0" encoding="UTF-8"?><StaticResource xmlns="http://soap.sforce.com/2006/04/metadata"><cacheControl>Public</cacheControl><contentType>text/json</contentType></StaticResource>',
                    'utf8');
            }
            
            console.log('\x1b[31m', 'Creating File >>', '\x1b[0m', jobInfo.projectPath + '/' + jobInfo.buildFile);

            onComplete(jobInfo);

        } else {
            onComplete(jobInfo);
        }
    });
    
}

DataPacksJob.prototype.expandFile = function(jobInfo, onComplete) {
    var self = this;

    if (jobInfo.vlocityKeysToNewNamesMap == null) {
        jobInfo.vlocityKeysToNewNamesMap = {};
    }

    if (jobInfo.vlocityRecordSourceKeyMap == null) {
        jobInfo.vlocityRecordSourceKeyMap = {};
    }

    self.vlocity.datapacksexpand.expandFile(jobInfo.projectPath + '/' + jobInfo.expansionPath, jobInfo.projectPath + '/' + jobInfo.buildFile, jobInfo);

    if (onComplete) {
        onComplete(jobInfo);
    }
}


DataPacksJob.prototype.runStepApex = function(projectPath, stepSettings, apexData, shouldDebug, onComplete) {
    var self = this;

    if (stepSettings) {
        var runApexByType = {};
        
        apexData.forEach(function(dataPack) {
            var apexClass;
            if (typeof stepSettings === 'string') {
                apexClass = stepSettings;
            } else {
                apexClass = stepSettings[dataPack.VlocityDataPackType];
            }

            if (apexClass) {
                if (!runApexByType[apexClass]) {
                    runApexByType[apexClass] = [];
                }

                runApexByType[apexClass].push(dataPack);
            }
        });

        async.eachSeries(Object.keys(runApexByType), function(apexClass, callback) {
            self.vlocity.datapacksutils.runApex(projectPath, apexClass, runApexByType[apexClass]).then(callback);
        }, function(err, result) {
            onComplete();
        });
    } else {
        onComplete();
    }
};

DataPacksJob.prototype.buildImportSeries = function(jobInfo, deploySeries, onComplete) {
    var self = this;

    var deployEntry;
    var maxSeries = 1;
    
    if (jobInfo.supportParallel) {
        maxSeries = jobInfo.defaultMaxParallel;
    }

    var deployManifest = jobInfo.manifest;
    if (jobInfo.queries) {
        deployManifest = null;
    }

    self.vlocity.datapacksbuilder.buildImport(jobInfo.projectPath, deployManifest, jobInfo, function(deployEntry) {

        if (deployEntry == null) {
            onComplete(deploySeries);
        } else {
            deploySeries.push(deployEntry);

            if (deploySeries.length < maxSeries) {
                self.buildImportSeries(jobInfo, deploySeries, onComplete);
            } else {
                onComplete(deploySeries);
            }
        }
    });
};

DataPacksJob.prototype.deployJob = function(jobInfo, onComplete) {
    var self = this;

    if (!jobInfo.VlocityDataPackIds) {
        jobInfo.VlocityDataPackIds = [];
    }

    if (jobInfo.errors == null) {
        jobInfo.errors = [];
    }

    if (jobInfo.startTime == null) {
        jobInfo.startTime = Date.now();
    }

    if (jobInfo.supportParallel == null) {
        jobInfo.supportParallel = jobInfo.defaultMaxParallel > 1;
    }

    fs.outputFileSync(CURRENT_INFO_FILE, stringify(jobInfo, { space: 4 }), 'utf8');

    // If there are both queries and manifest then assume the user wants to deploy all
    // Otherwise only deploy the manifest
    var initializing = false;

    if (!jobInfo.currentStatus) {
        jobInfo.currentStatus = {};
        initializing = true;
    } else {
        self.vlocity.datapacksutils.printJobStatus(jobInfo);
    }

    var deployEntry;

    var maxSeries = 1;

    if (jobInfo.supportParallel == null) {
        jobInfo.supportParallel = jobInfo.defaultMaxParallel > 1;
    }
    
    if (jobInfo.supportParallel) {
        maxSeries = jobInfo.defaultMaxParallel;
    }

    self.buildImportSeries(jobInfo, [], function(deploySeries) {
        if (deploySeries.length == 0) {

            var notDeployed = [];
            var headers = [];

            Object.keys(jobInfo.currentStatus).forEach(function(dataPackKey) {
                if (jobInfo.currentStatus[dataPackKey] == 'Ready') {
                    notDeployed.push('Not Deployed >> ' + dataPackKey);
                } else if (jobInfo.currentStatus[dataPackKey] == 'Header') {
                    notDeployed.push('Not Deployed >> ' + dataPackKey);
                    headers.push(dataPackKey);
                }
            });

            if (initializing || notDeployed.length > 0) {
                if (jobInfo.supportParallel) {
                    console.log('\x1b[31m', 'Support Parallel Off');
                    jobInfo.supportParallel = false;
                    self.deployJob(jobInfo, onComplete);
                } else if (jobInfo.headersOnly) {
                    if (headers.length > 0) {

                        console.log('\x1b[31m', 'Returning to DataPack Upload');

                        jobInfo.headersOnly = false;
                        jobInfo.headersOnlyDidNotHelp = true;

                        self.deployJob(jobInfo, onComplete);
                    } else {
                        jobInfo.hasError = true;

                        jobInfo.errorMessage = jobInfo.errorMessage + '\n' + notDeployed.join('\n');
                        
                        onComplete(jobInfo);
                    }
                } else if (jobInfo.supportHeadersOnly) {
                    if (jobInfo.headersOnlyDidNotHelp) {

                        jobInfo.hasError = true;

                        jobInfo.errorMessage = jobInfo.errorMessage + '\n' + notDeployed.join('\n');
                        
                        onComplete(jobInfo);
                    } else {
                        jobInfo.headersOnly = true;

                        console.log('\x1b[31m', 'Circular Reference found - Uploading Only Root Objects');
                        self.deployJob(jobInfo, onComplete);
                    }
                } else {
                    onComplete(jobInfo);
                }
            } else {
                onComplete(jobInfo);
            }
        } else {
            async.eachLimit(deploySeries, maxSeries, function(dataJson, callback) {
                var preStepDeployData = [];

                if (dataJson.dataPacks) {
                    dataJson.dataPacks.forEach(function(dataPack) {
                        var data = jobInfo.allDeployDataSummary[dataPack.VlocityDataPackKey];
                        data.VlocityDataPackType = dataPack.VlocityDataPackType;
                        preStepDeployData.push(data);
                    });
                }

                var apexSettings;
                if (jobInfo.preStepApex && jobInfo.preStepApex.Deploy) {
                    apexSettings = jobInfo.preStepApex.Deploy;
                }

                self.runStepApex(jobInfo.projectPath, apexSettings, preStepDeployData, jobInfo.shouldDebug, function() {

                    self.vlocity.datapacks.import(dataJson, self.getOptionsFromJobInfo(jobInfo), function(result) {

                        if (result.VlocityDataPackId) {
                        
                            var dataPackId = result.VlocityDataPackId;

                            var stepPostDeployResults = [];
                
                            self.vlocity.datapacks.getDataPackData(dataPackId, function(dataPackData) {

                                dataPackData.dataPacks.forEach(function(dataPack) {
                                    if (jobInfo.postDeployResults == null) {
                                        jobInfo.postDeployResults = [];
                                    }

                                    jobInfo.currentStatus[dataPack.VlocityDataPackKey] = dataPack.VlocityDataPackStatus;

                                    if (dataPack.VlocityDataPackStatus == 'Success') {

                                        // Stop an endless loop of headers
                                        if (jobInfo.headersOnly) {
                                            jobInfo.headersOnlyDidNotHelp = false;
                                        }

                                        console.log('\x1b[32m', 'Deploy Success >>', '\x1b[0m', dataPack.VlocityDataPackType + ' ' + dataPack.VlocityDataPackName + '  ' + (jobInfo.headersOnly ? 'Headers Only' : ''));

                                        if (jobInfo.headersOnly) {
                                            jobInfo.currentStatus[dataPack.VlocityDataPackKey] = "Header";
                                        } else {
                                            dataPack.VlocityDataPackRecords.forEach(function(record) {
                                                if (record.VlocityRecordStatus == "Success") {
                                                    jobInfo.postDeployResults.push({ "Id": record.VlocityRecordSalesforceId });
                                                    stepPostDeployResults.push({ "Id": record.VlocityRecordSalesforceId, VlocityDataPackType: dataPack.VlocityDataPackType });
                                                }
                                            });
                                        }
                                    } else if (dataPack.VlocityDataPackStatus == 'Error') {
                                        jobInfo.hasError = true;

                                        var errorMessage = dataPack.VlocityDataPackType + ' --- ' + dataPack.VlocityDataPackName + ' --- ' + dataPack.VlocityDataPackMessage;

                                        console.log('\x1b[31m', 'Deploy Error >>', '\x1b[0m', errorMessage);

                                        jobInfo.errors.push('Deploy Error >> ' +errorMessage);
                                    } else if (dataPack.VlocityDataPackStatus == 'Ignored') {
                                        self.vlocity.datapacks.getErrorsFromDataPack(dataPack, function(errors) {
                                            console.log('\x1b[31m', errors);
                                        });
                                    }
                                });

                                return new Promise(function(resolve, reject) {
                                    if (jobInfo.activate) {
                                        if (!jobInfo.activationStatus) {
                                            jobInfo.activationStatus = {};
                                        }

                                        self.vlocity.datapacks.activate(dataPackId, ['ALL'], self.getOptionsFromJobInfo(jobInfo), 
                                            function(activateResult) {
                                                jobInfo.activationStatus[dataPackId] = 'Success';
                                                resolve();
                                            }, function(error) {
                                                jobInfo.activationStatus[dataPackId] = 'Error';
                                                jobInfo.hasError = true;

                                                jobInfo.errors.push('Activation Error >> ' + error.Message)
                                                console.log('\x1b[31m', 'Activation Error >>', '\x1b[0m', error);
                                                resolve();
                                        });
                                    } else {
                                        resolve();
                                    }
                                }).then(function(result) {
                                    return new Promise(function(resolve, reject) {
                                        if (jobInfo.delete) {
                                            self.vlocity.datapacks.delete(dataPackId, self.getOptionsFromJobInfo(jobInfo), resolve, reject);
                                        } else {
                                            resolve();
                                        }
                                    });
                                }).then(function(result) {
                                    return new Promise(function(resolve, reject) {
                                        if (jobInfo.postStepApex && jobInfo.postStepApex.Deploy) {
                                            self.runStepApex(jobInfo.projectPath, jobInfo.postStepApex.Deploy, stepPostDeployResults, jobInfo.shouldDebug, resolve);
                                        } else {
                                            resolve();
                                        }
                                    });
                                }).then(function(result) {
                                    callback();
                                });
                            });
                        } else {
                            self.getJobErrors(result, jobInfo, onComplete);
                        }
                    });
                });
            }, function(err, result) {
                console.log('\x1b[31m', 'Chaining Deploy Job');

                self.vlocity.datapacksutils.printJobStatus(jobInfo);

                var stillRemaining = 0;

                Object.keys(jobInfo.currentStatus).forEach(function(dataPackKey) {
                    if (jobInfo.currentStatus[dataPackKey] == 'Ready' || jobInfo.currentStatus[dataPackKey] == 'Header') {
                        stillRemaining++;
                    }
                });

                if (stillRemaining == 0 || (jobInfo.hasError && !jobInfo.continueAfterError)) {
                    fs.outputFileSync(CURRENT_INFO_FILE, stringify(jobInfo, { space: 4 }), 'utf8');
                    onComplete(jobInfo);
                } else {
                    jobInfo.headersOnly = false;

                    if (jobInfo.supportParallelAgain) {
                        jobInfo.supportParallel = true;
                        jobInfo.supportParallelAgain = false;
                    }

                    self.deployJob(jobInfo, onComplete);
                }
            }); 
        }
    });
};



DataPacksJob.prototype.getJobErrors = function(err, jobInfo, onComplete) {
    var self = this;

    var processErrors = function(errors) {
        if (!jobInfo.errors) {
            jobInfo.errors = [];
        }

        if (self.vlocity.verbose) {
            console.error('\x1b[31m', 'datapacks.getDataPackData.errors >>', '\x1b[0m', errors);
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
        self.vlocity.datapacks.getErrors(err.VlocityDataPackId, processErrors);
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

DataPacksJob.prototype.checkDiffs = function(jobInfo, dataPackData, onComplete) {
    var self = this;
    dataPackData.dataPacks.forEach(function(dataPack) {

        var dataPackHash = self.vlocity.datapacksutils.getDataPackHash(dataPack);

        if (jobInfo.hashOfDataPacksExport && jobInfo.hashOfDataPacksExport[dataPack.VlocityDataPackKey] == dataPackHash) {
            jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Success';

            console.log('\x1b[32m', 'Will Not Deploy - No Changes >>', '\x1b[0m', dataPack.VlocityDataPackType + ' - ' + dataPack.VlocityDataPackName);            
        } else {
            jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Ready';
            console.log('\x1b[32m', 'Will Deploy >>', '\x1b[0m', dataPack.VlocityDataPackType + ' - ' + dataPack.VlocityDataPackName);
        }
    });
}

DataPacksJob.prototype.getExportDiffs = function(jobInfo, onComplete) {
    var self = this;

    jobInfo.cancelDeploy = true;
    self.getExportDiffsAndDeploy(jobInfo, onComplete);
}

DataPacksJob.prototype.getExportDiffsAndDeploy = function(jobInfo, onComplete) {
    var self = this;

    var savedProjectPath = jobInfo.projectPath;
    var savedBuildFile = jobInfo.buildFile;

    jobInfo.projectPath = 'vlocity-deploy-temp';
    
    jobInfo.hashOfDataPacksExport = {};

    self.exportJob(jobInfo, function(jobInfo) {

        jobInfo.buildFile = 'exportFileForDiffs.json';
        jobInfo.manifest = null;
        
        self.buildFile(jobInfo, function(jobInfo) {

            var currentFileData = JSON.parse(fs.readFileSync(jobInfo.projectPath + '/' + jobInfo.buildFile, 'utf8'));

            currentFileData.dataPacks.forEach(function(dataPack) {
                // Iterate over this and hash each individual 1 as JSON
                jobInfo.hashOfDataPacksExport[dataPack.VlocityDataPackKey] = self.vlocity.datapacksutils.getDataPackHash(dataPack);
            });

            jobInfo.projectPath = savedProjectPath;
            jobInfo.buildFile = 'localFileForDiffs.json';
            
            fs.outputFileSync(CURRENT_INFO_FILE, stringify(jobInfo, { space: 4 }), 'utf8');

            jobInfo.currentStatus = {};
            jobInfo.manifest = null;
            jobInfo.resetFileData = true;
            jobInfo.VlocityDataPackIds = [];

            jobInfo.gettingDiffs = false;

            self.buildFile(jobInfo, function(jobInfo) {

                var checkDiffsFile = JSON.parse(fs.readFileSync(jobInfo.projectPath + '/' + jobInfo.buildFile, 'utf8'));

                self.checkDiffs(jobInfo, checkDiffsFile);

                if (jobInfo.cancelDeploy) {
                    onComplete(jobInfo);
                } else {
                    self.runJobWithInfo(jobInfo, 'Deploy', onComplete, onComplete, false);
                }
            });
        });
    });
}



