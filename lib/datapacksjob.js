var fs = require('fs-extra');
var async = require('async');
var stringify = require('json-stable-stringify');
var path = require('path');
var yaml = require('js-yaml');
var childProcess = require('child_process');

var DataPacksJob = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};

    RUN_JS_TEMP = path.join(this.vlocity.tempFolder, 'runJavaScriptTemp.json');
    this.defaultJobSettings = yaml.safeLoad(fs.readFileSync(path.join(__dirname, 'defaultjobsettings.yaml'), 'utf8'));
    this.queryDefinitions = yaml.safeLoad(fs.readFileSync(path.join(__dirname, 'querydefinition.yaml'), 'utf8'));
    this.runningParallel = {};
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

var MAX_PER_GROUP = 10;
var RUN_JS_TEMP;

DataPacksJob.prototype.getOptionsFromJobInfo = function(jobInfo) {
    var options = {};

    for (var jobKey in SUPPORTED_JOB_KEY_TO_OPTION_MAP) {

        if (jobInfo[jobKey] != null) {
            options[SUPPORTED_JOB_KEY_TO_OPTION_MAP[jobKey]] = jobInfo[jobKey];
        }
    }

    return options;
};

DataPacksJob.prototype.runJob = async function(action, jobData) {
    var jobInfo = jobData;

    try {
        jobInfo.jobAction = action;
    
        this.mergeInJobDefaults(jobInfo);
    
        if (!jobInfo.queries && !jobInfo.manifest) {
            jobInfo.queryAll = true;
        }
    
        if (jobInfo.queryAll) {
            jobInfo.queries = Object.keys(this.queryDefinitions);
            jobInfo.ignoreQueryErrors = true;
        }  
        
        if (jobInfo.queries) {
            for (var i = 0; i < jobInfo.queries.length; i++) {
                if (typeof jobInfo.queries[i] === 'string') {
                    jobInfo.queries[i] = this.queryDefinitions[jobInfo.queries[i]];
                }
            }
        }
    
        if (jobInfo.OverrideSettings) {
            this.vlocity.datapacksutils.overrideExpandedDefinition(jobInfo.OverrideSettings);
        }
    
        let resForThis = await this.runJobWithInfo(jobInfo, action);

        VlocityUtils.report('Job Complete', action);

        return resForThis;
    } catch (e) {
        VlocityUtils.error('Initialization Error', e);
        return await this.formatResponse(jobInfo, e);
    }
};

DataPacksJob.prototype.mergeInJobDefaults = function(jobInfo) {
    for (settingsKey in this.defaultJobSettings) {
        if (jobInfo[settingsKey] === undefined) {
            jobInfo[settingsKey] = this.defaultJobSettings[settingsKey];
        }
    }

    if (jobInfo.strict) {
        jobInfo.supportHeadersOnly = false;
        jobInfo.supportForceDeploy = false;
        jobInfo.ignoreAllErrors = false;
    }
};    

DataPacksJob.prototype.intializeJobInfo = async function(jobInfo, action) {
    
    // Will not continue a single DataPack, but will continue when there are breaks in the job
    if (action == 'Continue' || action == 'Retry') {
        this.vlocity.datapacksutils.loadCurrentJobInfo(jobInfo);

        jobInfo.hasError = false;
        jobInfo.headersOnlyDidNotHelp = false;
        jobInfo.startTime = VlocityUtils.startTime;
        jobInfo.headersOnly = false;
        
        if (jobInfo.jobAction == 'Export' 
            || jobInfo.jobAction == 'GetDiffs' 
            || jobInfo.jobAction == 'GetDiffsAndDeploy') {
            this.vlocity.datapacksexportbuildfile.loadExportBuildFile(jobInfo);
            
            if (action == 'Continue') {
                if (jobInfo.queries) {
                    jobInfo.skipQueries = true;
                }
            } else if (action == 'Retry') {
                VlocityUtils.success('Back to Ready');

                for (var dataPackKey in jobInfo.currentStatus) {
                    if (jobInfo.currentStatus[dataPackKey] == 'Error') {
                        jobInfo.currentStatus[dataPackKey] = 'Ready';
                    }
                }
            }
        }

        if (jobInfo.jobAction == 'Deploy') {
            jobInfo.forceDeploy = false;
            jobInfo.preDeployDataSummary = [];

            for (var dataPackKey in jobInfo.currentStatus) {
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
            }
        }

        if (action == 'Retry') {
            jobInfo.errors = [];
            VlocityUtils.success('Back to Ready');
        }

        // Allow Changing a Current jobInfo property by specifying it in a Retry - Is a Permanent change to the jobInfo
        if (this.vlocity.commandLineOptionsOverride) {

            for (var argument in this.vlocity.commandLineOptionsOverride) {
                jobInfo[argument] = this.vlocity.commandLineOptionsOverride[argument];
            }
        }
        
        action = jobInfo.jobAction;
    }

    jobInfo.jobAction = action;
    jobInfo.startTime = jobInfo.startTime || VlocityUtils.startTime;
    jobInfo.originalAction = jobInfo.originalAction || action;
    
    jobInfo.logName = jobInfo.logName || this.vlocity.datapacksexpand.generateFolderOrFilename(jobInfo.jobName + '-' + new Date(Date.now()).toISOString() + '-' + jobInfo.jobAction, 'yaml');

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
    jobInfo.diffType = jobInfo.diffType || {};
    jobInfo.sObjectsInfo = jobInfo.sObjectsInfo || {};
    jobInfo.fullManifest = jobInfo.fullManifest || {};
    jobInfo.manifestFound = jobInfo.manifestFound || {};
    
    jobInfo.dataPackDisplayLabels = jobInfo.dataPackDisplayLabels || {};
    jobInfo.allDataSummary = jobInfo.allDataSummary || {};
    jobInfo.pendingFromManifest = jobInfo.pendingFromManifest || {};
    jobInfo.keysToDirectories = jobInfo.keysToDirectories || {};

    

    jobInfo.errorHandling = jobInfo.errorHandling || {};
    jobInfo.relationshipKeyToChildKeys = jobInfo.relationshipKeyToChildKeys || {};
    // Means that Continue or Retry will not work
    if (jobInfo.jobAction == 'Continue' || jobInfo.jobAction == 'Retry') {
        throw jobInfo.jobAction + ' initialization failed. Please use another Command';
    }

    if (jobInfo.manifest || jobInfo.workingSet || jobInfo.gitCheck) {
        await this.formatManifest(jobInfo);
    }
    
    if (!jobInfo.addedToExportBuildFile) {
        jobInfo.addedToExportBuildFile = [];
        this.vlocity.datapacksexportbuildfile.resetExportBuildFile(jobInfo);
    }

    jobInfo.supportParallel = jobInfo.defaultMaxParallel > 1;
};

DataPacksJob.prototype.runJobWithInfo = async function(jobInfo, action) {
    
    try {
        await this.intializeJobInfo(jobInfo, action);
        action = jobInfo.jobAction;

        if (!jobInfo.ranPreJobJavaScript && jobInfo.preJobJavaScript && jobInfo.preJobJavaScript[action]) {

            VlocityUtils.report('Running Pre Job JavaScript', jobInfo.preJobJavaScript[action]);
            
            jobInfo.ranPreJobJavaScript = true;

            await this.vlocity.datapacksutils.runJavaScript(jobInfo.projectPath, jobInfo.preJobJavaScript[action], null, jobInfo);
        }

        if (!jobInfo.ranPreJobApex && jobInfo.preJobApex && jobInfo.preJobApex[action]) {

            // Builds the JSON Array sent to Anon Apex that gets run before deploy
            // Issues when > 32000 chars. Need to add chunking for this. 
            if (action == 'Deploy') {
                this.vlocity.datapacksbuilder.initializeImportStatus(jobInfo.projectPath + '/' + jobInfo.expansionPath, jobInfo);
            }

            VlocityUtils.report('Running Pre Job Apex', jobInfo.preJobApex[action]);
            
            jobInfo.ranPreJobApex = true;

            await this.vlocity.datapacksutils.runApex(jobInfo.projectPath, jobInfo.preJobApex[action], jobInfo.preDeployDataSummary);
        }

        await this.doRunJob(jobInfo, action);
        
        if (jobInfo.postJobApex && jobInfo.postJobApex[action]) {

            VlocityUtils.report('Running Post Job Apex', jobInfo.postJobApex[action]);
            await this.vlocity.datapacksutils.runApex(jobInfo.projectPath, jobInfo.postJobApex[action], jobInfo.postDeployResults);
        }

        if (jobInfo.postJobJavaScript && jobInfo.postJobJavaScript[action]) {

            VlocityUtils.report('Running Post Job JavaScript', jobInfo.postJobJavaScript[action]);
            
            await this.vlocity.datapacksutils.runJavaScript(jobInfo.projectPath, jobInfo.postJobJavaScript[action], null, jobInfo);
        }

        this.vlocity.datapacksutils.printJobStatus(jobInfo);

        return await this.formatResponse(jobInfo);
    } catch (err) {
        VlocityUtils.error('Uncaught Job Error', err);
        return await this.formatResponse(jobInfo, err);
    }
};

