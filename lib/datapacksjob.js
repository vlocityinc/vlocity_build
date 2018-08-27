var fs = require('fs-extra');
var async = require('async');
var stringify = require('json-stable-stringify');
var path = require('path');
var yaml = require('js-yaml');

var DataPacksJob = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};

    RUN_JS_TEMP = path.join(this.vlocity.tempFolder, 'runJavaScriptTemp.json');
    this.defaultJobSettings = yaml.safeLoad(fs.readFileSync(path.join(__dirname, 'defaultjobsettings.yaml'), 'utf8'));
    this.queryDefinitions = yaml.safeLoad(fs.readFileSync(path.join(__dirname, 'querydefinition.yaml'), 'utf8'));
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
var RUN_JS_TEMP;

DataPacksJob.prototype.getOptionsFromJobInfo = function(jobInfo) {
    var options = {};

    Object.keys(SUPPORTED_JOB_KEY_TO_OPTION_MAP).forEach(function(jobKey) {

        if (jobInfo[jobKey] != null) {
            options[SUPPORTED_JOB_KEY_TO_OPTION_MAP[jobKey]] = jobInfo[jobKey];
        }
    });

    return options;
};

DataPacksJob.prototype.runJob = function(action, jobData, onSuccess, onError) {
    var self = this;
   
    self.vlocity.checkLogin(function() {
        var jobInfo = jobData;

        try {
            jobInfo.jobAction = action;
        
            self.mergeInJobDefaults(jobInfo);
        
            if (!jobInfo.queries && !jobInfo.manifest) {
                jobInfo.queryAll = true;
            }
        
            if (jobInfo.queryAll) {
                jobInfo.queries = Object.keys(self.queryDefinitions);
                jobInfo.ignoreQueryErrors = true;
            }  
            
            if (jobInfo.queries) {
                for (var i = 0; i < jobInfo.queries.length; i++) {
                    if (typeof jobInfo.queries[i] === 'string') {
                        jobInfo.queries[i] = self.queryDefinitions[jobInfo.queries[i]];
                    }
                }
            }
        
            if (jobInfo.OverrideSettings) {
                self.vlocity.datapacksutils.overrideExpandedDefinition(jobInfo.OverrideSettings);
            }
        
            return self.runJobWithInfo(jobInfo, action, onSuccess, onError);
        } catch (e) {
            VlocityUtils.error('Initialization Error', e);
            return onError(self.formatResponse(jobInfo, e));
        }

    }, onError);
};

DataPacksJob.prototype.mergeInJobDefaults = function(jobInfo) {
    var self = this;

    Object.keys(self.defaultJobSettings).forEach(function(settingsKey) {
        if (jobInfo[settingsKey] === undefined) {
            jobInfo[settingsKey] = self.defaultJobSettings[settingsKey];
        }
    });

    if (jobInfo.strict) {
        jobInfo.continueAfterError = false;
        jobInfo.supportHeadersOnly = false;
        jobInfo.supportForceDeploy = false;
        jobInfo.ignoreAllErrors = false;
    }
};    

DataPacksJob.prototype.intializeJobInfo = function(jobInfo, action) {
    var self = this;

    // Will not continue a single DataPack, but will continue when there are breaks in the job
    if (action == 'Continue' || action == 'Retry') {
        self.vlocity.datapacksutils.loadCurrentJobInfo(jobInfo);

        jobInfo.hasError = false;
        jobInfo.headersOnlyDidNotHelp = false;
        jobInfo.startTime = Date.now();
        jobInfo.headersOnly = false;
        
        if (jobInfo.jobAction == 'Export' 
            || jobInfo.jobAction == 'GetDiffs' 
            || jobInfo.jobAction == 'GetDiffsAndDeploy') {
            self.vlocity.datapacksexportbuildfile.loadExportBuildFile(jobInfo);
            
            if (action == 'Continue') {
                if (jobInfo.queries) {
                    jobInfo.skipQueries = true;
                }
            } else if (action == 'Retry') {
                VlocityUtils.success('Back to Ready');

                Object.keys(jobInfo.currentStatus).forEach(function(dataPackKey) {
                    if (jobInfo.currentStatus[dataPackKey] == 'Error') {
                        jobInfo.currentStatus[dataPackKey] = 'Ready';
                    }
                });
            }
        }

        if (jobInfo.jobAction == 'Deploy') {
            jobInfo.forceDeploy = false;
            jobInfo.preDeployDataSummary = [];

            Object.keys(jobInfo.currentStatus).forEach(function(dataPackKey) {
                if (action == 'Retry') {
                    if (jobInfo.resetOnRetry) {
                        jobInfo.resetOnRetry.forEach(function(typeToReset) {
                            if (dataPackKey.indexOf(typeToReset) == 0) {
                                jobInfo.currentStatus[dataPackKey] = 'ReadySeparate';
                            }
                        });
                    }

                    if (jobInfo.currentStatus[dataPackKey] != 'Success' 
                    && jobInfo.currentStatus[dataPackKey] != 'Ready') {
                        jobInfo.currentStatus[dataPackKey] = 'ReadySeparate';
                    }
                } else {
                    if (jobInfo.currentStatus[dataPackKey] == 'Header' 
                    || jobInfo.currentStatus[dataPackKey] == 'Added') {
                        jobInfo.currentStatus[dataPackKey] = 'Ready';
                    }
                }
            });
        }

        if (action == 'Retry') {
            jobInfo.errors = [];
            VlocityUtils.success('Back to Ready');
        }

        // Allow Changing a Current jobInfo property by specifying it in a Retry - Is a Permanent change to the jobInfo
        if (self.vlocity.commandLineOptionsOverride) {
            Object.keys(self.vlocity.commandLineOptionsOverride).forEach(function(argument) {
                jobInfo[argument] = self.vlocity.commandLineOptionsOverride[argument];
            });    
        }
        
        action = jobInfo.jobAction;
    }

    jobInfo.jobAction = action;
    jobInfo.startTime = jobInfo.startTime || Date.now();
    jobInfo.originalAction = jobInfo.originalAction || action;
    
    jobInfo.logName = jobInfo.logName || self.vlocity.datapacksexpand.generateFolderOrFilename(jobInfo.jobName + '-' + new Date(Date.now()).toISOString() + '-' + jobInfo.jobAction, 'yaml');

    jobInfo.alreadyExportedKeys = jobInfo.alreadyExportedKeys || [];
    jobInfo.allParents = jobInfo.allParents || [];
    jobInfo.errors = jobInfo.errors || [];
    jobInfo.report = jobInfo.report || [];
    jobInfo.postDeployResults = jobInfo.postDeployResults || [];
    jobInfo.preDeployDataSummary = jobInfo.preDeployDataSummary || [];
    jobInfo.refreshVlocityBase = jobInfo.refreshVlocityBase || [];

    jobInfo.currentStatus = jobInfo.currentStatus || {};
    jobInfo.currentErrors = jobInfo.currentErrors || {};
    jobInfo.sourceKeysByParent = jobInfo.sourceKeysByParent || {};
    jobInfo.alreadyExportedIdsByType = jobInfo.alreadyExportedIdsByType || {};
    jobInfo.alreadyErroredIdsByType = jobInfo.alreadyErroredIdsByType || {};
    jobInfo.alreadyRetriedIdsByType = jobInfo.alreadyRetriedIdsByType || {};

    jobInfo.vlocityKeysToNewNamesMap = jobInfo.vlocityKeysToNewNamesMap || {};
    jobInfo.vlocityRecordSourceKeyMap = jobInfo.vlocityRecordSourceKeyMap || {};
    jobInfo.VlocityDataPackIds = jobInfo.VlocityDataPackIds || {};
    jobInfo.generatedKeysToNames = jobInfo.generatedKeysToNames || {};
    jobInfo.sourceKeyToRecordId = jobInfo.sourceKeyToRecordId || {};
    jobInfo.dataPackKeyToPrimarySourceKey = jobInfo.dataPackKeyToPrimarySourceKey || {};
    jobInfo.diffStatus = jobInfo.diffStatus || {};
    jobInfo.fullManifest = jobInfo.fullManifest || {};
    jobInfo.manifestFound = jobInfo.manifestFound || {};
    
    jobInfo.dataPackDisplayLabels = jobInfo.dataPackDisplayLabels || {};
    jobInfo.allDataSummary = jobInfo.allDataSummary || {};
    jobInfo.pendingFromManifest = jobInfo.pendingFromManifest || {};
    jobInfo.keysToDirectories = jobInfo.keysToDirectories || {};

    // Means that Continue or Retry will not work
    if (jobInfo.jobAction == 'Continue' || jobInfo.jobAction == 'Retry') {
        throw jobInfo.jobAction + ' initialization failed. Please use another Command';
    }

    if (jobInfo.manifest) {
        self.formatManifest(jobInfo);
    }
    
    if (!jobInfo.addedToExportBuildFile) {
        jobInfo.addedToExportBuildFile = [];
        self.vlocity.datapacksexportbuildfile.resetExportBuildFile(jobInfo);
    }

    jobInfo.supportParallel = jobInfo.defaultMaxParallel > 1;
};

DataPacksJob.prototype.runJobWithInfo = function(jobInfo, action, onSuccess, onError) {
    var self = this;

    onError = onError || onSuccess;

    self.intializeJobInfo(jobInfo, action);
    action = jobInfo.jobAction;

    var toolingApi = self.vlocity.jsForceConnection.tooling;

    return new Promise(function(resolve, reject) {
        self.vlocity.checkLogin(resolve, onError);
    })
    .then(function() {
      
        return new Promise(function(resolve, reject) {
            if (!jobInfo.ranPreJobJavaScript && jobInfo.preJobJavaScript && jobInfo.preJobJavaScript[action]) {

                VlocityUtils.report('Running Pre Job JavaScript', jobInfo.preJobJavaScript[action]);
                
                jobInfo.ranPreJobJavaScript = true;

                self.vlocity.datapacksutils.runJavaScript(jobInfo.projectPath, jobInfo.preJobJavaScript[action], null, jobInfo, resolve);
            } else {
                resolve();
            }
        });
    })
    .then(function() {
        if (!jobInfo.ranPreJobApex && jobInfo.preJobApex && jobInfo.preJobApex[action]) {

            // Builds the JSON Array sent to Anon Apex that gets run before deploy
            // Issues when > 32000 chars. Need to add chunking for this. 
            if (action == 'Deploy') {
                self.vlocity.datapacksbuilder.initializeImportStatus(jobInfo.projectPath + '/' + jobInfo.expansionPath, jobInfo);
            }

            VlocityUtils.report('Running Pre Job Apex', jobInfo.preJobApex[action]);
            
            jobInfo.ranPreJobApex = true;

            return self.vlocity.datapacksutils.runApex(jobInfo.projectPath, jobInfo.preJobApex[action], jobInfo.preDeployDataSummary)
            .then(function() {
                return Promise.resolve();
            }).catch(function (e) {
                throw e;
            });
        } else {
            return Promise.resolve();
        }
    })
    .then(function() {
        return new Promise(function(resolve, reject) {
            try {
                self.doRunJob(jobInfo, action, resolve);
            } catch (e) {
                VlocityUtils.error(e.stack);

                jobInfo.hasError = true;
                jobInfo.errorMessage = e.message;
                reject(e);
            }
        });
    })
    .then(function() {
        
        if ((!jobInfo.hasError || jobInfo.continueAfterError) && jobInfo.postJobApex && jobInfo.postJobApex[action]) {

            VlocityUtils.report('Running Post Job Apex', jobInfo.postJobApex[action]);
            return self.vlocity.datapacksutils.runApex(jobInfo.projectPath, jobInfo.postJobApex[action], jobInfo.postDeployResults)
            .then(function() {
                return Promise.resolve();
            });
        } else {
            return Promise.resolve();
        }
    })
    .then(function() {
        
        if ((!jobInfo.hasError || jobInfo.continueAfterError) && jobInfo.postJobJavaScript && jobInfo.postJobJavaScript[action]) {

            VlocityUtils.report('Running Post Job JavaScript', jobInfo.postJobJavaScript[action]);
            
            self.vlocity.datapacksutils.runJavaScript(jobInfo.projectPath, jobInfo.postJobJavaScript[action], null, jobInfo,
                function() {
                    Promise.resolve();
            });
        } else {
            return Promise.resolve();
        }
    })
    .then(function() {

        self.vlocity.datapacksutils.printJobStatus(jobInfo);

        if (!jobInfo.hasError) {
            return onSuccess(self.formatResponse(jobInfo));
        } else {
            return onError(self.formatResponse(jobInfo));
        }
    }).catch(function(err) {
        VlocityUtils.error('Uncaught Job Error', err);
        onError(self.formatResponse(jobInfo, err));
    });
};

DataPacksJob.prototype.doRunJob = function(jobInfo, action, onComplete) {
    var self = this;
    VlocityUtils.verbose('Running Job', action);
    
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
        self.getDiffs(jobInfo, onComplete);
    } else if (action == 'GetDiffsAndDeploy') {
        self.getDiffsAndDeploy(jobInfo, onComplete);
    } else if (action == 'GetAllAvailableExports') {
        self.getAllAvailableExports(jobInfo, onComplete);
    } else if (action == 'RefreshProject') {
        self.refreshProject(jobInfo, onComplete);
    } else if (action == 'JavaScript') {
        self.reExpandAllFilesAndRunJavaScript(jobInfo, onComplete);
    } else if (action == 'Apex') {
        self.runApex(jobInfo, onComplete);
    } else if (action == 'RefreshVlocityBase') {
        self.refreshVlocityBase(jobInfo, onComplete);
    } else if (action == 'UpdateSettings') {
        self.updateSettings(jobInfo, onComplete);
    } else if (action == 'CleanOrgData') {
        self.cleanOrgData(jobInfo, onComplete);
    } else if (action == 'ValidateLocalData') {
        self.validateLocalData(jobInfo, onComplete);
    } else {
        jobInfo.hasError = true;
        jobInfo.errors.push('Command not found: ' + action);
        VlocityUtils.error('Command not found: ' + action);
        onComplete(onComplete);
    }
};

DataPacksJob.prototype.formatResponse = function(jobInfo, error) {
    var self = this;

    try {

        VlocityUtils.verbose('Formatting Response');

        if (error) {

            if (!jobInfo.errors) {
                jobInfo.errors = [];
            }
            jobInfo.hasError = true;
            jobInfo.errors.push(error.stack || error.message);
        }

        var response = {};

        response.action = jobInfo.originalAction || jobInfo.jobAction;

        var dataPacksMap = {};

        var allManifestByKey = {};
        Object.keys(jobInfo.fullManifest || {}).forEach(function(dataPackType) {
            Object.keys(jobInfo.fullManifest[dataPackType]).forEach(function(dataPackKey) {
                allManifestByKey[dataPackKey] = JSON.parse(stringify(jobInfo.fullManifest[dataPackType][dataPackKey]));

                allManifestByKey[dataPackKey].VlocityDataPackKey = dataPackType + '/' + self.vlocity.datapacksexpand.getDataPackFolder(dataPackType, allManifestByKey[dataPackKey].VlocityRecordSObjectType, allManifestByKey[dataPackKey]);  
                if (allManifestByKey[dataPackKey].VlocityDataPackKeyForManifest) {
                    delete allManifestByKey[dataPackKey].VlocityDataPackKeyForManifest;
                }
            });
        });

        if (jobInfo.jobAction == 'GetAllAvailableExports') {
            Object.values(allManifestByKey).forEach(function(item) {
                VlocityUtils.log(item.VlocityDataPackKey);
            });

            response.records = Object.values(allManifestByKey);
            response.status = 'success';
            response.message = response.records.length + ' Found';
        } else if (jobInfo.jobAction == 'RefreshVlocityBase') {
            response.records = jobInfo.refreshVlocityBase;
            response.status = jobInfo.hasError ? 'error' : 'success';
            response.message = jobInfo.refreshVlocityBase.length + ' Refreshed';
        } else if (jobInfo.jobAction == 'UpdateSettings') {
                response.records = [];
                response.status = jobInfo.hasError ? 'error' : 'success';
                response.message = 'Complete';
        } else {

            Object.keys(jobInfo.currentStatus || {}).forEach(function(key) {
                
                var dataPack = { VlocityDataPackKey: key };

                var newKey = jobInfo.vlocityKeysToNewNamesMap[key] || key;

                if (dataPacksMap[newKey]) {
                    dataPack = dataPacksMap[newKey];
                } else if (jobInfo.allDataSummary[key]) {
                    Object.assign(dataPack, jobInfo.allDataSummary[key]);
                }

                if (!dataPack.VlocityDataPackStatus || dataPack.VlocityDataPackStatus  == 'Ignored') {
                    dataPack.VlocityDataPackStatus = jobInfo.currentStatus[dataPack.VlocityDataPackKey];
                }
                
                if (!dataPack.Diffs && jobInfo.diffStatus[dataPack.VlocityDataPackKey]) {
                    dataPack.Diffs = jobInfo.diffStatus[dataPack.VlocityDataPackKey];
                }

                if (!dataPack.Id && dataPack.VlocityRecordSourceKey && jobInfo.sourceKeyToRecordId[dataPack.VlocityRecordSourceKey]) {
                    dataPack.Id = jobInfo.sourceKeyToRecordId[dataPack.VlocityRecordSourceKey];
                }

                if (!dataPack.VlocityDataPackDisplayLabel &&  jobInfo.dataPackDisplayLabels[key]) {
                    dataPack.VlocityDataPackDisplayLabel = jobInfo.dataPackDisplayLabels[key];
                }

                if (dataPack.VlocityDataPackStatus == 'Error') {
                    if (jobInfo.currentErrors[dataPack.VlocityDataPackKey]) {
                        dataPack.ErrorMessage = jobInfo.currentErrors[dataPack.VlocityDataPackKey];
                    } else if (jobInfo.currentErrors[newKey]) {
                        dataPack.ErrorMessage = jobInfo.currentErrors[newKey];
                    }
                }

                dataPack.VlocityDataPackKey = newKey;

                dataPacksMap[dataPack.VlocityDataPackKey] = dataPack;
            });

            response.records = Object.values(dataPacksMap);
        
            if (jobInfo.data) {
                response.data = jobInfo.data;
            }

            if (jobInfo.hasError) {
                response.status = 'error'; 
                response.message = jobInfo.errors.join('\n').replace(/%vlocity_namespace%/g, self.vlocity.namespace);
            } else {
                response.status = 'success'; 

                if (jobInfo.report.length > 0) {
                    response.message = jobInfo.report.join('\n').replace(/%vlocity_namespace%/g, self.vlocity.namespace);
                } else if (response.records) {
                    response.message = response.records.length + ' Completed';
                } else {
                    response.message = 'Complete';
                }
            }
        }

        jobInfo.records = response.records;

        self.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo);

        return response;
    } catch (e) {
        return e;
    }    
};