DataPacksJob.prototype.doRunJob = async function(jobInfo, action) {
    VlocityUtils.verbose('Running Job', action);
    
    if (action == 'DiffPacks') {
        await this.diffPacks(jobInfo);
    } else if (action == 'Export') {
        await this.exportJob(jobInfo);
    } else if (action == 'Import') {
        await this.importJob(jobInfo);
    } else if (action == 'Deploy') {
        await this.deployJob(jobInfo);
    } else if (action == 'BuildFile') {
        await this.buildFile(jobInfo);
    } else if (action == 'ExpandFile') {
        await this.expandFile(jobInfo);
    } else if (action == 'GetDiffs' || action == 'GetDiffsCheck') {
        await this.getDiffs(jobInfo);
    } else if (action == 'GetDiffsAndDeploy') {
        await this.getDiffsAndDeploy(jobInfo);
    } else if (action == 'GetAllAvailableExports') {
        await this.getAllAvailableExports(jobInfo);
    } else if (action == 'RefreshProject') {
        await this.refreshProject(jobInfo);
    } else if (action == 'JavaScript') {
        await this.reExpandAllFilesAndRunJavaScript(jobInfo);
    } else if (action == 'Apex') {
        await this.runApex(jobInfo);
    } else if (action == 'RefreshVlocityBase') {
        await this.refreshVlocityBase(jobInfo);
    } else if (action == 'UpdateSettings') {
        await this.updateSettings(jobInfo);
    } else if (action == 'CleanOrgData') {
        await this.cleanOrgData(jobInfo);
    } else if (action == 'ValidateLocalData') {
        await this.validateLocalData(jobInfo);
    } else if (action == 'RunValidationTest') {
        await this.runValidationTest(jobInfo);
    } else if (action == 'RunDeltaCheck') {
        await this.runDeltaCheck(jobInfo);
    } else if (action == 'BuildManifest') {
        await this.buildManifest(jobInfo);
    } else {
        jobInfo.hasError = true;
        jobInfo.errors.push('Command not found: ' + action);
        VlocityUtils.error('Command not found: ' + action);
    }
};

DataPacksJob.prototype.formatResponse = async function(jobInfo, error) {
    
    try {

        VlocityUtils.verbose('Formatting Response', jobInfo.jobAction);

        if (error) {
            if (!jobInfo.errors) {
                jobInfo.errors = [];
            }

            jobInfo.hasError = true;
            jobInfo.errors.push(error.stack || error.message || (typeof error === "object" ? stringify(error) : error));
        }

        var response = {};

        response.action = jobInfo.originalAction || jobInfo.jobAction;

        var dataPacksMap = {};

        var allManifestByKey = {};

        for (var dataPackType in (jobInfo.fullManifest || {})) {
            for (var dataPackKey in jobInfo.fullManifest[dataPackType]) {
                allManifestByKey[dataPackKey] = JSON.parse(stringify(jobInfo.fullManifest[dataPackType][dataPackKey]));

                allManifestByKey[dataPackKey].VlocityDataPackKey = dataPackType + '/' + this.vlocity.datapacksexpand.getDataPackFolder(dataPackType, allManifestByKey[dataPackKey].VlocityRecordSObjectType, allManifestByKey[dataPackKey]);  
                if (allManifestByKey[dataPackKey].VlocityDataPackKeyForManifest) {
                    delete allManifestByKey[dataPackKey].VlocityDataPackKeyForManifest;
                }
            }
        }

        if (jobInfo.jobAction == 'GetAllAvailableExports') {
            var manifestArray = [];
            for (var key in allManifestByKey) {
                VlocityUtils.log('- ' + allManifestByKey[key].VlocityDataPackKey + ' # ' + allManifestByKey[key].VlocityDataPackDisplayLabel);
                manifestArray.push(allManifestByKey[key].VlocityDataPackKey);
            }

            try {
                fs.outputFileSync('VlocityBuildLog.yaml', yaml.dump({ manifest: manifestArray }, { lineWidth: 1000 }));
            } catch (e) {
                VlocityUtils.error(e);
            }

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
            response.message = jobInfo.hasError ? jobInfo.errors.join('\n').replace(/%vlocity_namespace%/g, this.vlocity.namespace) : 'Complete';
        } else if (jobInfo.jobAction == 'BuildFile') {
            response.status = jobInfo.hasError ? 'error' : 'success';
            response.message = jobInfo.hasError ? jobInfo.errors.join('\n').replace(/%vlocity_namespace%/g, this.vlocity.namespace) : `File ${jobInfo.buildFile}`;

            response.records = [];

            if (jobInfo.data) {
                response.records = [ jobInfo.data ];
            }
        } else {

            for (var key in jobInfo.currentStatus) {
                
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
                
                if (!dataPack.DiffType && jobInfo.diffType[dataPack.VlocityDataPackKey]) {
                    dataPack.DiffType = jobInfo.diffType[dataPack.VlocityDataPackKey];
                    dataPack.Diffs = dataPack.DiffType != 'Unchanged';
                }

                if (dataPack.DiffType == 'Unchanged') {
                    continue;
                }

                if (jobInfo.sObjectsInfo[dataPack.VlocityDataPackKey]) {
                    dataPack.SObjects = jobInfo.sObjectsInfo[dataPack.VlocityDataPackKey];
                }

                if (!dataPack.Id && dataPack.VlocityRecordSourceKey && jobInfo.sourceKeyToRecordId[dataPack.VlocityRecordSourceKey]) {
                    dataPack.Id = jobInfo.sourceKeyToRecordId[dataPack.VlocityRecordSourceKey];
                }

                if (!dataPack.VlocityDataPackDisplayLabel && jobInfo.dataPackDisplayLabels[key]) {
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

                if (jobInfo.testResults && jobInfo.testResults[dataPack.VlocityDataPackKey]) {
                    dataPack.testResults = jobInfo.testResults[dataPack.VlocityDataPackKey];
                }

                if (jobInfo.testStatus && jobInfo.testStatus[dataPack.VlocityDataPackKey]) {
                    dataPack.VlocityDataPackStatus = jobInfo.testStatus[dataPack.VlocityDataPackKey];
                }

                if (jobInfo.deltaCheckResults) {
                    if (jobInfo.deltaCheckResults[dataPack.VlocityDataPackKey]) {
                        dataPack.VlocityDataPackStatus = jobInfo.deltaCheckResults[dataPack.VlocityDataPackKey].status;
                        dataPack.records = jobInfo.deltaCheckResults[dataPack.VlocityDataPackKey].records;
                    } else {
                        dataPack.VlocityDataPackStatus = 'Unknown';
                    } 

                    if (dataPack.VlocityDataPackStatus != 'Unchanged') {
                        VlocityUtils.log(dataPack.VlocityDataPackStatus, dataPack.VlocityDataPackKey);
                    }
                }

                dataPacksMap[dataPack.VlocityDataPackKey] = dataPack;
            }

            response.records = Object.values(dataPacksMap);
        
            if (jobInfo.data) {
                response.data = jobInfo.data;
            }

            if (jobInfo.hasError) {
                response.status = 'error'; 
                response.message = jobInfo.errors.join('\n');
            } else {
                response.status = 'success'; 
                response.message = '';

                if (jobInfo.report.length > 0) {
                    response.message += jobInfo.report.join('\n') + '\n';
                }  
                
                if (response.records) {
                    response.message += response.records.length + ' Completed';
                } 
                
                if (!response.message) {
                    response.message = 'Complete';
                }
            }

            if (response.message) {
                response.message = response.message.replace(/%vlocity_namespace%/g, this.vlocity.namespace);
            }
        }

        jobInfo.records = response.records;

        this.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo);

        return response;
    } catch (e) {
        return e;
    }    
};