DataPacksJob.prototype.formatManifest = function(jobInfo) {
    var self = this;

    VlocityUtils.verbose('Formatting Manifest');

    if (Array.isArray(jobInfo.manifest)) {
        jobInfo.specificManifestKeys = [];

        // Assumes these are a List of VlocityDataPackKeys or Ids
        if (typeof jobInfo.manifest[0] === 'string') {
            jobInfo.specificManifestKeys = jobInfo.manifest;
        } else {
            jobInfo.manifest.forEach(function(item) {
                if (filterQueries.Id) {
                    jobInfo.specificManifestKeys.push(filterQueries.Id);
                } else if (filterQueries.VlocityDataPackKey) {
                    jobInfo.specificManifestKeys.push(filterQueries.VlocityDataPackKey);
                }
            });
        }

        if (!jobInfo.queries) {
            jobInfo.queries = [];
        }

        jobInfo.queries = jobInfo.queries.concat(Object.values(self.queryDefinitions));
    } else {

        jobInfo.specificManifestObjects = {};

        Object.keys(jobInfo.manifest).forEach(function(dataPackType) {
            
            jobInfo.manifest[dataPackType].forEach(function(data) {

                if (!jobInfo.specificManifestObjects[dataPackType]) {
                    jobInfo.specificManifestObjects[dataPackType] = [];
                }

                jobInfo.specificManifestObjects[dataPackType].push(data);
            });
        });

        jobInfo.queries = null;
    }
};

DataPacksJob.prototype.buildManifestFromQueries = function(jobInfo, onComplete) {
    var self = this;

    if (!jobInfo.fullManifest) {
        jobInfo.fullManifest = {};
    }

    if (!jobInfo.manifest && !jobInfo.queries) {
        VlocityUtils.error('Error', 'No Export Data Specified');
        return onComplete(jobInfo);
    }

    if (jobInfo.queries) {
        jobInfo.specificManifestObjects = null;

        if (jobInfo.skipQueries) {
            return onComplete(jobInfo);
        }
        
        var totalFound = 0;

        VlocityUtils.silence = !!jobInfo.specificManifestKeys;

        async.eachSeries(jobInfo.queries, function(queryData, callback) {
            if (!queryData || !queryData.VlocityDataPackType || !queryData.query) {
                return callback();
            }

            if (!jobInfo.fullManifest[queryData.VlocityDataPackType]) {
                jobInfo.fullManifest[queryData.VlocityDataPackType] = {};
            }

            var query = queryData.query.replace(/%vlocity_namespace%/g, self.vlocity.namespace);

            VlocityUtils.report('VlocityDataPackType', queryData.VlocityDataPackType);
            VlocityUtils.report('Query', query);

            var thisQuery = self.vlocity.jsForceConnection.query(query)
                .on("record", function(record) {

                    record = JSON.parse(stringify(record).replace(new RegExp(self.vlocity.namespace, 'g'), '%vlocity_namespace%'));

                    record.VlocityDataPackType = queryData.VlocityDataPackType;
                    record.VlocityRecordSObjectType = record.attributes.type;

                    record.VlocityDataPackKeyForManifest = queryData.VlocityDataPackType + '/' + self.vlocity.datapacksexpand.getDataPackFolder(queryData.VlocityDataPackType, record.VlocityRecordSObjectType, record);

                    delete record.attributes;
                    if (!jobInfo.fullManifest[queryData.VlocityDataPackType][record.Id]) {
                        if (jobInfo.specificManifestKeys && jobInfo.specificManifestKeys.indexOf(queryData.VlocityDataPackType) == -1 && jobInfo.specificManifestKeys.indexOf(record.VlocityDataPackKeyForManifest) == -1 && jobInfo.specificManifestKeys.indexOf(record.Id) == -1) {
                            return;
                        }

                        jobInfo.fullManifest[queryData.VlocityDataPackType][record.Id] = record;
                        totalFound++;

                        record.VlocityDataPackDisplayLabel = self.vlocity.datapacksutils.getDisplayName(record);

                        VlocityUtils.verbose('Found From Manifest', record.VlocityDataPackType, record.VlocityDataPackDisplayLabel);
                    }
                })
                .on("end", function() {
                    VlocityUtils.report('Records', thisQuery.totalFetched);

                    callback();
                })
                .on("error", function(err) {

                    VlocityUtils.error('Query Error', queryData.VlocityDataPackType);
                    callback();
                })
                .run({ autoFetch : true, maxFetch : 10000 });

        }, function(err, result) {

            VlocityUtils.success('Query Total', totalFound);

            VlocityUtils.silence = false;
            
            onComplete(jobInfo);
        });
    } else {
        onComplete(jobInfo);
    }
};

DataPacksJob.prototype.exportJob = function(jobInfo, onComplete) {
    var self = this;

    self.vlocity.checkLogin(function(){
        self.buildManifestFromQueries(jobInfo, function(jobStatus) {
            self.exportFromManifest(jobStatus, onComplete);
        });
    });
};

DataPacksJob.prototype.getAllAvailableExports = function(jobInfo, onComplete) {
    var self = this;

    self.vlocity.checkLogin(function(){
        self.buildManifestFromQueries(jobInfo, function(jobStatus) {
            onComplete(jobInfo);
        });
    });
};

DataPacksJob.prototype.setToUnknownExportError = function(jobInfo, pack) {
    var self = this;

    var packKey = pack.VlocityDataPackType + '/' + self.vlocity.datapacksexpand.getDataPackFolder(pack.VlocityDataPackType, pack.VlocityRecordSObjectType, pack);

    if (jobInfo.alreadyRetriedIdsByType[pack.VlocityDataPackType] == null) {
        jobInfo.alreadyRetriedIdsByType[pack.VlocityDataPackType] = [];
    } 

    if (jobInfo.alreadyRetriedIdsByType[pack.VlocityDataPackType].indexOf(pack.Id) == -1 ) { 
        jobInfo.alreadyRetriedIdsByType[pack.VlocityDataPackType].push(pack.Id);

        jobInfo.currentStatus[packKey] = 'Ready';
    } else {
        if (jobInfo.alreadyErroredIdsByType[pack.VlocityDataPackType] == null) {
            jobInfo.alreadyErroredIdsByType[pack.VlocityDataPackType] = [];
        }

        if (jobInfo.alreadyErroredIdsByType[pack.VlocityDataPackType].indexOf(pack.Id) == -1 ) { 
            jobInfo.alreadyErroredIdsByType[pack.VlocityDataPackType].push(pack.Id);
        }

        jobInfo.currentStatus[packKey] = 'Error';

        jobInfo.hasError = true;
        jobInfo.errors.push('Unknown Error >> ' + packKey + ' (' + pack.Id + ') --- Data Not Retrieved');
    }
};


DataPacksJob.prototype.exportFromManifest = function(jobInfo, onComplete) {
    var self = this;

    if (!jobInfo.initialized) {
        VlocityUtils.report('Initializing Project');
        self.vlocity.datapacksutils.initializeFromProject(jobInfo);
        jobInfo.initialized = true;
        self.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo);
    }

    jobInfo.toExportGroups = [[]];

    var seriesGroupMax = 1;
    if (jobInfo.defaultMaxParallel) {
        seriesGroupMax = jobInfo.defaultMaxParallel;
    }

    if (jobInfo.specificManifestObjects) {
        
        Object.keys(jobInfo.specificManifestObjects).forEach(function(dataPackType) {
            jobInfo.specificManifestObjects[dataPackType].forEach(function(key) {
                jobInfo.toExportGroups[0].push({ Id: key, VlocityDataPackType: dataPackType });
            });
        });

        if (jobInfo.manifestOnly) {
            jobInfo.maxDepth = 0;
        }

        jobInfo.specificManifestObjects = null;
    } else {
        var alreadyInGroup = [];
        var hasAny = false;
        var hasSObject = false;
        
        Object.keys(jobInfo.fullManifest).forEach(function(dataPackType) {

            var hasChildren = false; 

            if (jobInfo.toExportGroups[jobInfo.toExportGroups.length - 1].length > 0) {
                jobInfo.toExportGroups.push([]);
            }

            if (!jobInfo.alreadyExportedIdsByType[dataPackType]) {
                jobInfo.alreadyExportedIdsByType[dataPackType] = [];
            }

            if (!jobInfo.alreadyErroredIdsByType[dataPackType]) {
                jobInfo.alreadyErroredIdsByType[dataPackType] = [];
            }

            var maxForType = self.vlocity.datapacksutils.getExportGroupSizeForType(dataPackType);

            if (!maxForType) {
                maxForType = MAX_PER_GROUP;
            }

            Object.keys(jobInfo.fullManifest[dataPackType]).forEach(function(fullManifestId) {

                var exData = jobInfo.fullManifest[dataPackType][fullManifestId];

                // Skip if already exported by Key or by Id
                if (!((exData.Id 
                        && (jobInfo.alreadyExportedIdsByType[dataPackType].indexOf(exData.Id) != -1 
                        ||  jobInfo.alreadyErroredIdsByType[dataPackType].indexOf(exData.Id) != -1))
                    || (exData.VlocityDataPackKey 
                        && jobInfo.alreadyExportedKeys.indexOf(exData.VlocityDataPackKey) != -1))
                    && (exData.VlocityDataPackKey == null 
                        || (jobInfo.currentStatus[exData.VlocityDataPackKey] != 'Error'
                    && jobInfo.currentStatus[exData.VlocityDataPackKey] != 'Ignored'))
                    && alreadyInGroup.indexOf(exData.VlocityDataPackKey) == -1
                    && alreadyInGroup.indexOf(exData.Id) == -1) {

                    if (hasAny) {
                        if (hasSObject && dataPackType != 'SObject') {
                            return;
                        } else if (!hasSObject && dataPackType == 'SObject') {
                            return;
                        } else if (hasChildren && exData.VlocityDataPackRelationshipType != 'Children') {
                            jobInfo.toExportGroups.push([]);
                            hasChildren = false;
                        } else if (!hasChildren && exData.VlocityDataPackRelationshipType == 'Children') {
                            if (jobInfo.toExportGroups[jobInfo.toExportGroups.length - 1].length > 0) {
                                jobInfo.toExportGroups.push([]);
                            }
                        }
                    }

                    if (dataPackType == 'SObject' && hasAny && !hasSObject) {
                        return;
                    } 

                    if (jobInfo.toExportGroups[jobInfo.toExportGroups.length - 1].length >= maxForType) {
                        jobInfo.toExportGroups.push([]);
                        hasChildren = false;
                    }

                    hasAny = true;

                    if (dataPackType == 'SObject') {
                        hasSObject = true;
                    }

                    if (exData.VlocityDataPackRelationshipType == 'Children') {
                        hasChildren = true;
                        maxForType = self.vlocity.datapacksutils.getChildrenLimitForType(dataPackType);;
                    }

                    if (exData.Id) {
                        alreadyInGroup.push(exData.Id);
                    }

                    if (exData.VlocityDataPackKey) {
                        alreadyInGroup.push(exData.VlocityDataPackKey);
                    }
                 
                    delete exData.VlocityDataPackKeyForManifest;

                    jobInfo.toExportGroups[jobInfo.toExportGroups.length - 1].push(exData);                    
                }
            });
        });
    }

    var q = async.queue(function(exportDataFromManifest, callback) {
        exportDataFromManifest = exportDataFromManifest.group;
    
        var exportData = exportDataFromManifest.filter(function(dataPack) {
            if (!jobInfo.alreadyExportedIdsByType[dataPack.VlocityDataPackType]) {
                jobInfo.alreadyExportedIdsByType[dataPack.VlocityDataPackType] = [];
            }

            if (!jobInfo.alreadyErroredIdsByType[dataPack.VlocityDataPackType]) {
                jobInfo.alreadyErroredIdsByType[dataPack.VlocityDataPackType] = [];
            }

            if ((dataPack.Id 
                && dataPack.VlocityDataPackRelationshipType != "Children"
                && (jobInfo.alreadyExportedIdsByType[dataPack.VlocityDataPackType].indexOf(dataPack.Id) != -1 
                || jobInfo.alreadyErroredIdsByType[dataPack.VlocityDataPackType].indexOf(dataPack.Id) != -1))
                || (dataPack.VlocityDataPackKey && jobInfo.alreadyExportedKeys.indexOf(dataPack.VlocityDataPackKey) != -1)) {

                if (jobInfo.currentStatus[dataPack.VlocityDataPackKey] == "Ready") {
                    jobInfo.currentStatus[dataPack.VlocityDataPackKey] = "Ignored";
                }

                return false;
            }

            VlocityUtils.success('Exporting', dataPack.VlocityDataPackType, self.vlocity.datapacksutils.getDisplayName(dataPack));

            return true;
        });

        if (exportData.length == 0) {
            callback();
        } else {

            var originalKeys = JSON.parse(JSON.stringify(exportData));

            var jobOptions = self.getOptionsFromJobInfo(jobInfo);

            if (jobOptions.exportPacksMaxSize != -1) {
                jobOptions.exportPacksMaxSize = exportData.length;
            }     

            self.vlocity.datapacks.export(exportData[0].VlocityDataPackType, exportData, jobOptions,
                function(result) {

                    self.vlocity.datapacksexportbuildfile.saveFile();

                    VlocityUtils.verbose('Export Finished', result.VlocityDataPackId, result.Status);

                    jobInfo.VlocityDataPackIds[result.VlocityDataPackId] = result.Status;

                    if (!result.VlocityDataPackId) {
                        if (result.storageError) {
                            jobInfo.hasError = true;
                            if (jobInfo.errors.indexOf(result.message) == -1) {
                                VlocityUtils.error('DataPack API Error', result);
                                jobInfo.errors.push(result.message);
                            }
                            return onComplete(jobInfo);
                        } else {

                            if (result instanceof Error) {
                                VlocityUtils.error('DataPack API Error', result.stack);
                                jobInfo.errors.push(result.stack);
                            } else {
                                VlocityUtils.error('DataPack API Error', result);
                            }
                             
                            jobInfo.hasError = true;
                        }

                        originalKeys.forEach(function(pack) {
                            if (pack.Id && !pack.VlocityDataPackKey) {
                                self.setToUnknownExportError(jobInfo, pack);
                            } else if (pack.VlocityDataPackRelationshipType == "Children") {
                                jobInfo.currentStatus[pack.VlocityDataPackKey + '/Children'] = 'Error';
                            }
                        });

                        return callback();
                    }

                    self.vlocity.datapacks.getDataPackData(result.VlocityDataPackId, function(dataPackData) {
                        
                        var processedKeys = {};
                        (dataPackData.dataPacks || []).forEach(function(dataPack) {

                            if (dataPack.VlocityDataPackKey) {
                                processedKeys[dataPack.VlocityDataPackKey] = true;
                            }

                            if (dataPack.VlocityDataPackData && dataPack.VlocityDataPackData.Id) {
                                processedKeys[dataPack.VlocityDataPackData.Id] = true;
                            }

                            if (dataPack.VlocityDataPackStatus == 'Not Included' || dataPack.VlocityDataPackStatus == 'Ignored') {

                                if (jobInfo.maxDepth == -1 
                                    && dataPack.VlocityDataPackRelationshipType == 'Children' 
                                    && jobInfo.currentStatus[dataPack.VlocityDataPackKey] != 'Success' 
                                    && jobInfo.currentStatus[dataPack.VlocityDataPackKey] != "Error" ) {
                                    jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Ignored';
                                    jobInfo.alreadyExportedKeys.push(dataPack.VlocityDataPackKey);
                                }

                                return;
                            }
                            
                            if (dataPack.VlocityDataPackStatus == 'InProgress') {
                                dataPack.VlocityDataPackStatus = 'Error';
                                dataPack.VlocityDataPackMessage = 'Unknown Error - Use --verbose to see more information';
                            }

                            if (dataPack.VlocityDataPackData && dataPack.VlocityDataPackData.Id) {
                                processedKeys[dataPack.VlocityDataPackData.Id] = true;
                            }

                            if (jobInfo.currentStatus[dataPack.VlocityDataPackKey] != 'Success' && 
                                dataPack.VlocityDataPackRelationshipType != "Children" && 
                                dataPack.VlocityDataPackRelationshipType != "ManyParent") {
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
                                        jobInfo.alreadyExportedIdsByType[dataPack.VlocityDataPackType].push(dataPack.VlocityDataPackData.Id.substring(0, 15));
                                    }

                                    var dataField = self.vlocity.datapacksutils.getDataField(dataPack);

                                    if (dataField && dataPack.VlocityDataPackData && dataPack.VlocityDataPackData[dataField]) {
                                        if (dataPack.VlocityDataPackData[dataField].length == 0) {
                                            VlocityUtils.error('Error: ', 'No records found for - ', dataPack.VlocityDataPackType + ' --- ' + dataPack.VlocityDataPackName);
                                        } else {
                                            dataPack.VlocityDataPackData[dataField].forEach(function(dataEntry) {                                                
                                                if (jobInfo.alreadyExportedIdsByType[dataPack.VlocityDataPackType].indexOf(dataEntry.Id) == -1) {
                                                    jobInfo.alreadyExportedIdsByType[dataPack.VlocityDataPackType].push(dataEntry.Id);
                                                }
                                            });
                                        }
                                    }

                                    jobInfo.alreadyExportedKeys.push(dataPack.VlocityDataPackKey);

                                    if (self.vlocity.datapacksutils.isUniqueByName(dataPack.VlocityDataPackType) 
                                    && dataPack.VlocityDataPackData
                                    && dataPack.VlocityDataPackData[dataField]
                                    && dataPack.VlocityDataPackData[dataField][0]
                                    && dataPack.VlocityDataPackData[dataField][0].Name
                                    && jobInfo.alreadyExportedIdsByType[dataPack.VlocityDataPackType].indexOf(dataPack.VlocityDataPackData[dataField][0].Name) == -1) {
                                        jobInfo.alreadyExportedIdsByType[dataPack.VlocityDataPackType].push(dataPack.VlocityDataPackData[dataField][0].Name);
                                    }
                                }
                            } else if (dataPack.VlocityDataPackStatus == 'Ready' ) {

                                if (jobInfo.fullManifest[dataPack.VlocityDataPackType] == null) {
                                    jobInfo.fullManifest[dataPack.VlocityDataPackType] = {};
                                }
                                
                                if (result.dataPackError) {
                                    jobInfo.hasError = true;
                                    jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Error';

                                    if (dataPack.VlocityDataPackData.Id) {
                                        if (jobInfo.alreadyErroredIdsByType[dataPack.VlocityDataPackType] == null) {
                                            jobInfo.alreadyErroredIdsByType[dataPack.VlocityDataPackType] = [];
                                        }

                                        jobInfo.alreadyErroredIdsByType[dataPack.VlocityDataPackType].push(dataPack.VlocityDataPackData.Id);
                                    }

                                    var errorMessage = dataPack.VlocityDataPackType + ' --- ' + dataPack.VlocityDataPackName + ' --- ' + result.code + ':' + result.message;
                                    
                                    VlocityUtils.error('Error', errorMessage);
                                    
                                    jobInfo.errors.push(errorMessage);
                                    jobInfo.currentErrors[dataPack.VlocityDataPackKey] = errorMessage;
                                    
                                } else if (!jobInfo.fullManifest[dataPack.VlocityDataPackType][dataPack.VlocityDataPackKey]) {
                                    if (dataPack.VlocityDataPackRelationshipType == 'Children') {
                                        jobInfo.fullManifest[dataPack.VlocityDataPackType][dataPack.VlocityDataPackKey] = JSON.parse(stringify(dataPack));
                                    } else {
                                        jobInfo.fullManifest[dataPack.VlocityDataPackType][dataPack.VlocityDataPackKey] = JSON.parse(stringify(dataPack.VlocityDataPackData));
                                    }
                                }
                            } else if (dataPack.VlocityDataPackRelationshipType != 'Children' 
                                && (dataPack.VlocityDataPackStatus == 'Error' 
                                    || dataPack.VlocityDataPackStatus == 'Ignored')) {

                                if (dataPack.VlocityDataPackData.Id) {
                                    if (jobInfo.alreadyExportedIdsByType[dataPack.VlocityDataPackType] && jobInfo.alreadyExportedIdsByType[dataPack.VlocityDataPackType].indexOf(dataPack.VlocityDataPackData.Id) != -1) {
                                        return;
                                    }

                                    if (jobInfo.alreadyErroredIdsByType[dataPack.VlocityDataPackType] == null) {
                                        jobInfo.alreadyErroredIdsByType[dataPack.VlocityDataPackType] = [];
                                    }
                                    jobInfo.alreadyErroredIdsByType[dataPack.VlocityDataPackType].push(dataPack.VlocityDataPackData.Id);
                                }

                                if (jobInfo.currentStatus[dataPack.VlocityDataPackKey] != 'Success') {

                                    if (jobInfo.currentStatus[dataPack.VlocityDataPackKey] != 'Error') {
                                        jobInfo.currentStatus[dataPack.VlocityDataPackKey] = dataPack.VlocityDataPackStatus;
                                    }
                                    
                                    if (jobInfo.currentStatus[dataPack.VlocityDataPackKey] == 'Error') {   
                                        var errorMessage = dataPack.VlocityDataPackType + ' --- ' + dataPack.VlocityDataPackName + ' --- ' + (dataPack.VlocityDataPackMessage ? dataPack.VlocityDataPackMessage.trim() : '');

                                        jobInfo.hasError = true;
                                        
                                        if (jobInfo.errors.indexOf(errorMessage) == -1) {
                                            jobInfo.errors.push(errorMessage);
                                        }
                                        
                                        VlocityUtils.error('Error', errorMessage);
                                        jobInfo.currentErrors[dataPack.VlocityDataPackKey] = errorMessage;
                                    }
                                }
                            } 
                        });

                        originalKeys.forEach(function(pack) {
                            var packKey = pack.VlocityDataPackKey;

                            if (!packKey) {
                                packKey = pack.VlocityDataPackType + '/' + self.vlocity.datapacksexpand.getDataPackFolder(pack.VlocityDataPackType, pack.VlocityRecordSObjectType, pack);
                            }

                            if (dataPackData.retrieveError) {
                                jobInfo.hasError = true;
                                jobInfo.errors.push(packKey + ' >> ' + dataPackData.retrieveError);
                                jobInfo.currentStatus[packKey] = 'Error';
                                jobInfo.currentErrors[packKey] = dataPackData.retrieveError;
                                VlocityUtils.error('Retrieve Error', packKey, pack.Id, pack.VlocityDataPackType );

                                if (pack.Id) {
                                    if (jobInfo.alreadyErroredIdsByType[pack.VlocityDataPackType] == null) {
                                        jobInfo.alreadyErroredIdsByType[pack.VlocityDataPackType] = [];
                                    }

                                    jobInfo.alreadyErroredIdsByType[pack.VlocityDataPackType].push(pack.Id);
                                }
                            } else if ((pack.VlocityDataPackKey && !processedKeys[pack.VlocityDataPackKey]) || (pack.Id && !processedKeys[pack.Id])) {
                                VlocityUtils.verbose('Ignored', packKey);
                                jobInfo.currentStatus[packKey] = 'Ignored';

                                // Means it was from a Query
                                if (pack.Id && !pack.VlocityDataPackKey) {
                                    self.setToUnknownExportError(jobInfo, pack);
                                }
                            }
                        });

                        self.vlocity.datapacksexportbuildfile.addToExportBuildFile(jobInfo, JSON.parse(stringify(dataPackData, { space: 4 })));

                        if (jobInfo.expansionPath) {
                            self.vlocity.datapacksexpand.expand(jobInfo.projectPath + '/' + jobInfo.expansionPath, dataPackData, jobInfo, function() {
                                if (jobInfo.delete) {
                                    return self.vlocity.datapacks.delete(result.VlocityDataPackId, self.getOptionsFromJobInfo(jobInfo), callback, callback);
                                }
                                callback();
                            });
                        } else {
                            if (jobInfo.delete) {
                                return self.vlocity.datapacks.delete(result.VlocityDataPackId, self.getOptionsFromJobInfo(jobInfo), callback, callback);
                            } 
                            callback();
                        }   
                    });
                });
            
        }
    },
    seriesGroupMax);
    
    q.drain = function(err, result) {
        self.vlocity.datapacksutils.printJobStatus(jobInfo);
       
        self.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo);
        if ((!jobInfo.hasError || jobInfo.continueAfterError) && jobInfo.exportRemaining > 0) {
            VlocityUtils.success('Continuing Export');

            jobInfo.toExportGroups = null;
           
            self.exportFromManifest(jobInfo, onComplete);
        } else {
            var savedFormat = [];

            self.vlocity.datapacksexportbuildfile.saveFile();
           
            if (self.vlocity.datapacksexportbuildfile.currentExportFileData) {
 
                Object.keys(self.vlocity.datapacksexportbuildfile.currentExportFileData).forEach(function(dataPackId) {
                    savedFormat.push(self.vlocity.datapacksexportbuildfile.currentExportFileData[dataPackId]);
                });

                var dataPacksToExpand = JSON.parse(stringify({ dataPacks: savedFormat }));

                self.vlocity.datapacksexpand.expand(jobInfo.projectPath + '/' + jobInfo.expansionPath, dataPacksToExpand, jobInfo, function() {
                    onComplete(jobInfo);       
                });
            } else {
                onComplete(jobInfo);
            }
        }
    }; 

    jobInfo.toExportGroups.forEach(function(group) {
        q.push({ group: group }, function (err) {
            self.vlocity.datapacksutils.printJobStatus(jobInfo);
            self.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo);
        });
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

    if (jobInfo.buildFile) {

        self.vlocity.datapacksbuilder.buildImport(fullDataPath, jobInfo, {}, function(dataJson) { 

            if (dataJson && jobInfo.dataPackName) {
                dataJson.name = jobInfo.dataPackName;
            }

            if (dataJson) {

                jobInfo.data = JSON.parse(stringify(dataJson));

                var fileName = jobInfo.buildFile;

                fs.outputFileSync(jobInfo.projectPath + '/' + fileName, stringify(dataJson, { space: 4 }), 'utf8');

                if (fileName.indexOf('.resource') > 0) {
                    // also create .resource-meta.xml
                    fs.outputFileSync(jobInfo.projectPath + '/' + fileName + '-meta.xml', '<?xml version="1.0" encoding="UTF-8"?><StaticResource xmlns="http://soap.sforce.com/2006/04/metadata"><cacheControl>Public</cacheControl><contentType>text/json</contentType></StaticResource>',
                        'utf8');
                }
                
                VlocityUtils.error('Creating File', jobInfo.projectPath + '/' + jobInfo.buildFile);

                onComplete(jobInfo);

            } else {
                onComplete(jobInfo);
            }
        });
    } else {
        onComplete(jobInfo);
    }
};