DataPacksJob.prototype.formatManifest = async function(jobInfo) {
    
    VlocityUtils.verbose('Formatting Manifest');

    if (jobInfo.workingSet) {

        var projectWorkingSetFile = path.join(jobInfo.projectPath,this.vlocity.tempFolder, jobInfo.workingSet + '.workingSet.yaml');
        var tempDirWorkingSetFile = path.join(this.vlocity.tempFolder, jobInfo.workingSet + '.workingSet.yaml');

        var workSetData;
        
        if (this.vlocity.datapacksutils.fileExists(projectWorkingSetFile)) {
            workSetData = yaml.safeLoad(fs.readFileSync(projectWorkingSetFile), 'utf8');
        } else if (this.vlocity.datapacksutils.fileExists(tempDirWorkingSetFile)) {
            workSetData = jobInfo.manifest = yaml.safeLoad(fs.readFileSync(tempDirWorkingSetFile), 'utf8');
        } else {
            throw new Error(`Working Set Not Found: ${jobInfo.workingSet}`);
        }

        jobInfo.manifest = workSetData.VlocityDataPackKeys;
    }

    if (jobInfo.gitCheck) {
        jobInfo.specificManifestKeys = await this.vlocity.utilityservice.getGitDiffsFromOrgToLocal(jobInfo);
    } else if (Array.isArray(jobInfo.manifest)) {
        jobInfo.specificManifestKeys = [];

        // Assumes these are a List of VlocityDataPackKeys or Ids
        if (typeof jobInfo.manifest[0] === 'string') {
            jobInfo.specificManifestKeys = jobInfo.manifest;
        } else {

            for (var item of jobInfo.manifest) {
                if (item.Id) {
                    jobInfo.specificManifestKeys.push(item.Id);
                } else if (item.VlocityDataPackKey) {
                    jobInfo.specificManifestKeys.push(item.VlocityDataPackKey);
                }
            }
        }

        if (!jobInfo.queries) {
            jobInfo.queries = [];
        }

        jobInfo.queries = jobInfo.queries.concat(Object.values(this.queryDefinitions));
    } else {

        jobInfo.specificManifestObjects = {};

        for (var dataPackType in jobInfo.manifest) {
            for (var data of jobInfo.manifest[dataPackType]) {
                if (!jobInfo.specificManifestObjects[dataPackType]) {
                    jobInfo.specificManifestObjects[dataPackType] = [];
                }

                jobInfo.specificManifestObjects[dataPackType].push(data);
            }
        }

        jobInfo.queries = null;
    }
};

DataPacksJob.prototype.runQueryForManifest = async function(queryInput) {
    
    var queryData = queryInput.queryData; 
    var jobInfo = queryInput.jobInfo;

    if (!queryData || !queryData.VlocityDataPackType || !queryData.query) {
        return;
    }

    if (!jobInfo.fullManifest[queryData.VlocityDataPackType]) {
        jobInfo.fullManifest[queryData.VlocityDataPackType] = {};
    }

    var query = queryData.query.replace(/%vlocity_namespace%/g, this.vlocity.namespace);
    try {
        var thisQuery = await this.vlocity.jsForceConnection.query(query)
        .on("record", (record) => {

            record = JSON.parse(stringify(record).replace(new RegExp(this.vlocity.namespace, 'g'), '%vlocity_namespace%'));

            record.VlocityDataPackType = queryData.VlocityDataPackType;
            record.VlocityRecordSObjectType = record.attributes.type;

            this.vlocity.datapacksutils.updateRecordReferences(record);

            record.VlocityDataPackKeyForManifest = queryData.VlocityDataPackType + '/' + this.vlocity.datapacksexpand.getDataPackFolder(queryData.VlocityDataPackType, record.VlocityRecordSObjectType, record);
            
            if (jobInfo.fullManifest[queryData.VlocityDataPackType][record.Id] || 
                (jobInfo.specificManifestKeys 
                && jobInfo.specificManifestKeys.indexOf(queryData.VlocityDataPackType) == -1 
                && jobInfo.specificManifestKeys.indexOf(record.VlocityDataPackKeyForManifest) == -1 
                && jobInfo.specificManifestKeys.indexOf(record.Id) == -1 
                && jobInfo.specificManifestKeys.indexOf(this.vlocity.datapacksexpand.sanitizeDataPackKey(record.VlocityDataPackKeyForManifest)) == -1 
                && jobInfo.specificManifestKeys.indexOf(`${queryData.VlocityDataPackType}/${record.Id}`) == -1 
                && jobInfo.specificManifestKeys.indexOf(`${queryData.VlocityDataPackType}/${record.Id.substring(0,15)}`) == -1)) {
                return;
            }

            jobInfo.fullManifest[queryData.VlocityDataPackType][record.Id] = record;
            
            record.VlocityDataPackDisplayLabel = this.vlocity.datapacksutils.getDisplayName(record);

            VlocityUtils.verbose('Found From Manifest', record.VlocityDataPackType, record.VlocityDataPackDisplayLabel);
        })
        .on("end", () => {
            VlocityUtils.report('VlocityDataPackType', queryData.VlocityDataPackType);
            VlocityUtils.report('Query', query);
            VlocityUtils.report('Records', Object.keys(jobInfo.fullManifest[queryData.VlocityDataPackType]).length);
        })
        .run({ autoFetch : true, maxFetch : 10000 });
    } catch (e) {
        // Likely can Just ignore
        VlocityUtils.report('VlocityDataPackType', queryData.VlocityDataPackType);
        VlocityUtils.report('Query', query);
        VlocityUtils.error('Query Error', e);
    }
}

DataPacksJob.prototype.buildManifestFromQueries = async function(jobInfo) {

    if (!jobInfo.fullManifest) {
        jobInfo.fullManifest = {};
    }

    if (!jobInfo.manifest && !jobInfo.queries) {
        VlocityUtils.error('Error', 'No Export Data Specified');
        return;
    }

    if (jobInfo.queries) {
        jobInfo.specificManifestObjects = null;

        if (jobInfo.skipQueries) {
            return;
        }

        VlocityUtils.silence = !!jobInfo.specificManifestKeys;

        if (jobInfo.specificManifestKeys) {
            VlocityUtils.silence = true;

            if (jobInfo.specificManifestKeys.length == 0) {
                jobInfo.queries = [];
            } else {
                var allTypesForQuery = new Set();

                for (var key of jobInfo.specificManifestKeys) {

                    if (key.indexOf('/') != -1) {
                        allTypesForQuery.add(key.substr(0, key.indexOf('/')));
                    } else {
                        allTypesForQuery.add(key);
                    }
                }

                var validQueries = [];

                for (var query of jobInfo.queries) {
                    if (allTypesForQuery.has(query.VlocityDataPackType)) {
                        validQueries.push(query);
                    }
                }

                jobInfo.queries = validQueries;
            }
        }

        try {

            var allQueries = [];

            for (var queryData of jobInfo.queries) {
  
                if (!jobInfo.specificManifestKeys && queryData.manifestOnly) {
                    continue;
                }

                allQueries.push( { context: this, func: 'runQueryForManifest', argument: { jobInfo: jobInfo, queryData: queryData } });
            }

            await this.vlocity.utilityservice.parallelLimit(allQueries, 100);
        } catch (e) {
            throw e;
        }
    }
};

DataPacksJob.prototype.runValidationTest = async function(jobInfo) {

    var fullDataPath = jobInfo.projectPath;

    jobInfo.singleFile = true;
    jobInfo.disablePagination = true;
    jobInfo.fullStatus = true;

    VlocityUtils.verbose('Getting DataPacks', fullDataPath, jobInfo.manifest, jobInfo);

    let dataJson = await this.vlocity.datapacksbuilder.buildImport(fullDataPath, jobInfo);

    if (dataJson && dataJson.dataPacks) {
        await this.vlocity.validationtest.validate(jobInfo, dataJson.dataPacks);
    }
};

DataPacksJob.prototype.runDeltaCheck = async function(jobInfo) {
    
    var fullDataPath = jobInfo.projectPath;

    jobInfo.singleFile = true;
    jobInfo.disablePagination = true;
    jobInfo.fullStatus = true;

    VlocityUtils.verbose('Getting DataPacks', fullDataPath, jobInfo.manifest, jobInfo);

    VlocityUtils.silence = true;
    
    let dataJson = await this.vlocity.datapacksbuilder.buildImport(fullDataPath, jobInfo);
    
    VlocityUtils.silence = false;

    if (dataJson && dataJson.dataPacks) {
        jobInfo.deltaInfo = await this.vlocity.deltacheck.runDeltaCheck(jobInfo, dataJson.dataPacks);
    }
};

DataPacksJob.prototype.exportJob = async function(jobInfo) {
    
    if (jobInfo.autoUpdateSettings) {
        await this.updateSettings(JSON.parse(JSON.stringify(jobInfo)));
    }

    await this.buildManifestFromQueries(jobInfo);

    if (jobInfo.deltaCheck) {
        VlocityUtils.report(`Checking for Changes Before Export`);
        var deltaCheckJobInfo = JSON.parse(JSON.stringify(jobInfo));

        await this.runDeltaCheck(deltaCheckJobInfo);

        for (var dataPackType in jobInfo.fullManifest) {
            for (var fullManifestId in jobInfo.fullManifest[dataPackType]) {

                var exData = jobInfo.fullManifest[dataPackType][fullManifestId];
                
                if (deltaCheckJobInfo.deltaCheckResults[exData.VlocityDataPackKeyForManifest] 
                    && deltaCheckJobInfo.deltaCheckResults[exData.VlocityDataPackKeyForManifest].status == 'Unchanged') {
                   
                    if (!jobInfo.alreadyExportedIdsByType[dataPackType]) {
                        jobInfo.alreadyExportedIdsByType[dataPackType] = [];
                    }

                    jobInfo.alreadyExportedIdsByType[dataPackType].push(fullManifestId);
                    jobInfo.currentStatus[exData.VlocityDataPackKeyForManifest] = 'Success';
                }    
            }
        }

        jobInfo.resetFileData = true;
    }

    await this.exportFromManifest(jobInfo);
};

DataPacksJob.prototype.getAllAvailableExports = async function(jobInfo) {
    
    VlocityUtils.report('Retrieving VlocityDataPackKeys');

    await this.buildManifestFromQueries(jobInfo);   
};

DataPacksJob.prototype.setToUnknownExportError = function(jobInfo, pack) {
    
    var packKey = pack.VlocityDataPackType + '/' + this.vlocity.datapacksexpand.getDataPackFolder(pack.VlocityDataPackType, pack.VlocityRecordSObjectType, pack);

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
        jobInfo.errors.push('Unknown Error >> ' + packKey + ' (' + pack.Id + ') --- Data Not Retrieved - Use --verbose to see more information');
    }
};

DataPacksJob.prototype.exportFromManifest = async function(jobInfo) {
    
    do {    
        await this.setupExportGroups(jobInfo);

        try {

            var exportGroupPromises = [];

            for (var group of jobInfo.toExportGroups) {
                exportGroupPromises.push({ context: this, func: 'exportGroup', argument: { group: group, jobInfo: jobInfo }});
            }

            await this.vlocity.utilityservice.parallelLimit(exportGroupPromises, jobInfo.defaultMaxParallel);
        } catch (e) {
            jobInfo.hasError = true;
            if (Array.isArray(e)) {
                for (var eItem of e) {
                    VlocityUtils.error('Uncaught Error', `Export - ${eItem.stack || eItem}`);
                    jobInfo.errors.push(`Uncaught Error >> Export - ${eItem.stack || eItem}`); 
                }
            } else {
                VlocityUtils.error('Uncaught Error', `Export - ${e.stack || e}`);
                jobInfo.errors.push(`Uncaught Error >> Export - ${e.stack || e}`); 
            }
            
        }

        // This also calculates jobInfo.exportRemaining
        this.vlocity.datapacksutils.printJobStatus(jobInfo);
   
    } while (jobInfo.exportRemaining > 0) 

    this.vlocity.datapacksexportbuildfile.saveFile();
    
    if (this.vlocity.datapacksexportbuildfile.currentExportFileData) {
        var savedFormat = [];

        for (var dataPackId in this.vlocity.datapacksexportbuildfile.currentExportFileData) {
            savedFormat.push(this.vlocity.datapacksexportbuildfile.currentExportFileData[dataPackId]);
        }

        var dataPacksToExpand = JSON.parse(stringify({ dataPacks: savedFormat }));

        this.vlocity.datapacksexpand.expand(jobInfo.projectPath + '/' + jobInfo.expansionPath, dataPacksToExpand, jobInfo);
    }
}

DataPacksJob.prototype.setupExportGroups = async function(jobInfo) {
    
    if (!jobInfo.initialized) {
        VlocityUtils.report('Initializing Project');
        await this.vlocity.datapacksutils.initializeFromProject(jobInfo);
        jobInfo.initialized = true;
        this.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo);
    }

    await this.vlocity.datapacksutils.getAllConfigurations();

    jobInfo.toExportGroups = [[]];

    if (jobInfo.specificManifestObjects) {
        
        for (var dataPackType in jobInfo.specificManifestObjects) {
            for (var key of jobInfo.specificManifestObjects[dataPackType]) {
                jobInfo.toExportGroups[0].push({ Id: key, VlocityDataPackType: dataPackType });
            }
        }

        if (jobInfo.manifestOnly) {
            jobInfo.maxDepth = 0;
        }

        jobInfo.specificManifestObjects = null;
    } else {
        var alreadyInGroup = [];
        var hasAny = false;
        var hasSObject = false;
        
        for (var dataPackType in jobInfo.fullManifest) {

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

            var maxForType = this.vlocity.datapacksutils.getExportGroupSizeForType(dataPackType);

            if (!maxForType) {
                maxForType = MAX_PER_GROUP;
            }

            for (var fullManifestId in jobInfo.fullManifest[dataPackType]) {

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
                            continue;
                        } else if (!hasSObject && dataPackType == 'SObject') {
                            continue;
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
                        continue;
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
                        maxForType = this.vlocity.datapacksutils.getChildrenLimitForType(dataPackType);;
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
            }
        }
    }
}

DataPacksJob.prototype.exportGroup = async function(inputMap) {
    
    var exportDataFromManifest = inputMap.group;
    var jobInfo = inputMap.jobInfo;
    
    var exportData = exportDataFromManifest.filter((dataPack) => {
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

        VlocityUtils.success('Exporting', dataPack.VlocityDataPackType, this.vlocity.datapacksutils.getDisplayName(dataPack));

        return true;
    });

    if (exportData.length != 0) {
        var originalKeys = JSON.parse(JSON.stringify(exportData));

        var jobOptions = this.getOptionsFromJobInfo(jobInfo);

        if (jobOptions.exportPacksMaxSize != -1) {
            jobOptions.exportPacksMaxSize = exportData.length;
        }     

        let result = await this.vlocity.datapacks.export(exportData[0].VlocityDataPackType, exportData, jobOptions);

        this.vlocity.datapacksexportbuildfile.saveFile();

        VlocityUtils.verbose('Export Finished', result.VlocityDataPackId, result.Status);

        jobInfo.VlocityDataPackIds[result.VlocityDataPackId] = result.Status;

        if (result.storageError) {
            jobInfo.hasError = true;
            
            if (jobInfo.errors.indexOf(result.message) == -1) {
                VlocityUtils.error('DataPack API Error', result);
                jobInfo.errors.push(result.message);
            }
            
            throw result;
        } 

        if (!result.VlocityDataPackId) {
             
            if (result instanceof Error) {
                VlocityUtils.error('DataPack API Error', result.stack);
                jobInfo.errors.push(result.stack);
            } else {
                VlocityUtils.error('DataPack API Error', result);
            }
                
            jobInfo.hasError = true;
            
            for (var pack of originalKeys) {
                if (pack.Id && !pack.VlocityDataPackKey) {
                    this.setToUnknownExportError(jobInfo, pack);
                } else if (pack.VlocityDataPackRelationshipType == "Children") {
                    jobInfo.currentStatus[pack.VlocityDataPackKey + '/Children'] = 'Error';
                }
            }

            return;
        }

        let dataPackData = await this.vlocity.datapacks.getDataPackData(result.VlocityDataPackId);
    
        var processedKeys = {};

        for (var dataPack of dataPackData.dataPacks) {
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

                continue;
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

                    var dataField = this.vlocity.datapacksutils.getDataField(dataPack);

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

                    if (this.vlocity.datapacksutils.isUniqueByName(dataPack.VlocityDataPackType) 
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
                        continue;
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
                        
                        jobInfo.currentErrors[dataPack.VlocityDataPackKey] = errorMessage;
                        jobInfo.errorHandling[dataPack.VlocityDataPackKey] = {};
                        jobInfo.errorHandling[dataPack.VlocityDataPackKey].dataPack = dataPack;
                        jobInfo.errorHandling[dataPack.VlocityDataPackKey].errorMessage = errorMessage;
                        jobInfo.errorHandling[dataPack.VlocityDataPackKey].processed = false;

                        if (!jobInfo.relationshipKeyToChildKeys[dataPack.VlocityDataPackKey]) {
                            jobInfo.relationshipKeyToChildKeys[dataPack.VlocityDataPackKey] = [];
                        }

                        var dataPackRelationshipsKey;

                        for (var key in dataPack.VlocityDataPackAllRelationships) {
                            dataPackRelationshipsKey = key;
                            break;
                        }

                        if (dataPackRelationshipsKey
                        && !jobInfo.relationshipKeyToChildKeys[dataPack.VlocityDataPackKey].includes(dataPack.VlocityDataPackAllRelationships[0])) {
                            jobInfo.relationshipKeyToChildKeys[dataPack.VlocityDataPackKey].push(dataPackRelationshipsKey);
                        }
                    }
                }
            } 
        }

        for (var pack of originalKeys) {
            var packKey = pack.VlocityDataPackKey;

            if (!packKey) {
                packKey = pack.VlocityDataPackType + '/' + this.vlocity.datapacksexpand.getDataPackFolder(pack.VlocityDataPackType, pack.VlocityRecordSObjectType, pack);
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
                    this.setToUnknownExportError(jobInfo, pack);
                }
            } else if (pack.VlocityDataPackRelationshipType == 'Children' && jobInfo.currentStatus[pack.VlocityDataPackKey] != 'Success') {
                jobInfo.currentStatus[pack.VlocityDataPackKey] = 'Ignored';
            }
        }

        this.vlocity.datapacksexportbuildfile.addToExportBuildFile(jobInfo, JSON.parse(stringify(dataPackData, { space: 4 })));

        

        if (jobInfo.expansionPath) {
            this.vlocity.datapacksexpand.expand(jobInfo.projectPath + '/' + jobInfo.expansionPath, dataPackData, jobInfo);
            
            await this.vlocity.datapackserrorhandling.getSanitizedErrorMessage(jobInfo, dataPackData);
        }

        if (jobInfo.delete) {
            await this.vlocity.datapacks.delete(result.VlocityDataPackId, this.getOptionsFromJobInfo(jobInfo));
        }
    }

    this.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo);
    this.vlocity.datapacksutils.printJobStatus(jobInfo);
}