DataPacksJob.prototype.expandFile = function(jobInfo, onComplete) {
    var self = this;

    var expansionFiles = glob.readdirSync(path.join(jobInfo.projectPath, jobInfo.buildFile));

    console.log(expansionFiles);

    
    expansionFiles.forEach(function(file) {

        var jobInfoNew = JSON.parse(JSON.stringify(jobInfo));

        self.vlocity.datapacksexpand.expandFile(jobInfo.projectPath + '/' + jobInfo.expansionPath, file, jobInfoNew);
    
    });
    
    if (onComplete) {
        onComplete(jobInfo);
    }
};

DataPacksJob.prototype.updateSettings = function(jobInfo, onComplete) {
    var self = this;

    var projectPathsToDeploy = [  'latest' ];

    if (self.vlocity.BuildToolSettingVersion != 'latest') {

        var vers = self.vlocity.BuildToolSettingLatestVersion - 1;
        while (vers >= self.vlocity.BuildToolSettingVersion) {
            projectPathsToDeploy.push(path.join(__dirname, '..', 'DataPackSettings', 'v' + vers));
            vers--;
        }
    }

    self.vlocity.datapacksutils.runApex('.', 'ResetDataPackMappings.cls').then(function() {

        async.eachSeries(projectPathsToDeploy, function(pathToDeploy, callback) {

            var nextJob = {
                projectPath: path.join(__dirname, '..', 'DataPackSettings', pathToDeploy),
                delete: true,
                defaultMaxParallel: 10,
                resetFileData: true
            };
            
            self.runJobWithInfo(nextJob, 'Deploy',
                function(result) {
                    if (result.status == 'error') {
                        VlocityUtils.error('Error Updating Settings');
                        callback(result);
                    } else {
                        callback();
                    }
                });
        }, function(err, result) {           
            onComplete(jobInfo);
        });
    });    
};