DataPacksJob.prototype.importJob = async function(jobInfo) {
    
    var dataJson = fs.readFileSync(jobInfo.buildFile, 'utf8');
    
    let result = this.vlocity.datapacks.import(JSON.parse(dataJson), this.getOptionsFromJobInfo(jobInfo));

    jobInfo.VlocityDataPackId = result.VlocityDataPackId;

    if (jobInfo.activate) {
        await this.vlocity.datapacks.activate(jobInfo.VlocityDataPackId, ['ALL'], this.getOptionsFromJobInfo(jobInfo));
    }
};

DataPacksJob.prototype.buildFile = async function(jobInfo) {
   
    var fullDataPath = jobInfo.projectPath;

    jobInfo.singleFile = true;

    if (jobInfo.buildFile) {

        let dataJson = await this.vlocity.datapacksbuilder.buildImport(fullDataPath, jobInfo);
        
        if (dataJson && jobInfo.dataPackName) {
            dataJson.name = jobInfo.dataPackName;
        }

        if (dataJson) {

            jobInfo.data = JSON.parse(stringify(dataJson));

            var fileName = jobInfo.buildFile;

            fs.outputFileSync(fileName, stringify(dataJson, { space: 4 }), 'utf8');

            if (fileName.indexOf('.resource') > 0) {
                // also create .resource-meta.xml
                fs.outputFileSync(fileName + '-meta.xml', '<?xml version="1.0" encoding="UTF-8"?><StaticResource xmlns="http://soap.sforce.com/2006/04/metadata"><cacheControl>Public</cacheControl><contentType>text/json</contentType></StaticResource>',
                    'utf8');
            }
            
            VlocityUtils.error('Creating File', jobInfo.buildFile);
        }
    }
};

DataPacksJob.prototype.expandFile = function(jobInfo) {
    
    this.vlocity.datapacksexpand.expandFile(jobInfo.projectPath + '/' + jobInfo.expansionPath, jobInfo.buildFile, jobInfo);
};

DataPacksJob.prototype.updateSettings = async function(jobInfo) {
    var projectPathsToDeploy = [ 'latest' ];

    if (this.vlocity.BuildToolSettingVersion != 'latest') {

        var vers = this.vlocity.BuildToolSettingLatestVersion - 1;
        while (vers >= this.vlocity.BuildToolSettingVersion) {
            projectPathsToDeploy.push(path.join(__dirname, '..', 'DataPackSettings', 'v' + vers));
            vers--;
        }
    }

    var tempJobInfo = {
        projectPath: path.join(__dirname, '..', 'DataPackSettings/latest'),
        delete: true,
        defaultMaxParallel: 10,
        resetFileData: true,
        jobAction: 'Deploy',
        singleFile: true
    };

    VlocityUtils.silence = true;

    await this.intializeJobInfo(tempJobInfo, 'BuildFile');

    let dataJson = await this.vlocity.datapacksbuilder.buildImport(tempJobInfo.projectPath, tempJobInfo);
    VlocityUtils.silence = false;

    let hashCode = this.vlocity.datapacksutils.hashCode(stringify(dataJson));
    var query = `Select ${this.vlocity.namespace}__MapId__c from ${this.vlocity.namespace}__DRMapItem__c where ${this.vlocity.namespace}__MapId__c = '${hashCode}'`;
    
    VlocityUtils.verbose('Get Existing Setting', query);

    let result = await this.vlocity.jsForceConnection.query(query);

    if (jobInfo.force || result.records.length == 0) {
       
        await this.vlocity.datapacksutils.runApex('.', 'ResetDataPackMappings.cls');

        for (var pathToDeploy of projectPathsToDeploy) {
        
            var nextJob = {
                projectPath: path.join(__dirname, '..', 'DataPackSettings', pathToDeploy),
                delete: true,
                defaultMaxParallel: 10,
                resetFileData: true,
                jobAction: 'Deploy'
            };
            
            let result = await this.runJobWithInfo(nextJob, 'Deploy');
        
            if (result.status == 'error') {
                VlocityUtils.error('Error Updating Settings');
            }
        }

        var settingsRecord = {};
        settingsRecord.Name = 'DataRaptor Migration';
        settingsRecord[`${this.vlocity.namespace}__DomainObjectAPIName__c`] = 'JSON';
        settingsRecord[`${this.vlocity.namespace}__DomainObjectFieldAPIName__c`] = 'JSON';
        settingsRecord[`${this.vlocity.namespace}__InterfaceFieldAPIName__c`] = 'JSON';
        settingsRecord[`${this.vlocity.namespace}__DomainObjectCreationOrder__c`] = '0';
        settingsRecord[`${this.vlocity.namespace}__MapId__c`] = `${hashCode}`;
        settingsRecord[`${this.vlocity.namespace}__IsDisabled__c`] = true;
        
        let settingsRecordResult = await this.vlocity.jsForceConnection.sobject(`${this.vlocity.namespace}__DRMapItem__c`).upsert([settingsRecord],`${this.vlocity.namespace}__MapId__c`, { allOrNone: true });

        VlocityUtils.verbose(settingsRecordResult);
    } else {
        VlocityUtils.success('Settings Already Current. Use --force if you want to update again');
    }
};

DataPacksJob.prototype.refreshVlocityBase = async function(jobInfo) {
    let result = await this.vlocity.jsForceConnection.query("Select Name, Body from StaticResource where Name LIKE 'DP_CARDS%' OR Name LIKE 'DP_TEMPLATES%'");
    
    for (var record of result.records) {

        var res = await this.vlocity.jsForceConnection.request(record.Body);
        
        this.vlocity.datapacksutils.printJobStatus(jobInfo);

        VlocityUtils.report('Beginning Deployment', record.Name);

        let result = await this.vlocity.datapacks.import(JSON.parse(res), this.getOptionsFromJobInfo(jobInfo));
        
        let dataPackData = await this.vlocity.datapacks.getDataPackData(result.VlocityDataPackId);
        
        if (dataPackData.status == 'Complete') {

            VlocityUtils.success('Resource Deployed', record.Name);

            for (var dataPack of dataPackData.dataPacks) {
                VlocityUtils.success('Deploy Success', dataPack.VlocityDataPackType, '-', dataPack.VlocityDataPackKey, '-', dataPack.VlocityDataPackName);
            }

            let activateResult = await this.vlocity.datapacks.activate(result.VlocityDataPackId, ['ALL'], this.getOptionsFromJobInfo(jobInfo));

            VlocityUtils.success(`Resource Activated ${ activateResult.Status}`, record.Name);
                    
            this.vlocity.datapacksutils.printJobStatus(jobInfo);

            jobInfo.refreshVlocityBase.push({ Name: record.Name, Status: activateResult.Status });
        }
    }
};

DataPacksJob.prototype.installVlocityInitial = async function(jobInfo) {
    
    let result = await this.vlocity.jsForceConnection.query("Select Name, Body from StaticResource where Name LIKE 'DP_%'");
    
    for (var record of result.records) {

        var res = await this.vlocity.jsForceConnection.request(record.Body);
        
        this.vlocity.datapacksutils.printJobStatus(jobInfo);

        VlocityUtils.report('Beginning Deployment', record.Name);

        let result = await this.vlocity.datapacks.import(JSON.parse(res), this.getOptionsFromJobInfo(jobInfo));
        
        let dataPackData = await this.vlocity.datapacks.getDataPackData(result.VlocityDataPackId);
        
        if (dataPackData.status == 'Complete') {

            VlocityUtils.success('Resource Deployed', record.Name);

            for (var dataPack of dataPackData.dataPacks) {
                VlocityUtils.success('Deploy Success', dataPack.VlocityDataPackType, '-', dataPack.VlocityDataPackKey, '-', dataPack.VlocityDataPackName);
            }

            let activateResult = await this.vlocity.datapacks.activate(result.VlocityDataPackId, ['ALL'], this.getOptionsFromJobInfo(jobInfo));

            VlocityUtils.success(`Resource Activated ${ activateResult.Status}`, record.Name);
                    
            this.vlocity.datapacksutils.printJobStatus(jobInfo);

            jobInfo.refreshVlocityBase.push({ Name: record.Name, Status: activateResult.Status });
        }
    }
};

DataPacksJob.prototype.runStepJavaScript = async function(projectPath, stepSettings, dataPackData, jobInfo) {
    
    if (!stepSettings) {
        return;
    }

    for (var dataPack of dataPackData.dataPacks) {
        if (stepSettings[dataPack.VlocityDataPackType]) {
            await this.vlocity.datapacksutils.runJavaScript(projectPath, stepSettings[dataPack.VlocityDataPackType], dataPack, jobInfo);
        }
    }
};

DataPacksJob.prototype.runStepApex = async function(projectPath, stepSettings, apexData) {
    
    if (!stepSettings) {
        return;
    }

    var runApexByType = {};

    for (var dataPack of apexData) {
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
    }

    for (var apexClassName in runApexByType) {
        await this.vlocity.datapacksutils.runApex(projectPath, runApexByType[apexClassName].apexClass, runApexByType[apexClassName].apexData);
    }
};

DataPacksJob.prototype.activateAll = async function(dataPack, jobInfo, attempts) {
    
    if (!attempts) {
        attempts = 0;
    }

    let activateResult = await this.vlocity.datapacks.activate(dataPack.dataPackId, ['ALL'], this.getOptionsFromJobInfo(jobInfo));

    let dataPackData = await this.vlocity.datapacks.getDataPackData(dataPack.dataPackId);

    var shouldRetry = false;

    for (var dataPack of dataPackData.dataPacks) {

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
    }

    if (shouldRetry) {
        await this.vlocity.datapacks.ignoreActivationErrors(dataPackData.dataPackId);
        await this.activateAll(dataPackData, jobInfo, attempts+1);      
    }
};

DataPacksJob.prototype.checkDeployInProgress = function(jobInfo) {
    var notDeployed = [];
    var headers = [];   

    this.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo);

    for (var dataPackKey in jobInfo.currentStatus) {
        // Trying to account for failures on other objects
        if (jobInfo.currentStatus[dataPackKey] == 'Added') {
            jobInfo.currentStatus[dataPackKey] = 'ReadySeparate';
        }
   
        if (jobInfo.currentStatus[dataPackKey] == 'Ready' || jobInfo.currentStatus[dataPackKey] == 'ReadySeparate') {
            notDeployed.push('Not Deployed >> ' + dataPackKey);
        } else if (jobInfo.currentStatus[dataPackKey] == 'Header') {
            notDeployed.push('Not Deployed >> ' + dataPackKey);
            headers.push(dataPackKey);
        } else if (jobInfo.currentStatus[dataPackKey] == 'Added') {
            // This no longer does anything...
            jobInfo.errors.push('Not Deployed >> ' + dataPackKey);
            jobInfo.hasError = true;
        }
    }

    if (notDeployed.length > 0) {
        if (jobInfo.headersOnly) {
            if (headers.length > 0) {
                jobInfo.headersOnly = false;
                jobInfo.headersOnlyDidNotHelp = true;
            } else if (jobInfo.supportForceDeploy) {
                jobInfo.forceDeploy = true;
                jobInfo.headersOnly = false;
            } else {
                jobInfo.hasError = true;
                jobInfo.errors = jobInfo.errors.concat(notDeployed);
            }
        } else if (jobInfo.forceDeploy) {
            if (jobInfo.notDeployedCount == notDeployed.length) {
                if (!jobInfo.ignoreAllParents) {
                    jobInfo.ignoreAllParents = true;
                } else {
                    jobInfo.hasError = true;
                    jobInfo.errors = jobInfo.errors.concat(notDeployed);
                    return false;
                }
            }

            jobInfo.notDeployedCount = notDeployed.length;
        } else if (jobInfo.supportHeadersOnly || jobInfo.supportForceDeploy) {
            if (!jobInfo.supportHeadersOnly) {
                jobInfo.forceDeploy = true;
                jobInfo.headersOnly = false;
            } else if (jobInfo.headersOnlyDidNotHelp) {
                if (jobInfo.supportForceDeploy) {
                    jobInfo.forceDeploy = true;
                    jobInfo.headersOnly = false;
                } else {
                    jobInfo.hasError = true;
                    jobInfo.errors = jobInfo.errors.concat(notDeployed);
                }                       
            } else {
                jobInfo.headersOnly = true;
            }
        } else {
            jobInfo.hasError = true;
            jobInfo.errors = jobInfo.errors.concat(notDeployed);
            return false;
        }

        return true;
    }

    return false;
}

DataPacksJob.prototype.allThreadNotStalled = function(jobInfo) {

    for (var threadKey in jobInfo.deployThreadsStalled) {
        if (!jobInfo.deployThreadsStalled[threadKey]) {
            return true;
        }
    }

    return false;
}