DataPacksJob.prototype.refreshVlocityBase = function(jobInfo, onComplete) {
    var self = this;

    self.vlocity.jsForceConnection.query("Select Name, Body from StaticResource where Name LIKE 'DP_CARDS%' OR Name LIKE 'DP_TEMPLATES%' OR Name LIKE 'DP_CPQ%' OR Name LIKE 'DP_CUSTOM%'", function(err, result) {

        if (err) { return VlocityUtils.error(err); }

        async.eachSeries(result.records, function(record, callback) {

            self.vlocity.jsForceConnection.request(record.Body, function(err, res) {

                if (err) { 
                    throw err; 
                }

                try {

                    VlocityUtils.report('Beginning Deployment', record.Name);

                    self.vlocity.datapacks.import(JSON.parse(res), self.getOptionsFromJobInfo(jobInfo), 
                        function(result) {
                            self.vlocity.datapacks.getDataPackData(result.VlocityDataPackId, function(dataPackData) {

                                VlocityUtils.success('Resource Deployed', record.Name);
                                dataPackData.dataPacks.forEach(function(dataPack) {
                                    VlocityUtils.success('Deploy Success', dataPack.VlocityDataPackType, '-', dataPack.VlocityDataPackKey, '-', dataPack.VlocityDataPackName);
                                });

                                self.vlocity.datapacks.activate(result.VlocityDataPackId, ['ALL'], self.getOptionsFromJobInfo(jobInfo), 
                                    function(activateResult){
                                        VlocityUtils.success('Resource Activated', record.Name);
                                        jobInfo.refreshVlocityBase.push({ Name: record.Name, Status: 'Success' });
                                        callback();
                                    },
                                    function(err) {
                                        jobInfo.hasError = true;

                                        jobInfo.refreshVlocityBase.push({ Name: record.Name, Status: 'Error' });
                                        VlocityUtils.error('Resource Activation Failed', record.Name, stringify(err));

                                        callback();
                                });
                            });
                        }, 
                        function(err) {
                            VlocityUtils.error(err);
                            callback();
                        });
                    } catch (e) {
                        VlocityUtils.error('Error Processing', record.Name, e);
                        callback();
                    }
            });
        },
        function(err, result) {
            onComplete(jobInfo);
        });   
    });
};

DataPacksJob.prototype.runStepJavaScript = function(projectPath, stepSettings, dataPackData, jobInfo, onComplete) {
    var self = this;

    if (stepSettings) {
        async.eachSeries(dataPackData.dataPacks, function(dataPack, callback) {

            if (stepSettings[dataPack.VlocityDataPackType]) {
                self.vlocity.datapacksutils.runJavaScript(projectPath, stepSettings[dataPack.VlocityDataPackType], dataPack, jobInfo, function() {
                    callback();
                });
            } else {
                callback();
            }
            
        }, function(err, result) {
            onComplete();
        });
    } else {
        onComplete();
    }
};


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
                    runApexByType[apexClass] = { apexData: [], apexClass: apexClass };
                }

                runApexByType[apexClass].apexData.push(dataPack);
            }
        });
        
        async.eachSeries(Object.keys(runApexByType), function(apexClassName, callback) {
            self.vlocity.datapacksutils.runApex(projectPath, runApexByType[apexClassName].apexClass, runApexByType[apexClassName].apexData).then(function() {
                callback();
            });
        }, function(err, result) {
            onComplete();
        });
    } else {
        onComplete();
    }
};

DataPacksJob.prototype.buildImportSeries = function(jobInfo, deploySeries, currentImportInfo, onComplete) {
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

    self.vlocity.datapacksbuilder.buildImport(jobInfo.projectPath, jobInfo, currentImportInfo, function(deployEntry) {

        if (deployEntry == null) {
            onComplete(deploySeries);
        } else {
            deploySeries.push(deployEntry);

            if (deploySeries.length < maxSeries) {
                self.buildImportSeries(jobInfo, deploySeries, currentImportInfo, onComplete);
            } else {
                onComplete(deploySeries);
            }
        }
    });
};

DataPacksJob.prototype.activateAll = function(dataPackData, jobInfo, onComplete, attempts) {
    var self = this;

    if (!attempts) {
        attempts = 0;
    }

    self.vlocity.datapacks.activate(dataPackData.dataPackId, ['ALL'], self.getOptionsFromJobInfo(jobInfo), 
        function(activateResult) {

            self.vlocity.datapacks.getDataPackData(dataPackData.dataPackId, function(dataPackData) {

                var shouldRetry = false;
                if (dataPackData && dataPackData.dataPacks) {
                    dataPackData.dataPacks.forEach(function(dataPack) {

                        if (dataPack.ActivationStatus == 'Ready' && dataPack.VlocityDataPackStatus == 'Success') {

                            // If it is the only one in the deploy and it fails to activate it must be set to error. Otherwise retry the deploy and activation separate from others.
                            if (dataPackData.dataPacks.length == 1) {
                                
                                jobInfo.hasError = true;
                                jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Error';
                                jobInfo.currentErrors[dataPack.VlocityDataPackKey] = 'Activation Error >> ' + dataPack.VlocityDataPackKey + ' --- Not Activated';
                                jobInfo.errors.push('Activation Error >> ' + dataPack.VlocityDataPackKey + ' --- Not Activated');
                                VlocityUtils.error('Activation Error', dataPack.VlocityDataPackKey + ' --- Not Activated');
                                    
                            } else if (attempts < 3) {
                                shouldRetry = true;
                            } else {
                                jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'ReadySeparate';
                            }
                        } else if (dataPack.ActivationStatus == 'Error') {

                            var message = 'Activation Error >> ' +  dataPack.VlocityDataPackKey + ' --- ' + (dataPack.ActivationMessage ? dataPack.ActivationMessage : (activateResult.error != 'OK' ? activateResult.error : ''));

                            jobInfo.hasError = true;
                            jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Error';
                            
                            if (!jobInfo.currentErrors[dataPack.VlocityDataPackKey]) {
                                jobInfo.currentErrors[dataPack.VlocityDataPackKey] = message;
                                jobInfo.errors.push(message);

                                VlocityUtils.error('Activation Error', dataPack.VlocityDataPackKey, dataPack.ActivationMessage ? dataPack.ActivationMessage : activateResult.error != 'OK' ? activateResult.error : '');
                            }
                        }
                    });
                }

                if (shouldRetry) {
                    self.vlocity.datapacks.ignoreActivationErrors(dataPackData.dataPackId, function() {
                        self.activateAll(dataPackData, jobInfo, onComplete, attempts+1);
                    });   
                } else {
                    onComplete();
                }
            });
        });
};