DataPacksJob.prototype.deployPack = async function(inputMap) {
   
    var jobInfo = inputMap.jobInfo;

    if (!jobInfo.deployThreadsStalled) {
        jobInfo.deployThreadsStalled = {};
    }

    do {
       
        // Allow maximum concurrency during deploy by checking and keeping threads alive.
        var threadKey = Math.random();
    } while (jobInfo.deployThreadsStalled[threadKey])
    
    jobInfo.deployThreadsStalled[threadKey] = false;
    if (!jobInfo.primaryThreadKey) {
        jobInfo.primaryThreadKey = threadKey;
    }

    try {
        
        while (this.allThreadNotStalled(jobInfo)) {
            var dataJson = await this.vlocity.datapacksbuilder.buildImport(jobInfo.projectPath, jobInfo);
         
            if (dataJson == null) {
                jobInfo.deployThreadsStalled[threadKey] = true;
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            } else {
                jobInfo.deployThreadsStalled[threadKey] = false;
            }

            var preStepDeployData = [];

            for (var dataPack of dataJson.dataPacks) {
                var data = jobInfo.allDataSummary[dataPack.VlocityDataPackKey];

                if (data) {
                    data.VlocityDataPackType = dataPack.VlocityDataPackType;
                    preStepDeployData.push(data);
                }
            }

            var apexSettings;
            if (jobInfo.preStepApex && jobInfo.preStepApex.Deploy) {
                apexSettings = jobInfo.preStepApex.Deploy;
            }
        
            var javaScriptSettings;
            if (jobInfo.preStepJavaScript && jobInfo.preStepJavaScript.Deploy) {
                javaScriptSettings = jobInfo.preStepJavaScript.Deploy;
            }

            await this.runStepJavaScript(jobInfo.projectPath, javaScriptSettings, dataJson, jobInfo);

            await this.runStepApex(jobInfo.projectPath, apexSettings, preStepDeployData);

            var dataPackType = dataJson.dataPacks[0].VlocityDataPackType;

            while (this.runningParallel[dataPackType]) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            if (!this.vlocity.datapacksutils.isAllowParallel(dataPackType, dataJson.dataPacks[0])) {
                this.runningParallel[dataPackType] = true;
            }

            let result = await this.vlocity.datapacks.import(dataJson, this.getOptionsFromJobInfo(jobInfo));
            
            this.runningParallel[dataPackType] = false;
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Prevent endless deploy loops due to server side issues
            var thisDeployHasError = result.Status == 'Error';
            var atLeastOneRecordHasError = false;

            if (result.storageError) {
                jobInfo.hasError = true;
                
                if (jobInfo.errors.indexOf(result.message) == -1) {
                    VlocityUtils.error('DataPack API Error', result);
                    jobInfo.errors.push(result.message);
                }
                
                throw result;
            }

            if (result.VlocityDataPackId) {

                var dataPackId = result.VlocityDataPackId;
                var stepPostDeployResults = [];
                let dataPackData = await this.vlocity.datapacks.getDataPackData(dataPackId);

                for (var dataPack of dataPackData.dataPacks) {

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
                            var headersType = this.vlocity.datapacksutils.getHeadersOnly(dataPack.VlocityDataPackType);

                            if (headersType == "Identical") {
                                jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Success';
                            } else {
                                jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Header';
                            }
                        } else {
                            var sobjTypeList = this.vlocity.datapacksutils.getApexSObjectTypeList(dataPack.VlocityDataPackType);
                            
                            for (var record of dataPack.VlocityDataPackRecords) {
                            
                                if (record.VlocityRecordStatus == 'Success') {

                                    jobInfo.sourceKeyToRecordId[record.VlocityRecordSourceKey] =  record.VlocityRecordSalesforceId;
                                    jobInfo.postDeployResults.push({ Id: record.VlocityRecordSalesforceId });

                                    if (!sobjTypeList || sobjTypeList.indexOf(record.VlocityRecordSObjectType) != -1) {
                                        stepPostDeployResults.push({ Id: record.VlocityRecordSalesforceId, VlocityDataPackType: dataPack.VlocityDataPackType });
                                    }
                                }
                            }
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

                            jobInfo.errors.push(errorMessage);
                            jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Error';
                            jobInfo.currentErrors[dataPack.VlocityDataPackKey] = errorMessage;

                            jobInfo.errorHandling[dataPack.VlocityDataPackKey] = {};
                            jobInfo.errorHandling[dataPack.VlocityDataPackKey].dataPack = dataPack;
                            jobInfo.errorHandling[dataPack.VlocityDataPackKey].errorMessage = errorMessage;
                            jobInfo.errorHandling[dataPack.VlocityDataPackKey].processed = false;
                            
                            await this.vlocity.datapackserrorhandling.getSanitizedErrorMessage(jobInfo, dataPack);
                        }
                    }
                }

                if (dataPackData && dataPackData.dataPacks && thisDeployHasError && !atLeastOneRecordHasError) {

                    for (var dataPack of dataPackData.dataPacks) {
                        if (dataPack.VlocityDataPackStatus == 'Ready') {
                            jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'ReadySeparate';

                            VlocityUtils.error('Setting to Deploy Separate', dataPack.VlocityDataPackKey + ' --- ' + result.Message);
                        }
                    }          
                }

                if (jobInfo.activate) {
                    await this.activateAll(dataPackData, jobInfo);
                }

                if (jobInfo.delete) {
                    await this.vlocity.datapacks.delete(dataPackId, this.getOptionsFromJobInfo(jobInfo));
                } 
                                
                if (jobInfo.postStepApex && jobInfo.postStepApex.Deploy) {
                    await this.runStepApex(jobInfo.projectPath, jobInfo.postStepApex.Deploy, stepPostDeployResults);
                }
            }

            this.vlocity.datapacksutils.printJobStatus(jobInfo);

            this.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo);
        }
        
    } catch (e) {
        jobInfo.deployThreadsStalled[threadKey] = true;

        if (e.storageError) {
            throw e;
        }
    }
}

DataPacksJob.prototype.deployJob = async function(jobInfo) {
    if (jobInfo.autoUpdateSettings) {
        VlocityUtils.report('Automatically Updating Settings');
        await this.updateSettings(JSON.parse(JSON.stringify(jobInfo)));

        jobInfo.resetFileData = true;
    }

    if (jobInfo.deltaCheck) {
        VlocityUtils.report(`Checking for Changes Before Deploy`);
        var deltaCheckJobInfo = JSON.parse(JSON.stringify(jobInfo));
        await this.runDeltaCheck(deltaCheckJobInfo);

        if (deltaCheckJobInfo.deltaCheckResults) {
            for (var dataPackKey in deltaCheckJobInfo.deltaCheckResults) {
                if (deltaCheckJobInfo.deltaCheckResults[dataPackKey].status == 'Unchanged') {
                    jobInfo.currentStatus[dataPackKey] = 'Success';
                }
            }
        }

        jobInfo.resetFileData = true;
    }

    jobInfo.deployThreadsStalled = {};

    do {
        var deployPromises = [];
        var maxSeries = 1;
    
        if (jobInfo.supportParallel) {
            maxSeries = jobInfo.defaultMaxParallel;
        }

        for (var i = 0; i < maxSeries; i++) {

            deployPromises.push(
                { 
                    context: this, 
                    func: 'deployPack', 
                    argument: { jobInfo: jobInfo }
                });
        }
        await this.vlocity.utilityservice.parallelLimit(deployPromises);
    } while (this.checkDeployInProgress(jobInfo))

    if (jobInfo.gitCheck) {
        var currentHash = childProcess.execSync(`cd ${jobInfo.projectPath} && git rev-parse HEAD`, { encoding: 'utf8' });
        await this.vlocity.utilityservice.setVlocitySetting('VBTDeployKey', currentHash);
    }

    this.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo);        
};

DataPacksJob.prototype.checkDiffs = async function(jobInfo, currentLocalFileData, targetOrgRecordsHash) {
    
    var currentFiles = [];
    var exportedFiles = [];

    var totalUnchanged = 0;
    var totalDiffs = 0;
    var totalNew = 0;
    var totalUndiffable = 0;

    if (!currentLocalFileData) return;

    if (!currentLocalFileData.dataPacks) {
        currentLocalFileData.dataPacks = [];
    }

    for (var dataPack of currentLocalFileData.dataPacks) {
        var dataPackHash = this.vlocity.datapacksutils.getDataPackHashable(dataPack, jobInfo);
        
        if (!this.vlocity.datapacksutils.getIsDiffable(dataPack.VlocityDataPackType)) {
            jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Success';
            totalUndiffable++;
            jobInfo.diffType[dataPack.VlocityDataPackKey] = 'Undiffable';

            VlocityUtils.warn('Undiffable', dataPack.VlocityDataPackKey + ' - ' + dataPack.VlocityDataPackName);
        } else if (stringify(targetOrgRecordsHash[dataPack.VlocityDataPackKey]) == stringify(dataPackHash)) {
            jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Success';
            totalUnchanged++;
            jobInfo.diffType[dataPack.VlocityDataPackKey] = 'Unchanged';
            
            VlocityUtils.warn('Unchanged', dataPack.VlocityDataPackKey + ' - ' + dataPack.VlocityDataPackName);        
        } else {
            jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Ready';
            
            if (targetOrgRecordsHash[dataPack.VlocityDataPackKey]) {

                currentFiles.push(dataPackHash);
                exportedFiles.push(targetOrgRecordsHash[dataPack.VlocityDataPackKey]);

                VlocityUtils.warn('Changes Found', dataPack.VlocityDataPackKey + ' - ' + dataPack.VlocityDataPackName);
                jobInfo.diffType[dataPack.VlocityDataPackKey] = 'Changed';
                totalDiffs++;
            } else {

                VlocityUtils.warn('New', dataPack.VlocityDataPackType + ' - ' + dataPack.VlocityDataPackKey);
                jobInfo.diffType[dataPack.VlocityDataPackKey] = 'New';
                totalNew++;
            }
        }
    }

    VlocityUtils.report('Unchanged', totalUnchanged);
    VlocityUtils.report('Diffs', totalDiffs);
    VlocityUtils.report('New', totalNew);
    VlocityUtils.report('Undiffable', totalUndiffable);

    fs.outputFileSync(path.join(this.vlocity.tempFolder, 'diffs/localFolderFiles.json'), stringify(currentFiles, { space: 4 }));
    fs.outputFileSync(path.join(this.vlocity.tempFolder, 'diffs/targetOrgFiles.json'), stringify(exportedFiles, { space: 4 }));
};

DataPacksJob.prototype.getDiffs = async function(jobInfo) {
    
    jobInfo.cancelDeploy = true;
    jobInfo.failIfHasDiffs = jobInfo.jobAction == 'GetDiffsCheck';

    await this.getDiffsAndDeploy(jobInfo);
};

DataPacksJob.prototype.diffPacks = async function(jobInfo) {
    var sourceData = jobInfo.sourceData;
    var targetData = jobInfo.targetData.dataPacks;
    var targetOrgRecordsHash = {};
    var allTargetDataPacks = {};

    for (var dataPack of targetData) {

        if (!jobInfo.specificManifestKeys || jobInfo.specificManifestKeys.includes(dataPack.VlocityDataPackKey)) {   
            targetOrgRecordsHash[dataPack.VlocityDataPackKey] = this.vlocity.datapacksutils.getDataPackHashable(dataPack, jobInfo);
            allTargetDataPacks[dataPack.VlocityDataPackKey] = dataPack; 
        }
    }

    var sourceDataPacks = [];

    for (var dataPack of sourceData.dataPacks) {

        if (!jobInfo.specificManifestKeys || jobInfo.specificManifestKeys.includes(dataPack.VlocityDataPackKey)) {   
            sourceDataPacks.push(dataPack);
        }
    }

    sourceData.dataPacks = sourceDataPacks;

    this.checkDiffs(jobInfo, sourceData, targetOrgRecordsHash);

    var sourceDataByKey = {};

    for (var dataPack of sourceData.dataPacks) {
        jobInfo.dataPackDisplayLabels[dataPack.VlocityDataPackKey] = this.vlocity.datapacksutils.getDisplayName(dataPack);
        sourceDataByKey[dataPack.VlocityDataPackKey] = dataPack;
    }

    await this.vlocity.datapacksutils.getFieldDiffs(sourceDataByKey, allTargetDataPacks, jobInfo);

}

DataPacksJob.prototype.getDiffsAndDeploy = async function(jobInfo) {
    
    if (jobInfo.skipRefresh) {
        jobInfo.specificManifestKeys = [];
    } else {
        fs.removeSync(path.join(this.vlocity.tempFolder, 'diffs'));
    
        if (!jobInfo.manifest) {
            
            var getManifestJobInfo = JSON.parse(JSON.stringify(jobInfo));

            this.vlocity.datapacksbuilder.initializeImportStatus(getManifestJobInfo.projectPath + '/' + getManifestJobInfo.expansionPath, getManifestJobInfo);

            jobInfo.specificManifestKeys = Object.keys(getManifestJobInfo.currentStatus);
        }
    }

    if (!jobInfo.savedProjectPath) {
        jobInfo.savedProjectPath = jobInfo.projectPath;
        jobInfo.savedExpansionPath = jobInfo.expansionPath;
    }

    jobInfo.projectPath = path.join(this.vlocity.tempFolder, 'diffs', this.vlocity.datapacksexpand.generateFolderOrFilename(this.vlocity.username));
    jobInfo.expansionPath = '.';

    var targetOrgRecordsHash = {};
    var allTargetDataPacks = {};

    jobInfo.maxDepth = 0;

    await this.exportJob(jobInfo);
    
    jobInfo.manifest = null;
    jobInfo.singleFile = true;
    jobInfo.specificManifestKeys = null;
    jobInfo.specificManifestObjects = null;

    VlocityUtils.silence = true;
    jobInfo.currentStatus = {};

    jobInfo.resetFileData = true;

    let currentFileData = await this.vlocity.datapacksbuilder.buildImport(jobInfo.projectPath, jobInfo);

    if (currentFileData && currentFileData.dataPacks) {

        VlocityUtils.warn('Total Exported DataPacks', currentFileData.dataPacks.length);

        currentFileData.dataPacks.forEach((dataPack) => {
            allTargetDataPacks[dataPack.VlocityDataPackKey] = dataPack;

            // Iterate over this and hash each individual 1 as JSON
            targetOrgRecordsHash[dataPack.VlocityDataPackKey] = this.vlocity.datapacksutils.getDataPackHashable(dataPack, jobInfo);
        });
    } else {
        VlocityUtils.error('No DataPacks Found');
    }

    jobInfo.projectPath = jobInfo.savedProjectPath;
    jobInfo.expansionPath = jobInfo.savedExpansionPath;

    this.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo);

    jobInfo.currentStatus = {};
    jobInfo.manifest = null;
    jobInfo.specificManifestKeys = null;
    jobInfo.specificManifestObjects = null;
    jobInfo.resetFileData = true;
    jobInfo.VlocityDataPackIds = [];
    jobInfo.singleFile = true;
    jobInfo.toExportGroups = null;

    let checkDiffsFile = await this.vlocity.datapacksbuilder.buildImport(jobInfo.projectPath, jobInfo);
    
    VlocityUtils.silence = false;

    this.checkDiffs(jobInfo, checkDiffsFile, targetOrgRecordsHash);

    var sourceDataByKey = {};

    checkDiffsFile.dataPacks.forEach(function(dataPack) {
        sourceDataByKey[dataPack.VlocityDataPackKey] = dataPack;
    });

    await this.vlocity.datapacksutils.getFieldDiffs(sourceDataByKey, allTargetDataPacks, jobInfo);

    jobInfo.errors = [];
    jobInfo.hasError = false;
    jobInfo.singleFile = false;
    jobInfo.jobAction = 'Deploy';

    if (jobInfo.failIfHasDiffs) {

        for (var dataPackKey in jobInfo.currentStatus) {
            if (jobInfo.diffType[dataPackKey] != 'Unchanged') {
                jobInfo.errors.push(dataPackKey + ' Changed');
                jobInfo.hasError = true;
            }
        }
    }

    if (!jobInfo.cancelDeploy) {
        await this.runJobWithInfo(jobInfo, jobInfo.jobAction);
    }
};

DataPacksJob.prototype.cleanOrgData = async function(jobInfo) {
    jobInfo.javascript = 'cleanData.js';
    await this.reExpandAllFilesAndRunJavaScript(jobInfo);
};

DataPacksJob.prototype.validateLocalData = async function(jobInfo) {
    jobInfo.javascript = { All: 'validateLocalData.js' };
    jobInfo.skipExpand = !jobInfo.fixLocalGlobalKeys;
    VlocityUtils.silence = true;
    await this.reExpandAllFilesAndRunJavaScript(jobInfo);
};

DataPacksJob.prototype.buildManifest = async function(jobInfo) {
  
    var fullDataPath = jobInfo.projectPath;

    jobInfo.singleFile = true;
    jobInfo.disablePagination = true;
    jobInfo.compileOnBuild = false;
    jobInfo.fullStatus = true;

    VlocityUtils.simpleLogging = true;

    VlocityUtils.verbose('Getting DataPacks', fullDataPath, jobInfo.manifest, jobInfo);

    let dataJson = await this.vlocity.datapacksbuilder.buildImport(fullDataPath, jobInfo);
    
    if (!dataJson) return;

    for (var dataPack of dataJson.dataPacks) {
        VlocityUtils.report('- ' + dataPack.VlocityDataPackKey);
    }
}

DataPacksJob.prototype.refreshProject = async function(jobInfo) {
    jobInfo.javascript = null;
    jobInfo.specificManifestKeys = null;
    jobInfo.manifest = null;
    await this.reExpandAllFilesAndRunJavaScript(jobInfo);
};

DataPacksJob.prototype.reExpandAllFilesAndRunJavaScript = async function(jobInfo) {
    
    if (typeof jobInfo.javascript == 'string') {
        await this.vlocity.datapacksutils.runJavaScript(jobInfo.projectPath, jobInfo.javascript, null, jobInfo);
    } else {
        var fullDataPath = jobInfo.projectPath;

        jobInfo.singleFile = true;
        jobInfo.disablePagination = true;
        jobInfo.compileOnBuild = false;
        jobInfo.fullStatus = true;

        VlocityUtils.verbose('Getting DataPacks', fullDataPath, jobInfo.manifest, jobInfo);

        let dataJson = await this.vlocity.datapacksbuilder.buildImport(fullDataPath, jobInfo);
        
        if (!dataJson) return;
    
        for (var dataPack of dataJson.dataPacks) {

            if (jobInfo.javascript && jobInfo.javascript[dataPack.VlocityDataPackType]) {

                var jsFiles;
            
                if (typeof jobInfo.javascript[dataPack.VlocityDataPackType] === 'string') {
                    jsFiles = [jobInfo.javascript[dataPack.VlocityDataPackType]];
                } else {
                    jsFiles = jobInfo.javascript[dataPack.VlocityDataPackType];
                }

                for (var file of jsFiles) {
                    await this.vlocity.datapacksutils.runJavaScript(jobInfo.projectPath, file, dataPack, jobInfo);
                }           
            }
        }

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

            for (var file of jsFiles) {
                await this.vlocity.datapacksutils.runJavaScript(jobInfo.projectPath, file, dataJson.dataPacks, jobInfo);
            }
        }

        VlocityUtils.success('Run All JavaScript Complete');

        fs.outputFileSync(RUN_JS_TEMP, stringify(dataJson, { space: 4 }), 'utf8');

        if (!jobInfo.skipExpand) { 
            this.vlocity.datapacksexpand.expand(jobInfo.projectPath + '/' + jobInfo.expansionPath, dataJson, jobInfo);
        }
    }
};

DataPacksJob.prototype.runApex = async function(jobInfo) {
    
    VlocityUtils.report('Running Apex', jobInfo.apex);

    await this.vlocity.datapacksutils.runApex(jobInfo.folder ? jobInfo.folder : jobInfo.projectPath, jobInfo.apex, []);
};