DataPacksJob.prototype.deployJob = function(jobInfo, onComplete) {
    var self = this;

    self.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo);
    
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
    
    if (jobInfo.supportParallel) {
        maxSeries = jobInfo.defaultMaxParallel;
    }

    var finishJobFinal = function(jobInfo) {
        self.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo);
        
        onComplete(jobInfo);
    };

    self.buildImportSeries(jobInfo, [], {}, function(deploySeries) {
        if (deploySeries.length == 0) {

            var notDeployed = [];
            var headers = [];

            self.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo);

            Object.keys(jobInfo.currentStatus).forEach(function(dataPackKey) {
                if (jobInfo.currentStatus[dataPackKey] == 'Ready' || jobInfo.currentStatus[dataPackKey] == 'ReadySeparate') {
                    notDeployed.push('Not Deployed >> ' + dataPackKey);
                } else if (jobInfo.currentStatus[dataPackKey] == 'Header') {
                    notDeployed.push('Not Deployed >> ' + dataPackKey);
                    headers.push(dataPackKey);
                } else if (jobInfo.currentStatus[dataPackKey] == 'Added') {
                    jobInfo.errors.push('Not Deployed >> ' + dataPackKey);
                    jobInfo.hasError = true;
                }
            });

            if (initializing || notDeployed.length > 0) {
                if (jobInfo.supportParallel) {
                    
                    jobInfo.supportParallel = false;
                    self.deployJob(jobInfo, onComplete);
                } else if (jobInfo.headersOnly) {
                    if (headers.length > 0) {
                        jobInfo.headersOnly = false;
                        jobInfo.headersOnlyDidNotHelp = true;

                        self.deployJob(jobInfo, onComplete);
                    } else if (jobInfo.supportForceDeploy) {
                        
                        jobInfo.forceDeploy = true;
                        jobInfo.headersOnly = false;
                        self.deployJob(jobInfo, onComplete);
                    } else {
                        jobInfo.hasError = true;
                        jobInfo.errors = jobInfo.errors.concat(notDeployed);
                        onComplete(jobInfo);
                    }
                } else if (jobInfo.forceDeploy) {
                    if (jobInfo.notDeployedCount == notDeployed.length) {
                        if (!jobInfo.ignoreAllParents) {
                            jobInfo.ignoreAllParents = true;
                        } else {
                            jobInfo.hasError = true;
                            jobInfo.errors = jobInfo.errors.concat(notDeployed);
                                
                            return onComplete(jobInfo);
                        }
                    }

                    jobInfo.notDeployedCount = notDeployed.length;
                    self.deployJob(jobInfo, onComplete);
                } else if (jobInfo.supportHeadersOnly || jobInfo.supportForceDeploy) {

                    if (!jobInfo.supportHeadersOnly) {
                        
                        jobInfo.forceDeploy = true;
                        jobInfo.headersOnly = false;
                        self.deployJob(jobInfo, onComplete);
                    } else if (jobInfo.headersOnlyDidNotHelp) {

                        if (jobInfo.supportForceDeploy) {
                            
                            jobInfo.forceDeploy = true;
                            jobInfo.headersOnly = false;
                            self.deployJob(jobInfo, onComplete);
                        } else {
                            jobInfo.hasError = true;
                            jobInfo.errors = jobInfo.errors.concat(notDeployed);
                            
                            onComplete(jobInfo);
                        }                       
                    } else {
                        jobInfo.headersOnly = true;

                        self.deployJob(jobInfo, onComplete);
                    }
                } else {
                    jobInfo.hasError = true;
                    jobInfo.errors = jobInfo.errors.concat(notDeployed);
                        
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
                        var data = jobInfo.allDataSummary[dataPack.VlocityDataPackKey];

                        if (data) {
                            data.VlocityDataPackType = dataPack.VlocityDataPackType;
                            preStepDeployData.push(data);
                        }
                    });
                }

                var apexSettings;
                if (jobInfo.preStepApex && jobInfo.preStepApex.Deploy) {
                    apexSettings = jobInfo.preStepApex.Deploy;
                }

                var javaScriptSettings;
                if (jobInfo.preStepJavaScript && jobInfo.preStepJavaScript.Deploy) {
                    javaScriptSettings = jobInfo.preStepJavaScript.Deploy;
                }

                self.runStepJavaScript(jobInfo.projectPath, javaScriptSettings, dataJson, jobInfo, function() {
                    self.runStepApex(jobInfo.projectPath, apexSettings, preStepDeployData, jobInfo.shouldDebug, function() {

                        self.vlocity.datapacks.import(dataJson, self.getOptionsFromJobInfo(jobInfo), function(result) {

                            // Prevent endless deploy loops due to server side issues
                            var thisDeployHasError = result.Status == 'Error';
                            var atLeastOneRecordHasError = false;

                            if (result.VlocityDataPackId) {
                            
                                var dataPackId = result.VlocityDataPackId;

                                var stepPostDeployResults = [];

                                self.vlocity.datapacks.getDataPackData(dataPackId, function(dataPackData) {
                                
                                    (dataPackData && dataPackData.dataPacks ? dataPackData.dataPacks : []).forEach(function(dataPack) {

                                        if (dataPack.VlocityDataPackRelationshipType != 'Pagination') {
                                            jobInfo.currentStatus[dataPack.VlocityDataPackKey] = dataPack.VlocityDataPackStatus;
                                        }

                                        if (dataPack.VlocityDataPackStatus == 'Success') {

                                            // Stop an endless loop of headers
                                            if (jobInfo.headersOnly) {
                                                jobInfo.headersOnlyDidNotHelp = false;
                                            }

                                            VlocityUtils.success('Deploy Success', dataPack.VlocityDataPackKey + ' ' + dataPack.VlocityDataPackName, jobInfo.headersOnly ? '- Headers Only' : '');

                                            if (jobInfo.headersOnly) {
                                                var headersType = self.vlocity.datapacksutils.getHeadersOnly(dataPack.VlocityDataPackType);

                                                if (headersType == "Identical") {
                                                    jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Success';
                                                } else {
                                                    jobInfo.currentStatus[dataPack.VlocityDataPackKey] = "Header";
                                                }
                                            } else {
                                                var sobjTypeList = self.vlocity.datapacksutils.getApexSObjectTypeList(dataPack.VlocityDataPackType);
                                                
                                                dataPack.VlocityDataPackRecords.forEach(function(record) {
                                                    if (record.VlocityRecordStatus == 'Success') {

                                                        jobInfo.sourceKeyToRecordId[record.VlocityRecordSourceKey] =  record.VlocityRecordSalesforceId;
                                                        jobInfo.postDeployResults.push({ "Id": record.VlocityRecordSalesforceId });

                                                        if (!sobjTypeList || sobjTypeList.indexOf(record.VlocityRecordSObjectType) != -1) {
                                                            stepPostDeployResults.push({ "Id": record.VlocityRecordSalesforceId, VlocityDataPackType: dataPack.VlocityDataPackType });
                                                        }
                                                    }
                                                });
                                            }
                                        } else if (dataPack.VlocityDataPackStatus == 'Error' || 
                                                    dataPack.VlocityDataPackStatus == 'Ignored' || 
                                                    dataPackData.dataPacks.length == 1) {

                                            if (dataPack.VlocityDataPackMessage && dataPack.VlocityDataPackMessage.indexOf('unable to obtain') != -1) {
                                                VlocityUtils.warn('Retry', dataPack.VlocityDataPackKey, dataPack.VlocityDataPackMessage);
                                                jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Ready';  
                                                atLeastOneRecordHasError = true; 
                                            } else {
                                                jobInfo.hasError = true;
                                                atLeastOneRecordHasError = true;
        
                                                var errorMessage = [
                                                    '  ' + dataPack.VlocityDataPackKey, 
                                                    'DataPack >> ' + (dataPack.VlocityDataPackName ? dataPack.VlocityDataPackName : dataPack.VlocityDataPackKey), 
                                                    'Error Message', (dataPack.VlocityDataPackMessage || 'No error message from server')
                                                ].map(v => v.trim()).join(' -- ');
        
                                                VlocityUtils.error('Deploy Error', errorMessage);
                                                jobInfo.errors.push(errorMessage);
                                                jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Error';
                                                jobInfo.currentErrors[dataPack.VlocityDataPackKey] = errorMessage;
                                            }
                                        }
                                    });

                                    if (dataPackData && dataPackData.dataPacks && thisDeployHasError && !atLeastOneRecordHasError) {
                                        dataPackData.dataPacks.forEach(function(dataPack) {

                                            if (dataPack.VlocityDataPackStatus == 'Ready') {
                                                jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'ReadySeparate';

                                                VlocityUtils.error('Setting to Deploy Separate', dataPack.VlocityDataPackKey + ' --- ' + result.Message);
                                            }
                                        });           
                                    }

                                    return new Promise(function(resolve, reject) {
                                        if (jobInfo.activate) {
                                            self.activateAll(dataPackData, jobInfo, function() {
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
                                    }).catch(function(error) {
                                        VlocityUtils.log('Uncaught Exception: ', error.stack);
                                    });
                                });
                            } else {
                                dataJson.dataPacks.forEach(function(dataPack) {
                                    jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Error';
                                    jobInfo.errors.push(dataPack.VlocityDataPackKey + ' ' + (result.Message ? result.Message : '>> Unknown Error'));

                                    VlocityUtils.error('Deploy Error', 'Deploy Failed', dataPack.VlocityDataPackKey + ' ' + (result.Message ? result.Message : '>> Unknown Error'));
                                });

                                jobInfo.hasError = true;
                                callback();
                            }
                        });
                    });
                });
            }, function(err, result) {
                var stillRemaining = 0;

                Object.keys(jobInfo.currentStatus).forEach(function(dataPackKey) {

                    // Trying to account for failures on other objects
                    if (jobInfo.currentStatus[dataPackKey] == 'Added') {
                        jobInfo.currentStatus[dataPackKey] = 'ReadySeparate';
                    }

                    if (jobInfo.currentStatus[dataPackKey] == 'Ready' || jobInfo.currentStatus[dataPackKey] == 'Header' || jobInfo.currentStatus[dataPackKey] == 'ReadySeparate') {
                        stillRemaining++;
                    }
                });

                if (stillRemaining == 0 || (jobInfo.hasError && !jobInfo.continueAfterError)) {
                    self.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo);
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
        
        jobInfo.hasError = true;
        jobInfo.errors = jobInfo.errors.concat(errors);
      
        var afterDelete = function() {
            onComplete(jobInfo);
        };

        if (jobInfo.delete) {
            self.vlocity.datapacks.delete(err.VlocityDataPackId ? err.VlocityDataPackId : err.dataPackId, self.getOptionsFromJobInfo(jobInfo), afterDelete, afterDelete);
        } else {
            onComplete(jobInfo);
        }
    };

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

                var filename = jobInfo.projectPath + '/' + dataPackData.name + '.json';

                fs.outputFileSync(filename, stringify(dataPackData, { space: 4 }));
               
                self.vlocity.datapacksexpand.expand(jobInfo.projectPath + '/' + jobInfo.expansionPath, dataPackData, jobInfo, function() {
                    callback();
                });
            });
        }, function(err, result) {
            if (onComplete) {
                onComplete(jobInfo);
            }
        });
    });
};

DataPacksJob.prototype.checkDiffs = function(jobInfo, currentLocalFileData, targetOrgRecordsHash) {
    var self = this;

    var currentFiles = [];
    var exportedFiles = [];

    var totalUnchanged = 0;
    var totalDiffs = 0;
    var totalNew = 0;

    if (!currentLocalFileData) return;

    if (!currentLocalFileData.dataPacks) {
        currentLocalFileData.dataPacks = [];
    }

    currentLocalFileData.dataPacks.forEach(function(dataPack) {

        var dataPackHash = self.vlocity.datapacksutils.getDataPackHashable(dataPack, jobInfo);

        if (stringify(targetOrgRecordsHash[dataPack.VlocityDataPackKey]) == stringify(dataPackHash)) {
            jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Success';
            totalUnchanged++;
            jobInfo.diffStatus[dataPack.VlocityDataPackKey] = false;
            
            VlocityUtils.warn('Unchanged', dataPack.VlocityDataPackKey + ' - ' + dataPack.VlocityDataPackName);        
        } else {
            jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Ready';
            jobInfo.diffStatus[dataPack.VlocityDataPackKey] = true;

            if (targetOrgRecordsHash[dataPack.VlocityDataPackKey]) {

                currentFiles.push(dataPackHash);
                exportedFiles.push(targetOrgRecordsHash[dataPack.VlocityDataPackKey]);

                VlocityUtils.warn('Changes Found', dataPack.VlocityDataPackKey + ' - ' + dataPack.VlocityDataPackName);
                totalDiffs++;
            } else {

                VlocityUtils.warn('New', dataPack.VlocityDataPackType + ' - ' + dataPack.VlocityDataPackKey);
                totalNew++;
            }
        }   
    });

    VlocityUtils.report('Unchanged', totalUnchanged);
    VlocityUtils.report('Diffs', totalDiffs);
    VlocityUtils.report('New', totalNew);

    fs.outputFileSync(path.join(this.vlocity.tempFolder, 'diffs/localFolderFiles.json'), stringify(currentFiles, { space: 4 }));
    fs.outputFileSync(path.join(this.vlocity.tempFolder, 'diffs/targetOrgFiles.json'), stringify(exportedFiles, { space: 4 }));
};

DataPacksJob.prototype.getDiffs = function(jobInfo, onComplete) {
    var self = this;

    jobInfo.cancelDeploy = true;
    self.getDiffsAndDeploy(jobInfo, onComplete);
};

DataPacksJob.prototype.getDiffsAndDeploy = function(jobInfo, onComplete) {
    var self = this;
    
    if (!jobInfo.manifest) {
        var getManifestJobInfo = JSON.parse(JSON.stringify(jobInfo));

        self.vlocity.datapacksbuilder.initializeImportStatus(getManifestJobInfo.projectPath + '/' + getManifestJobInfo.expansionPath, getManifestJobInfo);

        jobInfo.manifest = Object.keys(getManifestJobInfo.currentStatus);
    }

    if (!jobInfo.savedProjectPath) {
        jobInfo.savedProjectPath = jobInfo.projectPath;
    }

    jobInfo.projectPath = path.join(this.vlocity.tempFolder, 'diffs');

    fs.removeSync(path.join(this.vlocity.tempFolder, 'diffs'));

    var targetOrgRecordsHash = {};
    
    self.exportJob(jobInfo, function(jobInfo) {    

        jobInfo.manifest = null;
        jobInfo.singleFile = true;
        jobInfo.specificManifestKeys = null;
        jobInfo.specificManifestObjects = null;

        VlocityUtils.silence = true;
        jobInfo.currentStatus = {};

        jobInfo.resetFileData = true;

        self.vlocity.datapacksbuilder.buildImport(jobInfo.projectPath, jobInfo, {}, function(currentFileData) { 
            
            if (currentFileData && currentFileData.dataPacks) {

                VlocityUtils.warn('Total Exported DataPacks', currentFileData.dataPacks.length);

                currentFileData.dataPacks.forEach(function(dataPack) {
                    // Iterate over this and hash each individual 1 as JSON
                    targetOrgRecordsHash[dataPack.VlocityDataPackKey] = self.vlocity.datapacksutils.getDataPackHashable(dataPack, jobInfo);
                });
            } else {
                VlocityUtils.error('No DataPacks Found');
            }

            jobInfo.projectPath = jobInfo.savedProjectPath;

            self.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo);

            jobInfo.currentStatus = {};
            jobInfo.manifest = null;
            jobInfo.specificManifestKeys = null;
            jobInfo.specificManifestObjects = null;
            jobInfo.resetFileData = true;
            jobInfo.VlocityDataPackIds = [];
            jobInfo.singleFile = true;
            jobInfo.toExportGroups = null;

            self.vlocity.datapacksbuilder.buildImport(jobInfo.projectPath, jobInfo, {},function(checkDiffsFile) { 
                VlocityUtils.silence = false;

                self.checkDiffs(jobInfo, checkDiffsFile, targetOrgRecordsHash);
                
                jobInfo.errors = [];
                jobInfo.hasError = false;
                jobInfo.errorMessage = '';
                jobInfo.singleFile = false;
                jobInfo.jobAction = 'Deploy';

                if (jobInfo.cancelDeploy) {
                    onComplete(jobInfo);
                } else {
                    self.runJobWithInfo(jobInfo, jobInfo.jobAction, onComplete, onComplete);
                }
            });
        });
    });
};

DataPacksJob.prototype.cleanOrgData = function(jobInfo, onComplete) {
    jobInfo.javascript = 'cleanData.js';
    this.reExpandAllFilesAndRunJavaScript(jobInfo, onComplete);
};

DataPacksJob.prototype.validateLocalData = function(jobInfo, onComplete) {
    jobInfo.javascript = { All: 'validateLocalData.js' };
    jobInfo.skipExpand = !jobInfo.fixLocalGlobalKeys;
    VlocityUtils.silence = true;
    this.reExpandAllFilesAndRunJavaScript(jobInfo, onComplete);
};

DataPacksJob.prototype.refreshProject = function(jobInfo, onComplete) {
    jobInfo.javascript = null;
    jobInfo.specificManifestKeys = null;
    jobInfo.manifest = null;
    this.reExpandAllFilesAndRunJavaScript(jobInfo, onComplete);
};

DataPacksJob.prototype.reExpandAllFilesAndRunJavaScript = function(jobInfo, onComplete) {
    var self = this;

    if (typeof jobInfo.javascript == 'string') {
        self.vlocity.datapacksutils.runJavaScript(jobInfo.projectPath, jobInfo.javascript, null, jobInfo, onComplete);
    } else {
        var fullDataPath = jobInfo.projectPath;

        jobInfo.singleFile = true;
        jobInfo.disablePagination = true;
        jobInfo.compileOnBuild = false;
        jobInfo.fullStatus = true;

        VlocityUtils.verbose('Getting DataPacks', fullDataPath, jobInfo.manifest, jobInfo);

        self.vlocity.datapacksbuilder.buildImport(fullDataPath, jobInfo, {}, function(dataJson) { 
            if (dataJson && dataJson.dataPacks) {
                dataJson.dataPacks.forEach(function(dataPack) {
                    if (jobInfo.javascript && jobInfo.javascript[dataPack.VlocityDataPackType]) {

                        var jsFiles;
                    
                        if (typeof jobInfo.javascript[dataPack.VlocityDataPackType] === 'string') {
                            jsFiles = [jobInfo.javascript[dataPack.VlocityDataPackType]];
                        } else {
                            jsFiles = jobInfo.javascript[dataPack.VlocityDataPackType];
                        }

                        jsFiles.forEach(function(file) {
                            self.vlocity.datapacksutils.runJavaScript(jobInfo.projectPath, file, dataPack, jobInfo);
                        });                 
                    }
                });

                if (typeof jobInfo.javascript == 'string') {
                    jobInfo.javascript = { All: jobInfo.javascript };
                }

                if (jobInfo.javascript && jobInfo.javascript.All) {

                    var jsFiles;
                
                    if (typeof jobInfo.javascript.All === 'string') {
                        jsFiles = [jobInfo.javascript.All];
                    } else {
                        jsFiles = jobInfo.javascript.All;
                    }

                    async.eachSeries(jsFiles, function(file, callback) {
                        self.vlocity.datapacksutils.runJavaScript(jobInfo.projectPath, file, dataJson.dataPacks, jobInfo, function() {
                            callback();
                        });
                    }, function(err, result) {
                        VlocityUtils.success('Run All JavaScript Complete');       
                    });          
                }

                fs.outputFileSync(RUN_JS_TEMP, stringify(dataJson, { space: 4 }), 'utf8');

                if (jobInfo.skipExpand) {
                    onComplete(jobInfo);
                } else {

                    self.vlocity.datapacksexpand.expand(jobInfo.projectPath + '/' + jobInfo.expansionPath, dataJson, jobInfo, function() {

                        self.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo);
                        onComplete(jobInfo);
                    });
                }
            } else {
                onComplete(jobInfo); 
            }
        });
    }
};

DataPacksJob.prototype.runApex = function(jobInfo, onComplete) {
    var self = this;
    VlocityUtils.report('Running Apex', jobInfo.apex);

    self.vlocity.datapacksutils.runApex(jobInfo.folder ? jobInfo.folder : jobInfo.projectPath, jobInfo.apex, []).then(function() {
        onComplete(jobInfo); 
    });
};