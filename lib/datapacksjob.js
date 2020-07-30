var fs = require('fs-extra');
var stringify = require('fast-json-stable-stringify');
var stringify_pretty = require('json-stable-stringify');
var path = require('path');
var yaml = require('js-yaml');
var childProcess = require('child_process');
const open = require("opn");

var DataPacksJob = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};

    this.defaultJobSettings = yaml.safeLoad(fs.readFileSync(path.join(__dirname, 'defaultjobsettings.yaml'), 'utf8'));
    this.queryDefinitions = yaml.safeLoad(fs.readFileSync(path.join(__dirname, 'querydefinition.yaml'), 'utf8'));
    this.runningParallel = {};
    this.vlocity.relationMap = new Map();
    this.vlocity.insertIndexToSfIdMap = new Map();
    this.vlocity.nameToSfIdMap = new Map();
    this.vlocity.salesforceIdMap = new Map();
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
                    let queryObj = this.queryDefinitions[jobInfo.queries[i]];

                    if (jobInfo.queryFilterMappings && jobInfo.queryFilterMappings.length > 0) {
                        jobInfo.queryFilterMappings.forEach(mapping => {
                            if (queryObj.VlocityDataPackType === Object.keys(mapping)[0]) {
                                if (!queryObj.query.includes(mapping[Object.keys(mapping)[0]])) {
                                    queryObj.query += (queryObj.query.includes('WHERE') ? ' AND ' : ' WHERE ') + mapping[Object.keys(mapping)[0]];
                                }
                            }
                        });
                    }

                    if(!this.vlocity.namespace && queryObj.query.includes('%vlocity_namespace%__')){
                        queryObj.query = queryObj.query.replace(/%vlocity_namespace%__/g,'');
                    }
                    jobInfo.queries[i] = queryObj;
                }
            }
        }       
    
        if (jobInfo.OverrideSettings) {
            this.vlocity.datapacksutils.overrideExpandedDefinition(jobInfo.OverrideSettings);
        }
    
        let resForThis = await this.runJobWithInfo(jobInfo, action);

        VlocityUtils.report('Job Complete', action, jobInfo.elapsedTime || '');

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

DataPacksJob.prototype.initializeJobInfo = async function(jobInfo, action) {
    
    // Will not continue a single DataPack, but will continue when there are breaks in the job
    if (action == 'Continue' || action == 'Retry') {
        await this.vlocity.datapacksutils.loadCurrentJobInfo(jobInfo);

        jobInfo.hasError = false;
        jobInfo.headersOnlyDidNotHelp = false;
        jobInfo.startTime = VlocityUtils.startTime;
        jobInfo.headersOnly = false;
        jobInfo.isRetry = true;
        
        if (jobInfo.jobAction == 'Export' 
            || jobInfo.jobAction == 'GetDiffs' 
            || jobInfo.jobAction == 'GetDiffsAndDeploy') {
            
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
                    || jobInfo.currentStatus[dataPackKey] == 'Added' 
                    || jobInfo.currentStatus[dataPackKey] == 'AddedHeader') {
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

    // Allow Expecting an OAuth token as part of job info.
    this.vlocity.oauthConnection = jobInfo.oauthConnection;

    jobInfo.jobAction = action;
    jobInfo.startTime = jobInfo.startTime || VlocityUtils.startTime;
    jobInfo.originalAction = jobInfo.originalAction || action;
    
    jobInfo.logName = jobInfo.logName || this.vlocity.datapacksexpand.generateFolderOrFilename((jobInfo.jobName ? jobInfo.jobName : 'VDX') + '-' + new Date(Date.now()).toISOString() + '-' + jobInfo.jobAction, 'yaml');

    jobInfo.alreadyExportedKeys = jobInfo.alreadyExportedKeys || [];
    jobInfo.allParents = jobInfo.allParents || [];
    jobInfo.errors = jobInfo.errors || [];
    jobInfo.report = jobInfo.report || [];
    jobInfo.postDeployResults = jobInfo.postDeployResults || [];
    jobInfo.preDeployDataSummary = jobInfo.preDeployDataSummary || [];
    jobInfo.refreshVlocityBase = jobInfo.refreshVlocityBase || [];
    jobInfo.expandedDataPacks = jobInfo.expandedDataPacks || [];

    jobInfo.currentStatus = jobInfo.currentStatus || {};
    jobInfo.currentErrors = jobInfo.currentErrors || {};
    jobInfo.parallelStatus = {};
    jobInfo.sourceKeysByParent = jobInfo.sourceKeysByParent || {};
    jobInfo.alreadyExportedIdsByType = jobInfo.alreadyExportedIdsByType || {};
    jobInfo.alreadyErroredIdsByType = jobInfo.alreadyErroredIdsByType || {};
    jobInfo.alreadyRetriedIdsByType = jobInfo.alreadyRetriedIdsByType || {};

    jobInfo.keyToType = jobInfo.keyToType || {};
    jobInfo.vlocityKeysToNewNamesMap = jobInfo.vlocityKeysToNewNamesMap || {};
    jobInfo.vlocityRecordSourceKeyMap = jobInfo.vlocityRecordSourceKeyMap || {};
    jobInfo.VlocityDataPackIds = jobInfo.VlocityDataPackIds || {};
    jobInfo.generatedKeysToNames = jobInfo.generatedKeysToNames || {};
    jobInfo.sourceKeyToRecordId = jobInfo.sourceKeyToRecordId || {};
    jobInfo.sourceKeyToMatchingKeysData = jobInfo.sourceKeyToMatchingKeysData || {};
    jobInfo.dataPackKeyToPrimarySourceKey = jobInfo.dataPackKeyToPrimarySourceKey || {};
    jobInfo.diffType = jobInfo.diffType || {};
    jobInfo.sObjectsInfo = jobInfo.sObjectsInfo || {};
    jobInfo.sourceHashCodes = jobInfo.sourceHashCodes || {};
    jobInfo.targetHashCodes = jobInfo.targetHashCodes || {};
    jobInfo.fullManifest = jobInfo.fullManifest || {};
    jobInfo.manifestFound = jobInfo.manifestFound || {};
    
    jobInfo.dataPackDisplayLabels = jobInfo.dataPackDisplayLabels || {};
    jobInfo.allDataSummary = jobInfo.allDataSummary || {};
    jobInfo.pendingFromManifest = jobInfo.pendingFromManifest || {};
    jobInfo.keysToDirectories = jobInfo.keysToDirectories || {};
    jobInfo.VlocityDataPackKeyToUrlMapping = jobInfo.VlocityDataPackKeyToUrlMapping || {};

    jobInfo.errorHandling = jobInfo.errorHandling || {};
    jobInfo.relationshipKeyToChildKeys = jobInfo.relationshipKeyToChildKeys || {};

    jobInfo.dataPackLabelsByDir = jobInfo.dataPackLabelsByDir || {};

    // Means that Continue or Retry will not work
    if (jobInfo.jobAction == 'Continue' || jobInfo.jobAction == 'Retry') {
        throw jobInfo.jobAction + ' initialization failed. Please use another Command';
    }

    if (jobInfo.manifest 
        || (jobInfo.gitCheck && jobInfo.jobAction == 'Deploy')) {
        await this.formatManifest(jobInfo);
    }

    jobInfo.supportParallel = jobInfo.defaultMaxParallel > 1;
    this.vlocity.datapacksutils.loadIgnoreFile(jobInfo.projectPath, jobInfo.sourceProjectPath, jobInfo.targetProjectPath);
};

DataPacksJob.prototype.runJobWithInfo = async function(jobInfo, action) {
    
    try {
        await this.initializeJobInfo(jobInfo, action);
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
                await this.vlocity.datapacksutils.loadSalesforceMetadata();
                await this.vlocity.datapacksbuilder.initializeImportStatus(jobInfo.projectPath + '/' + jobInfo.expansionPath, jobInfo);
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

        if (jobInfo.postJobApexByType && jobInfo.postJobApexByType[action]) {

            var dataPackTypesAlreadyProcessed = {};

            for (var dataPackKey in jobInfo.currentStatus) {
                var dataPackType = dataPackKey.substring(0, dataPackKey.indexOf("/"));
        
                if (jobInfo.postJobApexByType[action][dataPackType] && !dataPackTypesAlreadyProcessed.hasOwnProperty(dataPackType)) {
                    VlocityUtils.report('Running Post Job Apex For Type', dataPackType,  jobInfo.postJobApexByType[action][dataPackType]);
                    await this.vlocity.datapacksutils.runApex(jobInfo.projectPath, jobInfo.postJobApexByType[action][dataPackType], null);
                    dataPackTypesAlreadyProcessed[dataPackType] = true;
                }
            }
        }

        if (jobInfo.postJobJavaScript && jobInfo.postJobJavaScript[action]) {
            VlocityUtils.report('Running Post Job JavaScript', jobInfo.postJobJavaScript[action]);
            await this.vlocity.datapacksutils.runJavaScript(jobInfo.projectPath, jobInfo.postJobJavaScript[action], null, jobInfo);
        }

        return await this.formatResponse(jobInfo);
    } catch (err) {
        VlocityUtils.error('Uncaught Job Error', err, (err && err.stack) ? err.stack : '');
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
    } else if (action == 'DeployMultiple') {
        await this.deployMultipleJob(jobInfo)
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
    } else if (action == 'InstallVlocityInitial') {
        await this.installVlocityInitial(jobInfo);
    } else if (action == 'UpdateSettings') {
        await this.updateSettings(jobInfo);
    } else if (action == 'CleanOrgData') {
        await this.cleanOrgData(jobInfo);
    } else if (action == 'ValidateLocalData') {
        await this.validateLocalData(jobInfo);
    } else if (action == 'RunValidationTest') {
        await this.runValidationTest(jobInfo);
    } else if (action == 'DeltaCheck') {
        await this.runDeltaCheck(jobInfo);
    } else if (action == 'CheckStaleObjects') {
        await this.runCheckStaleObjects(jobInfo);
    } else if (action == 'BuildManifest') {
        await this.buildManifest(jobInfo);
    } else if (action == 'RetrieveSalesforce') {
        await this.retrieveSalesforce(jobInfo); 
    } else if (action == 'DeploySalesforce') { 
        await this.deploySalesforce(jobInfo);
    } else if (action == 'GitInit') { 
       await this.vlocity.utilityservice.runGitInit(jobInfo);
    } else if (action == 'GitCommit') { 
        await this.vlocity.utilityservice.runGitCommit(jobInfo);
    } else if (action == 'GitClone') { 
        await this.vlocity.utilityservice.runGitClone(jobInfo);
    } else if (action == 'GitPush') { 
        await this.vlocity.utilityservice.runGitPush(jobInfo);
    } else if (action == 'GitPull') { 
        await this.vlocity.utilityservice.runGitPull(jobInfo);
    } else if (action == 'GitCheckoutBranch') { 
        await this.vlocity.utilityservice.runGitCheckoutBranch(jobInfo);
    } else if (action == 'GitCurrentBranch') {
        await this.vlocity.utilityservice.runGitCurrentBranch(jobInfo);
    } else if (action == 'GitBranch') {
        await this.vlocity.utilityservice.runGitBranch(jobInfo);
    } else if (action == 'GitCheckRepo') {
        await this.vlocity.utilityservice.runGitCheckRepo(jobInfo);
    } else if (action == 'GitStatus') {
        await this.vlocity.utilityservice.runGitStatus(jobInfo);
    } else if (action == 'refreshVlocityProcessListing') {
	    await this.refreshVlocityProcessListing(jobInfo);
    } else if (action == 'downloadVplDatapack') {
        await this.downloadVplDatapack(jobInfo);
    } else if (action == 'downloadPerformanceData') {
        await this.downloadPerformanceData(jobInfo);
    } else if (action == 'getUserNameFromUserId') {
        await this.getUserNameFromUserId(jobInfo);
    } else if (action == 'getOrgProjects') {
        await this.getOrgProjects(jobInfo);
    } else if (action == 'runTestProcedure') {
        return await this.vlocity.testframework.runJob(jobInfo, 'Start');
    } else if (action == 'getTestProcedures') {
        return await this.vlocity.testframework.runJob(jobInfo, 'GetTestProcedures');
    } else if (action === 'datapackOpen') {
        await this.datapackOpen(jobInfo);
    } else if (action === 'getTrackingEntryUrl') {
        await this.getTrackingEntryUrl(jobInfo);
    } else {
        jobInfo.hasError = true;
        jobInfo.errors.push('Command not found: ' + action);
        VlocityUtils.error('Command not found: ' + action);
    }
};

DataPacksJob.prototype.formatResponse = async function(jobInfo, error) {
    
    try {
        this.vlocity.datapacksutils.printJobStatus(jobInfo, true);

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
                allManifestByKey[dataPackKey] = JSON.parse(JSON.stringify(jobInfo.fullManifest[dataPackType][dataPackKey]));

                if (!allManifestByKey[dataPackKey].isSFDXData) {
                    allManifestByKey[dataPackKey].VlocityDataPackKey = dataPackType + '/' + this.vlocity.datapacksexpand.getDataPackFolder(dataPackType, allManifestByKey[dataPackKey].VlocityRecordSObjectType, allManifestByKey[dataPackKey]);  
                    if (allManifestByKey[dataPackKey].VlocityDataPackKeyForManifest) {
                        delete allManifestByKey[dataPackKey].VlocityDataPackKeyForManifest;
                    }
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
                VlocityUtils.error('Error Writing Log', e);
            }

            response.records = Object.values(allManifestByKey);
            response.status = 'success';
            response.message = response.records.length + ' Found';
        } else if (jobInfo.jobAction == 'RefreshVlocityBase' || jobInfo.jobAction == 'InstallVlocityInitial') {
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
        } else if (jobInfo.jobAction == 'RetrieveSalesforce') {
            response.status = jobInfo.hasError ? 'error' : 'success';
            response.message = jobInfo.hasError ? jobInfo.errors.join('\n').replace(/%vlocity_namespace%/g, this.vlocity.namespace) : `Retrieve Successful`;
            response.records = jobInfo.sfdxData;
        } else if (jobInfo.jobAction.startsWith('Git') || jobInfo.jobAction == 'refreshVlocityProcessListing') {
            response.records = jobInfo.data;
            response.message = jobInfo.message ?  jobInfo.message : jobInfo.hasError ? jobInfo.errors.join('\n').replace(/%vlocity_namespace%/g, this.vlocity.namespace) : `${jobInfo.jobAction} Successful`;
            response.status = jobInfo.hasError ? 'error' : 'success';
        } else if (jobInfo.jobAction === 'downloadPerformanceData') {
            response.records = jobInfo.data;
            response.message = jobInfo.errors;
            response.status = jobInfo.hasError ? 'error' : 'success';
        } else if (jobInfo.jobAction === 'getUserNameFromUserId') {
            response.records = jobInfo.data;
            response.message = jobInfo.errors;
            response.status = jobInfo.hasError ? 'error' : 'success';
        }  else if (jobInfo.jobAction === 'getOrgProjects') {
            response.records = jobInfo.data;
            response.message = jobInfo.errors;
            response.status = jobInfo.hasError ? 'error' : 'success';
        }  else if (jobInfo.jobAction === 'getTestProcedures') {
            response.records = jobInfo.data;
            response.message = jobInfo.errors;
            response.status = jobInfo.hasError ? 'error' : 'success';
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

                if (jobInfo.VlocityDataPackKeyToUrlMapping[dataPack.VlocityDataPackKey]) {
                    if (jobInfo.VlocityDataPackKeyToUrlMapping[dataPack.VlocityDataPackKey].sourceOrgUrl) {
                        dataPack.sourceOrgUrl = jobInfo.VlocityDataPackKeyToUrlMapping[dataPack.VlocityDataPackKey].sourceOrgUrl.replace(/%vlocity_namespace%__/g, this.vlocity.namespacePrefix);
                    }
                    if (jobInfo.VlocityDataPackKeyToUrlMapping[dataPack.VlocityDataPackKey].targetOrgUrl) {
                        dataPack.targetOrgUrl = jobInfo.VlocityDataPackKeyToUrlMapping[dataPack.VlocityDataPackKey].targetOrgUrl.replace(/%vlocity_namespace%__/g, this.vlocity.namespacePrefix);
                    }
                }

                if (jobInfo.sObjectsInfo && jobInfo.sObjectsInfo[dataPack.VlocityDataPackKey]) {
                    dataPack.SObjects = jobInfo.sObjectsInfo[dataPack.VlocityDataPackKey];
                }

                if (jobInfo.sourceHashCodes[dataPack.VlocityDataPackKey]) {
                    dataPack.sourceHashCode = jobInfo.sourceHashCodes[dataPack.VlocityDataPackKey];
                }

                if (jobInfo.targetHashCodes[dataPack.VlocityDataPackKey]) {
                    dataPack.targetHashCode = jobInfo.targetHashCodes[dataPack.VlocityDataPackKey];
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
                        dataPack.VlocityDataPackStatus = 'Ready';
                    } 

                    if (dataPack.VlocityDataPackStatus == 'Error') {
                        VlocityUtils.error('Error', dataPack.VlocityDataPackKey, '-', jobInfo.deltaCheckResults[dataPack.VlocityDataPackKey].errorMessage);
                    } else {
                        VlocityUtils.verbose(dataPack.VlocityDataPackKey, dataPack.VlocityDataPackStatus); 
                    }
                }
                dataPacksMap[dataPack.VlocityDataPackKey] = dataPack;
                VlocityUtils.verbose(dataPack.VlocityDataPackKey, dataPack.VlocityDataPackStatus);
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
                if(this.vlocity.namespace){
                    response.message = response.message.replace(/%vlocity_namespace%/g, this.vlocity.namespace);
                } else{
                    response.message = response.message.replace(/%vlocity_namespace%__/g, '');
                }
            }
        }

        jobInfo.records = response.records;

        if (jobInfo.jobAction == 'Export' || jobInfo.jobAction == 'Deploy') {
            await this.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo, true);
        }

        return response;
    } catch (e) {
        VlocityUtils.error('Error Formatting Response', e);
        return e;
    }    
};

DataPacksJob.prototype.formatManifest = async function(jobInfo) {
    
    VlocityUtils.verbose('Formatting Manifest');

    if (jobInfo.gitCheck && jobInfo.jobAction == 'Deploy') {
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

        jobInfo.specificManifestKeys = jobInfo.specificManifestKeys.filter(item => {
            return typeof item === "string";
        });

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

DataPacksJob.prototype.addRecordToExport = function(jobInfo, queryData, record) {
    if (this.vlocity.namespace) {
        record = JSON.parse(JSON.stringify(record).replace(new RegExp(this.vlocity.namespace, 'g'), '%vlocity_namespace%'));
    } else {
        record = JSON.parse(JSON.stringify(record));
    }
    record.VlocityDataPackType = queryData.VlocityDataPackType;
    record.VlocityRecordSObjectType = record.attributes.type;

    this.vlocity.datapacksutils.updateRecordReferences(record);

    record.VlocityDataPackKeyForManifest = queryData.VlocityDataPackType + '/' + (this.vlocity.datapacksexpand.getDataPackFolder(queryData.VlocityDataPackType, record.VlocityRecordSObjectType, record) || record.Id);
    
    if (jobInfo.fullManifest[queryData.VlocityDataPackType][record.Id] || 
        (jobInfo.specificManifestKeys 
        && (!queryData.manifestOnly && jobInfo.specificManifestKeys.indexOf(queryData.VlocityDataPackType) == -1) 
        && jobInfo.specificManifestKeys.indexOf(record.VlocityDataPackKeyForManifest) == -1 
        && jobInfo.specificManifestKeys.indexOf(record.Id) == -1 
        && jobInfo.specificManifestKeys.indexOf(this.vlocity.datapacksexpand.sanitizeDataPackKey(record.VlocityDataPackKeyForManifest)) == -1 
        && jobInfo.specificManifestKeys.indexOf(`${queryData.VlocityDataPackType}/${record.Id}`) == -1 
        && jobInfo.specificManifestKeys.indexOf(`${queryData.VlocityDataPackType}/${record.Id.substring(0,15)}`) == -1)
        || (this.vlocity.datapacksutils.ignoreFileMap && this.vlocity.datapacksutils.ignoreFileMap.ignores(record.VlocityDataPackKeyForManifest))) {
        return false;
    }

    jobInfo.fullManifest[queryData.VlocityDataPackType][record.Id] = record;
    
    record.VlocityDataPackDisplayLabel = this.vlocity.datapacksutils.getDisplayName(record);
    record.orgUrl = this.vlocity.utilityservice.getVisualForcePageUrl(record.VlocityDataPackType, record.Id);
    
    return record;
}

DataPacksJob.prototype.runQueryForManifest = async function(queryInput) {
    let promise = await new Promise((resolve) => {
        var queryData = queryInput.queryData; 
        var jobInfo = queryInput.jobInfo;

        if (!queryData || !queryData.VlocityDataPackType || !queryData.query) {
            return resolve();
        }

        if (!jobInfo.specificManifestKeys 
            && jobInfo.allAllowedTypes) {
            if (!jobInfo.allAllowedTypes.Vlocity 
                || !jobInfo.allAllowedTypes.Vlocity[queryData.VlocityDataPackType]) {
                return resolve();
            }
        } 

        if (!jobInfo.fullManifest[queryData.VlocityDataPackType]) {
            jobInfo.fullManifest[queryData.VlocityDataPackType] = {};
        }

        var query = queryData.query.replace(/%vlocity_namespace%__/g, this.vlocity.namespacePrefix);
    
        this.vlocity.jsForceConnection.query(query)
        .on("record", (record) => {
            var recordAdded = this.addRecordToExport(jobInfo, queryData, record);
            if (recordAdded) {
                VlocityUtils.verbose('Found From Manifest', record.Id, recordAdded.VlocityDataPackType, recordAdded.VlocityDataPackDisplayLabel);
            }
        })
        .on("error", (err) => {
            VlocityUtils.report('VlocityDataPackType', queryData.VlocityDataPackType);
            VlocityUtils.report('Query', query);
            VlocityUtils.error('Query Error', err);
            resolve();
        })
        .on("end", () => {
            VlocityUtils.report('VlocityDataPackType', queryData.VlocityDataPackType);
            VlocityUtils.report('Query', query);
            VlocityUtils.report('Records', Object.keys(jobInfo.fullManifest[queryData.VlocityDataPackType]).length);
            resolve();
        })
        .run({ autoFetch : true, maxFetch : 100000 });
    });

    return promise;
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
  
                if (!queryData || (!jobInfo.specificManifestKeys && queryData.manifestOnly) || (queryData.requiredSetting && !jobInfo[queryData.requiredSetting])) {
                    continue;
                }

                if ((jobInfo.versionCompare && !queryData.versionCompare) || (!jobInfo.versionCompare && queryData.versionCompare)) {
                    continue;
                }

                allQueries.push( { context: this, func: 'runQueryForManifest', argument: { jobInfo: jobInfo, queryData: queryData } });
            }

            await this.vlocity.utilityservice.parallelLimit(allQueries, 30);
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

    VlocityUtils.verbose('Getting DataPacks', fullDataPath, jobInfo.manifest);
    
    let dataJson = await this.vlocity.datapacksbuilder.buildImport(fullDataPath, jobInfo);

    if (dataJson && dataJson.dataPacks) {
        await this.vlocity.validationtest.validate(jobInfo, dataJson.dataPacks);
    }
};

DataPacksJob.prototype.deltaCheck = async function(jobName, jobInfo) {
    
    var fullDataPath = jobInfo.projectPath;

    jobInfo.singleFile = true;
    jobInfo.disablePagination = true;
    jobInfo.fullStatus = true;

    VlocityUtils.verbose('Getting DataPacks', fullDataPath, jobInfo.manifest);

    VlocityUtils.silence = true;
    
    let dataJson = await this.vlocity.datapacksbuilder.buildImport(fullDataPath, jobInfo);
    
    VlocityUtils.silence = false;

    if (dataJson && dataJson.dataPacks) {
        await this.vlocity.deltacheck.deltaCheck(jobName, jobInfo, dataJson.dataPacks);       
    }
};

DataPacksJob.prototype.runDeltaCheck = async function(jobInfo) {
    await this.deltaCheck('DeltaCheck', jobInfo);
};

DataPacksJob.prototype.runCheckStaleObjects = async function(jobInfo) {
    jobInfo.checkStaleObjects = true;
    await this.deltaCheck('CheckStaleObjects', jobInfo);
};

DataPacksJob.prototype.runAutoFixPicklists = async function(jobInfo) {
    await this.deltaCheck('AutoFixPicklists', jobInfo);
};

DataPacksJob.prototype.runMetadataCheck = async function(jobInfo) {
    await this.deltaCheck('MetadataCheck', jobInfo);
};

DataPacksJob.prototype.exportJob = async function(jobInfo) {
    
    if (jobInfo.autoUpdateSettings) {
        await this.updateSettings(JSON.parse(JSON.stringify(jobInfo)));
    }

    VlocityUtils.milestone('Retrieving Vlocity');

    await this.buildManifestFromQueries(jobInfo);

    if (jobInfo.deltaCheck) {
        VlocityUtils.report(`Checking for Changes Before Export`);
        var deltaCheckJobInfo = JSON.parse(JSON.stringify(jobInfo));

        await this.runDeltaCheck(deltaCheckJobInfo);

        for (var dataPackType in jobInfo.fullManifest) {
            for (var fullManifestId in jobInfo.fullManifest[dataPackType]) {

                var exData = jobInfo.fullManifest[dataPackType][fullManifestId];
                
                if (deltaCheckJobInfo.deltaCheckResults && deltaCheckJobInfo.deltaCheckResults[exData.VlocityDataPackKeyForManifest] 
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

    if (jobInfo.shouldSendUpdates == null) {
        jobInfo.shouldSendUpdates = true;
    }
    
    await this.exportFromManifest(jobInfo);

    if (jobInfo.includeSalesforceMetadata) {

        if (jobInfo.specificManifestKeys && jobInfo.referencedSalesforceMetadata) {
            jobInfo.specificManifestKeys = jobInfo.specificManifestKeys.concat(jobInfo.referencedSalesforceMetadata);
        }

        VlocityUtils.milestone('Retrieving Salesforce');
        await this.retrieveSalesforce(jobInfo);
    }

    VlocityUtils.milestone('Finishing Retrieve');
};

DataPacksJob.prototype.getAllAvailableExports = async function(jobInfo) {

    var availableExportsData;
    var availableExportsFile;
    
    if (this.vlocity.username && jobInfo.useAvailableCache) {
        availableExportsFile = path.join(this.vlocity.tempFolder, 'projectavailables', `${this.vlocity.username.replace('.', '_').replace('@', '_')}-available-${this.vlocity.datapacksutils.hashCode(JSON.stringify(jobInfo.allAllowedTypes || {}))}.json`);

        try {
            availableExportsData = JSON.parse(fs.readFileSync(availableExportsFile));
        } catch (e) {
            // Ignored
        }
    }

    if (jobInfo.resetAvailableCache || !availableExportsData) {
    
        VlocityUtils.report('Retrieving VlocityDataPackKeys');

        await this.buildManifestFromQueries(jobInfo);

        if (jobInfo.includeSalesforceMetadata) {
            await this.vlocity.datapacksutils.retrieveSalesforce(jobInfo, true);
        }

        if (availableExportsFile) {
            await fs.outputFile(availableExportsFile, JSON.stringify(jobInfo.fullManifest), { encoding: 'utf8' });
        }
    } else {
        jobInfo.fullManifest = availableExportsData;
    }
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
                    
                    if (eItem.errorCode == "REQUEST_LIMIT_EXCEEDED") {
                        throw eItem;
                    }
                }
            } else {
            
                VlocityUtils.error('Uncaught Error', `Export - ${e.stack || e}`);
                jobInfo.errors.push(`Uncaught Error >> Export - ${e.stack || e}`);

                if (e.errorCode == "REQUEST_LIMIT_EXCEEDED") {
                    throw eItem;
                }
            }
        }

        // This also calculates jobInfo.exportRemaining
        this.vlocity.datapacksutils.printJobStatus(jobInfo);
   
    } while (jobInfo.exportRemaining > 0) 
 
    if (this.vlocity.datapacksexportbuildfile.currentExportFileData) {
        var savedFormat = [];

        for (var dataPackId in this.vlocity.datapacksexportbuildfile.currentExportFileData) {
            savedFormat.push(this.vlocity.datapacksexportbuildfile.currentExportFileData[dataPackId]);
        }

        var dataPacksToExpand = JSON.parse(JSON.stringify({ dataPacks: savedFormat }));

        await this.vlocity.datapacksexpand.expand(jobInfo.projectPath + '/' + jobInfo.expansionPath, dataPacksToExpand, jobInfo);
    }
}

DataPacksJob.prototype.setupExportGroups = async function(jobInfo) {
    
    if (!jobInfo.initialized) {
        VlocityUtils.report('Initializing Project');
        await this.vlocity.datapacksutils.initializeFromProject(jobInfo);
        jobInfo.initialized = true;
        await this.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo);
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

        if (exportData[0].VlocityDataPackRelationshipType == 'Children') {
            let childrenProcessResult = await this.vlocity.datapacksutils.handleDataPackEvent('childrenExport', exportData[0].VlocityDataPackType, { jobInfo: jobInfo, childrenDataPacks: exportData });
            
            // Processed Children in event class
            if (childrenProcessResult) {
                return;
            }
        } 

        var originalKeys = JSON.parse(JSON.stringify(exportData));

        var jobOptions = this.getOptionsFromJobInfo(jobInfo);

        let result = {};
        let dataPackData = await this.vlocity.datapacksutils.handleDataPackEvent('exportWithJavaScript', exportData[0].VlocityDataPackType, { exportData: exportData, jobOptions: jobOptions });

        if (!dataPackData) {
            result = await this.vlocity.datapacks.export(exportData[0].VlocityDataPackType, exportData, jobOptions);

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

            dataPackData = await this.vlocity.datapacks.getDataPackData(result.VlocityDataPackId);
        }

        var processedKeys = {};

        for (var dataPack of (dataPackData.dataPacks || [])) {
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
                    && jobInfo.currentStatus[dataPack.VlocityDataPackKey] != 'Error' ) {
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

                        let orgUrl = this.vlocity.utilityservice.getVisualForcePageUrl(dataPack.VlocityDataPackType, dataPack.VlocityDataPackData[dataField][0].Id);
                        if (jobInfo.sfdxUsername === jobInfo.source) {
                            jobInfo.VlocityDataPackKeyToUrlMapping[dataPack.VlocityDataPackKey] = {
                                'sourceOrgUrl': orgUrl
                            };
                            dataPack.VlocityDataPackData[dataField][0].sourceOrgUrl = orgUrl;
                        }
                        if (jobInfo.sfdxUsername === jobInfo.target) {
                            if (!jobInfo.VlocityDataPackKeyToUrlMapping[dataPack.VlocityDataPackKey]) {
                                jobInfo.VlocityDataPackKeyToUrlMapping[dataPack.VlocityDataPackKey] = {
                                    'targetOrgUrl': orgUrl
                                };
                            }
                            dataPack.VlocityDataPackData[dataField][0].targetOrgUrl = orgUrl;
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
                    
                    VlocityUtils.error('Error During Export', errorMessage);
                    
                    jobInfo.errors.push(errorMessage);
                    jobInfo.currentErrors[dataPack.VlocityDataPackKey] = errorMessage;
                    
                } else if (!jobInfo.fullManifest[dataPack.VlocityDataPackType][dataPack.VlocityDataPackKey]) {
                    if (dataPack.VlocityDataPackRelationshipType == 'Children' || dataPack.VlocityDataPackRelationshipType == 'Pagination') {
                        jobInfo.fullManifest[dataPack.VlocityDataPackType][dataPack.VlocityDataPackKey] = JSON.parse(JSON.stringify(dataPack));
                        jobInfo.keyToType[dataPack.VlocityDataPackKey] = dataPack.VlocityDataPackType + '-Children';
                    } else {
                        jobInfo.fullManifest[dataPack.VlocityDataPackType][dataPack.VlocityDataPackKey] = JSON.parse(JSON.stringify(dataPack.VlocityDataPackData));
                        jobInfo.keyToType[dataPack.VlocityDataPackKey] = dataPack.VlocityDataPackType;
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

                        if (!jobInfo.errorHandling) {
                            jobInfo.errorHandling = {};
                        }
                        
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

        this.vlocity.datapacksexportbuildfile.addToExportBuildFile(jobInfo, JSON.parse(JSON.stringify(dataPackData, null, 4)));

        if (jobInfo.expansionPath) {
            await this.vlocity.datapacksexpand.expand(jobInfo.projectPath + '/' + jobInfo.expansionPath, dataPackData, jobInfo);
            
            await this.vlocity.datapackserrorhandling.getSanitizedErrorMessage(jobInfo, dataPackData);
        }

        if (jobInfo.delete && result.VlocityDataPackId) {
            await this.vlocity.datapacks.delete(result.VlocityDataPackId, this.getOptionsFromJobInfo(jobInfo));
        }
    }

    await this.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo);
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
        
        if (!dataJson) {
            dataJson = {};
        }
        
        if (!dataJson.dataPacks) {
            dataJson.dataPacks = [];
        }

        await this.vlocity.datapacksutils.getAllParentChildKeys(dataJson.dataPacks, jobInfo);

        if (dataJson && jobInfo.dataPackName) {
            dataJson.name = jobInfo.dataPackName;
        }

        if (jobInfo.includeSalesforceMetadata) {
            await this.vlocity.datapacksutils.getSfdxData(jobInfo);

            dataJson.dataPacks = dataJson.dataPacks.concat(jobInfo.sfdxData);
        }

        if (dataJson) {
            jobInfo.data = JSON.parse(JSON.stringify(dataJson).replace(new RegExp(this.vlocity.namespace, 'g'), '%vlocity_namespace%'));
            
            if ([ 'vlocity_cmt', 'vlocity_ins', 'vlocity_ps' ].indexOf(this.vlocity.namespace) != -1) {
                jobInfo.data.vdxnamespace = this.vlocity.namespace;
            }

            var fileName = jobInfo.buildFile;

            if (fileName) {
                fs.outputFileSync(fileName, stringify(dataJson, { space: 4 }), 'utf8');
            }

            if (fileName.indexOf('.resource') > 0) {
                // also create .resource-meta.xml
                fs.outputFileSync(fileName + '-meta.xml', '<?xml version="1.0" encoding="UTF-8"?><StaticResource xmlns="http://soap.sforce.com/2006/04/metadata"><cacheControl>Public</cacheControl><contentType>text/json</contentType></StaticResource>',
                    'utf8');
            }
            
            VlocityUtils.error('Creating File', jobInfo.buildFile);
        }
    }
};

DataPacksJob.prototype.expandFile = async function (jobInfo) {
    if (jobInfo.expandMultiple) {
        for (let i = 0; i < Object.keys(jobInfo.buildFile).length; i++) {
            let buildFile = jobInfo.buildFile[i];
            if (!fs.existsSync(buildFile)) {
                buildFile = path.join(jobInfo.projectPath, buildFile);
            }

            if (!fs.existsSync(buildFile)) {
                throw `File Not Found: ${buildFile}`;
            }
             
            await this.vlocity.datapacksexpand.expandFile(path.join(jobInfo.projectPath,jobInfo.expansionPath), buildFile, jobInfo);
        }
    }
    else {
        await this.vlocity.datapacksexpand.expandFile(path.join(jobInfo.projectPath,jobInfo.expansionPath), jobInfo.buildFile, jobInfo);
    }
};

DataPacksJob.prototype.deployDataPackMetadataConfigurations = async function(pathToDeploy) {

    if (fs.existsSync(path.join(__dirname, '..', 'DataPackMetadata', pathToDeploy))) {
        var dataPackMetadataLatest = await this.vlocity.datapacksutils.loadFilesFromDir(path.join(__dirname, '..', 'DataPackMetadata', pathToDeploy));

        var drMatchingKeys = await this.vlocity.utilityservice.getDRMatchingKeys();
        var dataPackConfigurations = await this.vlocity.utilityservice.getVlocityDataPackConfigurations();

        var dataPackConfigurationsDeploy = [];
        var drMatchingKeysDeploy = [];

        for (var customMetadataType in dataPackMetadataLatest) {
            var metadataRecordsLatest = dataPackMetadataLatest[customMetadataType];

            for (var recordName in metadataRecordsLatest) {
                var recordNameOriginal = recordName;
                recordName = recordName.substring(0, recordName.indexOf('.json'));

                if (customMetadataType === 'VlocityDataPackConfiguration') {
                    if (recordName.includes('__c')) {
                        recordName = recordName.substring(0, recordName.indexOf('__c'));
                    }

                    var dataPackConfig = dataPackConfigurations[recordName];

                    if (!dataPackConfig) {
                        
                        try {
                            dataPackConfigurationsDeploy.push(JSON.parse(metadataRecordsLatest[recordNameOriginal]));
                            VlocityUtils.log(`Adding Configuration for ${recordName}`);
                        } catch (e) {
                            VlocityUtils.verbose('Bad File', recordNameOriginal);
                        }
                        
                        
                    } else if (!dataPackConfig['%vlocity_namespace%__DefaultExportLimit__c']) {
                        VlocityUtils.log(`Adding Configuration for ${recordName}`);
                        dataPackConfigurationsDeploy.push(JSON.parse(metadataRecordsLatest[recordNameOriginal]));
                       
                    }
                } else if (customMetadataType === 'DRMatchingKey') {
                    if (recordName.includes('__c')) {
                        recordName = '%vlocity_namespace%__' + recordName;
                    }

                    if (!drMatchingKeys.hasOwnProperty(recordName)) {
                        try {
                            drMatchingKeysDeploy.push(JSON.parse(metadataRecordsLatest[recordNameOriginal]));
                            VlocityUtils.log(`Adding Configuration for ${recordName}`);
                        } catch (e) {
                            VlocityUtils.verbose('Bad File', recordNameOriginal);
                        }
                    }
                }
            }
        }


        await this.vlocity.utilityservice.createCustomMetadataRecord(drMatchingKeysDeploy);
        await this.vlocity.utilityservice.createCustomMetadataRecord(dataPackConfigurationsDeploy);
    }
};

DataPacksJob.prototype.updateSettings = async function(jobInfo) {
    var projectPathsToDeploy = [ 'latest' ];

    if (!this.vlocity.organizationId) {
        return;
    }

    VlocityUtils.milestone('Checking Settings');
    
    if (this.vlocity.BuildToolSettingVersion != 'latest') {

        var vers = this.vlocity.BuildToolSettingLatestVersion - 1;
        while (vers >= this.vlocity.BuildToolSettingVersion) {
            projectPathsToDeploy.push('v' + vers);
            vers--;
        }
    }

    if (jobInfo.separateMatrixVersions) {
        projectPathsToDeploy.push('separateMatrixVersions');
    }

    if (jobInfo.separateCalculationProcedureVersions) {
        projectPathsToDeploy.push('separateCalculationProcedureVersions');
    }
    
    if (jobInfo.separateProducts) {
        projectPathsToDeploy.push('separateProducts');
    }

    var tempJobInfo = {
        projectPath: path.join(__dirname, '..', 'DataPackSettings'),
        delete: true,
        defaultMaxParallel: 100,
        resetFileData: true,
        jobAction: 'Deploy',
        singleFile: true,
        shouldSendUpdates: false
    };

    VlocityUtils.silence = true;

    await this.initializeJobInfo(tempJobInfo, 'BuildFile');

    let dataJson = await this.vlocity.datapacksbuilder.buildImport(tempJobInfo.projectPath, tempJobInfo);
    VlocityUtils.silence = false;

    dataJson.dataPacks.sort(function(a, b) {
        if (a.VlocityDataPackKey < b.VlocityDataPackKey) {
            return -1;
        }
        
        if (a.VlocityDataPackKey > b.VlocityDataPackKey) {
            return 1;
        }

        return 0; 
    });

    let hashCode = this.vlocity.datapacksutils.hashCode(stringify(dataJson)) + this.vlocity.datapacksutils.hashCode(projectPathsToDeploy.join('-'));
    var query = `Select ${this.vlocity.namespacePrefix}MapId__c from ${this.vlocity.namespacePrefix}DRMapItem__c where ${this.vlocity.namespacePrefix}MapId__c = '${hashCode}'`;

    VlocityUtils.verbose('Get Existing Setting', query);

    let result = await this.vlocity.jsForceConnection.query(query);
    if (jobInfo.force || result.records.length == 0) {
        VlocityUtils.milestone('Updating Settings');

        await this.vlocity.datapacksutils.runApex('.', 'ResetDataPackMappings.cls');

        for (var pathToDeploy of projectPathsToDeploy) {

            await this.deployDataPackMetadataConfigurations(pathToDeploy);

            VlocityUtils.verbose('Deploying Settings Path', pathToDeploy);
        
            var nextJob = {
                projectPath: path.join(__dirname, '..', 'DataPackSettings', pathToDeploy),
                delete: true,
                defaultMaxParallel: 100,
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
        settingsRecord[`${this.vlocity.namespacePrefix}DomainObjectAPIName__c`] = 'JSON';
        settingsRecord[`${this.vlocity.namespacePrefix}DomainObjectFieldAPIName__c`] = 'JSON';
        settingsRecord[`${this.vlocity.namespacePrefix}InterfaceFieldAPIName__c`] = 'JSON';
        settingsRecord[`${this.vlocity.namespacePrefix}DomainObjectCreationOrder__c`] = '0';
        settingsRecord[`${this.vlocity.namespacePrefix}MapId__c`] = `${hashCode}`;
        settingsRecord[`${this.vlocity.namespacePrefix}IsDisabled__c`] = true;
        
        let settingsRecordResult = await this.vlocity.jsForceConnection.sobject(`${this.vlocity.namespacePrefix}DRMapItem__c`).upsert([settingsRecord],`${this.vlocity.namespacePrefix}MapId__c`, { allOrNone: true });
    
        VlocityUtils.verbose(settingsRecordResult);
        VlocityUtils.milestone('Settings Updated');
    } else {
        VlocityUtils.milestone('Settings Update Skipped');
        VlocityUtils.success('Settings Already Current. Use --force if you want to update again');
    }
    
};

DataPacksJob.prototype.refreshVlocityBase = async function(jobInfo) {
    await this.installFromStaticResourceQuery(jobInfo, "Select Name, Body from StaticResource where Name LIKE 'DP_CARDS%' OR Name LIKE 'DP_TEMPLATES%'")
}

DataPacksJob.prototype.installVlocityInitial = async function(jobInfo) {
    await this.installFromStaticResourceQuery(jobInfo, "Select Name, Body from StaticResource where Name LIKE 'DP_%'");
}

DataPacksJob.prototype.installFromStaticResourceQuery = async function(jobInfo, query) {
    let result = await this.vlocity.jsForceConnection.query(query);
    
    for (var record of result.records) {

        try {
            var res = await this.vlocity.jsForceConnection.request(record.Body);
            
            this.vlocity.datapacksutils.printJobStatus(jobInfo);

            VlocityUtils.report('Beginning Deployment', record.Name);

            var optionsForInstall = this.getOptionsFromJobInfo(jobInfo);

            optionsForInstall.ignoreAllErrors = true;

            const importData = typeof res === 'object'
                ? res
                : JSON.parse(res);

            let result = await this.vlocity.datapacks.import(importData, optionsForInstall);
            
            let dataPackData = await this.vlocity.datapacks.getDataPackData(result.VlocityDataPackId);
            
            if (dataPackData.status === 'Complete') {

                VlocityUtils.success('Resource Deployed', record.Name);

                for (var dataPack of dataPackData.dataPacks) {

                    if (dataPack.VlocityDataPackStatus === 'Success') {
                        VlocityUtils.success('Deploy Success', dataPack.VlocityDataPackType, '-', dataPack.VlocityDataPackKey, '-', dataPack.VlocityDataPackName);
                    } else {
                        VlocityUtils.error('Deploy Error', dataPack.VlocityDataPackType, '-', dataPack.VlocityDataPackKey, '-', dataPack.VlocityDataPackName, '-', dataPack.VlocityDataPackMessage);
                    }
                }

                let activateResult = await this.vlocity.datapacks.activate(result.VlocityDataPackId, ['ALL'], this.getOptionsFromJobInfo(jobInfo));

                VlocityUtils.success(`Resource Activated ${ activateResult.Status}`, record.Name);
                        
                this.vlocity.datapacksutils.printJobStatus(jobInfo);

                jobInfo.refreshVlocityBase.push({ Name: record.Name, Status: activateResult.Status });
            } else {
                VlocityUtils.error('Failed to Install', record.Name, dataPackData);
            }
        } catch (e) {
            VlocityUtils.error('Failed to Install', record.Name, e);
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
        } else if (typeof stepSettings[dataPack.VlocityDataPackType] === 'string') {
            apexClass = stepSettings[dataPack.VlocityDataPackType];
        } else if (stepSettings[dataPack.VlocityDataPackType] && stepSettings[dataPack.VlocityDataPackType].namespace === this.vlocity.namespace) {
            apexClass = stepSettings[dataPack.VlocityDataPackType].apexClass;
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
        if (dataPack.ActivationStatus == 'Activated') {
            await this.vlocity.datapacksutils.handleDataPackEvent('afterActivationSuccess', dataPack.VlocityDataPackType, {dataPack: dataPack, jobInfo: jobInfo});
        } else if (dataPack.ActivationStatus == 'Ready' && dataPack.VlocityDataPackStatus == 'Success') {

            // If it is the only one in the deploy and it fails to activate it must be set to error. Otherwise retry the deploy and activation separate from others.
            if (dataPackData.dataPacks.length == 1) {
                var onActivateErrorResult = await this.vlocity.datapacksutils.handleDataPackEvent('onActivateError', dataPack.VlocityDataPackType, dataPackData);

                var errorMessage = ' --- Not Activated';

                if (onActivateErrorResult) {
                    if (onActivateErrorResult.ActivationStatus === 'Success') {
                        continue;    
                    }
                    
                    errorMessage = ' --- ' + onActivateErrorResult.message;   
                }

                jobInfo.hasError = true;
                jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Error';
                jobInfo.currentErrors[dataPack.VlocityDataPackKey] = 'Activation Error >> ' + dataPack.VlocityDataPackKey + errorMessage;
                jobInfo.errors.push('Activation Error >> ' + dataPack.VlocityDataPackKey + errorMessage);
                VlocityUtils.error('Activation Error', dataPack.VlocityDataPackKey + errorMessage);

            } else if (attempts < 3) {
                shouldRetry = true;
            } else {
                jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'ReadySeparate';
            }
        } else if (dataPack.ActivationStatus == 'Error') {

            var message = 'Activation Error >> ' +  dataPack.VlocityDataPackKey + ' --- ' + (dataPack.VlocityDataPackMessage ? dataPack.VlocityDataPackMessage : (activateResult.error != 'OK' ? activateResult.error : ''));

            jobInfo.hasError = true;
            jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Error';
            
            jobInfo.currentErrors[dataPack.VlocityDataPackKey] = message;

            if (jobInfo.errors.indexOf(message) == -1) {
                jobInfo.errors.push(message);
            }

            VlocityUtils.error('Activation Error', dataPack.VlocityDataPackKey, dataPack.VlocityDataPackMessage ? dataPack.VlocityDataPackMessage : (activateResult.error != 'OK' ? activateResult.error : ''));
        }
    }

    if (shouldRetry) {
        await this.vlocity.datapacks.ignoreActivationErrors(dataPackData.dataPackId);
        await this.activateAll(dataPackData, jobInfo, attempts+1);      
    }
};

DataPacksJob.prototype.checkDeployInProgress = async function(jobInfo) {
    var notDeployed = [];
    var headers = [];   

    for (var dataPackKey in jobInfo.currentStatus) {
        // Trying to account for failures on other objects
        if (jobInfo.currentStatus[dataPackKey] == 'Added' || jobInfo.currentStatus[dataPackKey] == 'AddedHeader') {
            jobInfo.currentStatus[dataPackKey] = 'ReadySeparate';
        }

        if (jobInfo.currentStatus[dataPackKey] == 'Ready' || jobInfo.currentStatus[dataPackKey] == 'ReadySeparate') {
            notDeployed.push('Not Deployed >> ' + dataPackKey);
        } else if (jobInfo.currentStatus[dataPackKey] == 'Header') {
            notDeployed.push('Not Deployed >> ' + dataPackKey);
            headers.push(dataPackKey);
        } else if (jobInfo.currentStatus[dataPackKey] == 'Added' || jobInfo.currentStatus[dataPackKey] == 'AddedHeader') {
            jobInfo.errors.push('Not Deployed >> ' + dataPackKey);
            jobInfo.hasError = true;
        }
    }

    var hasValidImports = await this.vlocity.datapacksbuilder.hasValidImports(jobInfo.projectPath, jobInfo);

    if (hasValidImports) {
        return true;
    }

    jobInfo.buildImportCachedAlreadyNull = null;

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

DataPacksJob.prototype.deployBulkRecords = async function (dataPack, BulkRecords, jobInfo, objectName, objectKey) {

    var self = this;
    var cnt = 0;
    var randomNum =  Math.random();

    jobInfo.salesforceIdDeleteBatch = new Map();

    // save salesforce ID for each record inserted and create a map
    if (dataPack.VlocityDataPackStatus == 'Success') {
        Object.keys(dataPack).forEach(function (key) {
            if (Array.isArray(dataPack[key])) {
                for (var dprecord of dataPack[key]) {
                    self.vlocity.salesforceIdMap[dprecord.VlocityRecordSourceKey] = dprecord.VlocityRecordSalesforceId;
                }
            }
        });
    }

    //replace foreign key in BulkRecords now
    for (var records of BulkRecords) {
        for (key in records) {
            if (typeof records[key] === 'object') {
                if (records[key].hasOwnProperty('VlocityMatchingRecordSourceKey')) {
                    var salesforceIdMapKey = records[key].VlocityMatchingRecordSourceKey;
                    if(!this.vlocity.namespace){
                        salesforceIdMapKey = salesforceIdMapKey.replace(/%vlocity_namespace%__/g,'');
                    }
                    records[key] = self.vlocity.salesforceIdMap[salesforceIdMapKey];
                }
            }
        }

        if (records.hasOwnProperty('VlocityRecordSourceKey')) {

            self.vlocity.insertIndexToSfIdMap[randomNum + '-' + cnt] = { name: records['VlocityRecordSourceKey'], id: '' };
            cnt++;
            delete records['VlocityRecordSourceKey'];
        }

        //TBD Also add missing fields to the BulkRecords since bulk api expects all the fields of custom_object in the data
    }
    // replace namespace in the BulkRecords fields
    if (self.vlocity.namespace) {
        BulkRecords = JSON.parse(JSON.stringify(BulkRecords).replace(/%vlocity_namespace%__/g, self.vlocity.namespacePrefix));
    }
    else {
        BulkRecords = JSON.parse(JSON.stringify(BulkRecords).replace(/%vlocity_namespace%__/g, ''));
    }

    var result = await self.vlocity.datapacksutils.createBulkJob(objectName, 'insert', BulkRecords, randomNum);

    if (result == 'Batch Upload Error') {
        jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Error';
        jobInfo.hasError = true;
        jobInfo.errors.push('Bulk Job Error ' + dataPack.VlocityDataPackKey);
    }
}

DataPacksJob.prototype.deployPack = async function(inputMap) {
   
    var self = this;
    var jobInfo = inputMap.jobInfo;

    try {
        
        var dataJson = await this.vlocity.datapacksbuilder.buildImport(jobInfo.projectPath, jobInfo);

        if (dataJson == null) {
            return;
        }

        var preStepDeployData = [];

        var allDeploymentKeys = [];

        var allDataPackTypes = []

        for (var dataPack of dataJson.dataPacks) {
            allDeploymentKeys.push(dataPack.VlocityDataPackKey);
            allDataPackTypes.push(dataPack.VlocityDataPackType);

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

        var initialType = dataJson.dataPacks[0].VlocityDataPackType;

        if (!this.vlocity.datapacksutils.isAllowParallelDeploy(initialType)) {
            while (true) {
                if (!jobInfo.parallelStatus[initialType]) {
                    jobInfo.parallelStatus[initialType] = true;
                    break;
                }

                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        VlocityUtils.report('Deploying', allDeploymentKeys.join(','));

        await new Promise(resolve => setTimeout(resolve, 1));

        let result;
        try {
            result = await this.vlocity.datapacks.import(dataJson, this.getOptionsFromJobInfo(jobInfo));
        } catch (e) {
            jobInfo.parallelStatus[initialType] = false;
            throw e;
        }

        jobInfo.parallelStatus[initialType] = false;

        await new Promise(resolve => setTimeout(resolve, 1));

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
                var objectName = self.vlocity.datapacksutils.getBulkJobObjectName(dataPack.VlocityDataPackType);
                var objectKey = self.vlocity.datapacksutils.getBulkJobObjectKey(dataPack.VlocityDataPackType);
                var dataPackKey = JSON.stringify(dataPack.VlocityDataPackKey);

                if (dataPack.VlocityDataPackRelationshipType != 'Pagination') {
                    jobInfo.currentStatus[dataPack.VlocityDataPackKey] = dataPack.VlocityDataPackStatus;
                }

                if (dataPack.VlocityDataPackStatus == 'Success') {
                    if (self.vlocity.datapacksbuilder.savedBulkRecords[dataPackKey]) {
                        await self.deployBulkRecords(dataPack, self.vlocity.datapacksbuilder.savedBulkRecords[dataPackKey], jobInfo, objectName, objectKey);
                        var records = await self.vlocity.datapacksutils.handleDataPackEvent('getUpdatedParentList', dataPack.VlocityDataPackType, {});
    
                        if (records && records.length) {
                            await self.vlocity.datapacksutils.createBulkJob(objectName, 'update', records);
                        }
                    }

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

                        await self.vlocity.datapacksutils.handleDataPackEvent('activateWithJavaScript', dataPack.VlocityDataPackType, { dataPack: dataPack });                        
                        if(jobInfo.versionCompare){
                            let dataField = this.vlocity.datapacksutils.getDataField(dataPack);
                            if (dataField && dataPack.VlocityDataPackData && dataPack.VlocityDataPackData[dataField]) {
                                let datapackId = jobInfo.sourceKeyToRecordId[dataPack.VlocityDataPackData[dataField][0].VlocityRecordSourceKey]
                                jobInfo.VlocityDataPackKeyToUrlMapping[dataPack.VlocityDataPackKey] = {
                                    targetOrgUrl: this.vlocity.utilityservice.getVisualForcePageUrl(dataPack.VlocityDataPackType, datapackId)
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
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    } else { 
                        await this.vlocity.datapacksutils.handleDataPackEvent('onDeployError', dataPack.VlocityDataPackType, {dataPack: dataPack, jobInfo: jobInfo, dataPacks: dataJson.dataPacks});

                        if (jobInfo.currentStatus[dataPack.VlocityDataPackKey] === 'Ready') {
                            thisDeployHasError = false;
                            continue;
                        }

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
                        
                        if (!jobInfo.errorHandling) {
                            jobInfo.errorHandling = {};
                        }
                        
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
        } else {
            allDeploymentKeys.forEach(key => {
                jobInfo.hasError = true;
                jobInfo.currentStatus[key] = 'Error';
                jobInfo.currentErrors[dataPack.VlocityDataPackKey] = `${key} - ${result.message}`;
                jobInfo.errors.push(`${key} - ${result.message}`);
            });
        }

        this.vlocity.datapacksutils.printJobStatus(jobInfo);

        await this.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo);
    } catch (e) {
        if (e.storageError) {
            throw e;
        }

        VlocityUtils.error('Error', 'Deploying Pack', e.stack);
    }
}

DataPacksJob.prototype.deployJob = async function(jobInfo) {

    if (!jobInfo.isRetry) {        
        if (jobInfo.includeSalesforceMetadata) {
            await this.deploySalesforce(jobInfo);
            if (jobInfo.hasError) {
                return;
            }
        }
        
        if (jobInfo.autoUpdateSettings) {
            VlocityUtils.report('Automatically Updating Settings');
            await this.updateSettings(JSON.parse(JSON.stringify(jobInfo)));

            jobInfo.resetFileData = true;
        }

        if (Object.keys(jobInfo.sourceKeyToMatchingKeysData).length === 0) {
            let fullDataPath = jobInfo.projectPath,
            tempJobInfo = JSON.parse(JSON.stringify(jobInfo));
    
            tempJobInfo.singleFile = true;
            tempJobInfo.disablePagination = true;
            tempJobInfo.fullStatus = true;
    
            VlocityUtils.verbose('Getting DataPacks', fullDataPath, tempJobInfo.manifest);
    
            let dataJSON = await this.vlocity.datapacksbuilder.buildImport(fullDataPath, tempJobInfo);

            if (dataJSON && dataJSON.dataPacks) {
                for (var i = 0; i < dataJSON.dataPacks.length; i++) {
                    var dataPack = this.vlocity.utilityservice.getDataPackData(dataJSON.dataPacks[i]);
                    tempJobInfo.sourceKeyToMatchingKeysData = this.vlocity.datapacksutils.traverseEachDatapackForSourceKeyMap(dataPack, tempJobInfo.sourceKeyToMatchingKeysData);
                }
            }
    
            jobInfo.sourceKeyToMatchingKeysData = tempJobInfo.sourceKeyToMatchingKeysData;
            jobInfo.resetFileData = true;
        }

        if (jobInfo.autoFixPicklists) {
            VlocityUtils.report('Automatically Updating Picklists Before Deploy'); 
            var deltaCheckJobInfo = JSON.parse(JSON.stringify(jobInfo));
            await this.runAutoFixPicklists(deltaCheckJobInfo);

            jobInfo.resetFileData = true;
        }

        if (jobInfo.metadataCheck) {
            VlocityUtils.report('Checking for Metadata Before Deploy');
            var deltaCheckJobInfo = JSON.parse(JSON.stringify(jobInfo));
            await this.runMetadataCheck(deltaCheckJobInfo);

            if (deltaCheckJobInfo.deltaCheckResults) {
                for (var dataPackKey in deltaCheckJobInfo.deltaCheckResults) {
                    if (deltaCheckJobInfo.deltaCheckResults[dataPackKey].status == 'Error') {
                        jobInfo.currentStatus[dataPackKey] = 'Error';
                        jobInfo.errors.push(deltaCheckJobInfo.deltaCheckResults[dataPackKey].errorMessage);
                        jobInfo.hasError = true;
                    }
                }
            }
            
            jobInfo.resetFileData = true;
        }

        if (jobInfo.checkStaleObjects) {
            VlocityUtils.report('Checking for Stale Objects Before Deploy');
            var deltaCheckJobInfo = JSON.parse(JSON.stringify(jobInfo));
            await this.runCheckStaleObjects(deltaCheckJobInfo);

            if (deltaCheckJobInfo.deltaCheckResults) {
                for (var dataPackKey in deltaCheckJobInfo.deltaCheckResults) {
                    if (deltaCheckJobInfo.deltaCheckResults[dataPackKey].status == 'Error') {

                        jobInfo.currentStatus[dataPackKey] = 'Error';

                        if (jobInfo.currentStatus[dataPackKey] == 'Error' && deltaCheckJobInfo.deltaCheckResults[dataPackKey].errorMessage) {
                            jobInfo.errors.push(deltaCheckJobInfo.deltaCheckResults[dataPackKey].errorMessage);
                            jobInfo.hasError = true;
                        }
                    }
                }
            }
        
            jobInfo.resetFileData = true;
        }

        if (jobInfo.deltaCheck) {
            VlocityUtils.report('Checking for Changes Before Deploy');
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
    }

    if (jobInfo.shouldSendUpdates == null) {
        jobInfo.shouldSendUpdates = true;
    }

    VlocityUtils.milestone('Deploying Vlocity');

    do {
        var deployPromises = [];
        var maxSeries = 1;

        jobInfo.parallelStatus = {};

        if (jobInfo.supportParallel) {

            Object.keys(jobInfo.currentStatus).forEach(key => {
                if (jobInfo.currentStatus[key] != 'Success') {
                    maxSeries++;
                }
            });
        }

        for (var i = 0; i < maxSeries; i++) {

            deployPromises.push({ 
                    context: this, 
                    func: 'deployPack', 
                    argument: { jobInfo: jobInfo }
                });
        }

        await this.vlocity.utilityservice.parallelLimit(deployPromises, jobInfo.defaultMaxParallel);

    } while (await this.checkDeployInProgress(jobInfo))

    var dataPackTypesAlreadyProcessed = {};

    for (var dataPackKey in jobInfo.currentStatus) {
        var dataPackType = dataPackKey.substring(0, dataPackKey.indexOf("/"));

        if (!dataPackTypesAlreadyProcessed.hasOwnProperty(dataPackType)) {
            dataPackTypesAlreadyProcessed[dataPackType] = '';
            await this.vlocity.datapacksutils.handleDataPackEvent('onDeployFinish', dataPackType, jobInfo);
        }
    }

    if (jobInfo.gitCheck && !jobInfo.hasError) {
        var currentHash = childProcess.execSync(`cd ${jobInfo.projectPath} && git rev-parse HEAD`, { encoding: 'utf8' });
        VlocityUtils.success('Setting Git Hash', currentHash);

        var vbtDeployKey = `VBTDeployKey${jobInfo.gitCheckKey ? jobInfo.gitCheckKey : ''}`;
        await this.vlocity.utilityservice.setVlocitySetting(vbtDeployKey, currentHash);
    }

    await this.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo, true);

    if (jobInfo.hasError && jobInfo.jobAction === 'Deploy' && jobInfo.autoRetryErrors) {
        VlocityUtils.verbose('Retrying Deployment');
        var currentErrors = 0;

        for (var dataPackKey in jobInfo.currentStatus) {
            if (jobInfo.currentStatus[dataPackKey] == 'Error') {
                currentErrors++;
            }
        }

        if (jobInfo.previousErrors === undefined || currentErrors < jobInfo.previousErrors) {
            jobInfo.previousErrors = currentErrors;

            await this.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo, true);
            await this.runJobWithInfo(jobInfo, 'Retry');
        }
    }

    VlocityUtils.milestone('Finalizing Deployment');
};

DataPacksJob.prototype.deployMultipleJob = async function (jobInfo) {
    try {
        if (Array.isArray(jobInfo.multiDeployPaths) && jobInfo.multiDeployPaths.length !== 0) {

            jobInfo.projectPath = path.join(this.vlocity.tempFolder, 'multideploy');
            let destination = path.join(jobInfo.projectPath, jobInfo.expansionPath || '');

            if (fs.existsSync(destination)) {
                await fs.removeSync(destination);
            }

            for (const i in jobInfo.multiDeployPaths) {
                await fs.copy(jobInfo.multiDeployPaths[i], destination);
            }

            await this.deployJob(jobInfo);
        } else {
            throw "Provided multiDeployPaths are invalid."
        }
    }
    catch (err) {
        jobInfo.hasError = true;
        jobInfo.errors.push(err);
        VlocityUtils.error(err);
    }
}

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
        if (!this.vlocity.datapacksutils.getIsDiffable(dataPack.VlocityDataPackType)) {
            jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Success';
            totalUndiffable++;
            jobInfo.diffType[dataPack.VlocityDataPackKey] = 'Undiffable';

            VlocityUtils.warn('Undiffable', dataPack.VlocityDataPackKey + ' - ' + dataPack.VlocityDataPackName);
        } else if (!targetOrgRecordsHash[dataPack.VlocityDataPackKey]) {
                VlocityUtils.warn('New', dataPack.VlocityDataPackType + ' - ' + dataPack.VlocityDataPackKey);
                jobInfo.diffType[dataPack.VlocityDataPackKey] = 'New';
                totalNew++;
        } else {
            var dataPackHash = await this.vlocity.datapacksutils.getDataPackHashable(dataPack, jobInfo);
       
            if (stringify(targetOrgRecordsHash[dataPack.VlocityDataPackKey]) == stringify(dataPackHash)) {
                jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Success';
                totalUnchanged++;
                jobInfo.diffType[dataPack.VlocityDataPackKey] = 'Unchanged';
                
                VlocityUtils.warn('Unchanged', dataPack.VlocityDataPackKey + ' - ' + dataPack.VlocityDataPackName);        
            } else {
                jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Ready';
           
                currentFiles.push(dataPackHash);
                exportedFiles.push(targetOrgRecordsHash[dataPack.VlocityDataPackKey]);

                VlocityUtils.warn('Changes Found', dataPack.VlocityDataPackKey + (dataPack.VlocityDataPackName ? ' - ' + dataPack.VlocityDataPackName : ''));
                jobInfo.diffType[dataPack.VlocityDataPackKey] = 'Changed';
                totalDiffs++;
            }
        }
    }

    VlocityUtils.report('Unchanged', totalUnchanged);
    VlocityUtils.report('Diffs', totalDiffs);
    VlocityUtils.report('New', totalNew);
    VlocityUtils.report('Undiffable', totalUndiffable);

    await Promise.all([
        fs.outputFile(path.join(this.vlocity.tempFolder, 'diffs/localFolderFiles.json'), stringify_pretty(currentFiles, { space: 4 })),
        fs.outputFile(path.join(this.vlocity.tempFolder, 'diffs/targetOrgFiles.json'), stringify_pretty(exportedFiles, { space: 4 }))
    ]);
};

DataPacksJob.prototype.getDiffs = async function(jobInfo) {
    
    jobInfo.cancelDeploy = true;
    jobInfo.failIfHasDiffs = jobInfo.jobAction == 'GetDiffsCheck';

    await this.getDiffsAndDeploy(jobInfo);
};

DataPacksJob.prototype.diffPacks = async function(jobInfo) {
    var sourceData = jobInfo.sourceData;
    var targetData = jobInfo.targetData.dataPacks;
    var allTargetDataPacks = {};

    for (var dataPack of targetData) {

        if (!jobInfo.specificManifestKeys || jobInfo.specificManifestKeys.includes(dataPack.VlocityDataPackKey)) {
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
        
        try {
            fs.removeSync(path.join(this.vlocity.tempFolder, 'diffs'));
        } catch (e) {
            VlocityUtils.error('Cannot Remove Directories', path.join(this.vlocity.tempFolder, 'diffs'));
        }

        if (!jobInfo.manifest) {
            
            var getManifestJobInfo = JSON.parse(JSON.stringify(jobInfo));

            await this.vlocity.datapacksbuilder.initializeImportStatus(getManifestJobInfo.projectPath + '/' + getManifestJobInfo.expansionPath, getManifestJobInfo);

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

        for (var dataPack of currentFileData.dataPacks) {
            allTargetDataPacks[dataPack.VlocityDataPackKey] = dataPack;

            // Iterate over this and hash each individual 1 as JSON
           // targetOrgRecordsHash[dataPack.VlocityDataPackKey] = await this.vlocity.datapacksutils.getDataPackHashable(dataPack, jobInfo);
        }
    } else {
        VlocityUtils.error('No DataPacks Found');
    }

    jobInfo.projectPath = jobInfo.savedProjectPath;
    jobInfo.expansionPath = jobInfo.savedExpansionPath;

    await this.vlocity.datapacksutils.saveCurrentJobInfo(jobInfo);

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

   // this.checkDiffs(jobInfo, checkDiffsFile, targetOrgRecordsHash);

    var sourceDataByKey = {};

    checkDiffsFile.dataPacks.forEach(function(dataPack) {
        sourceDataByKey[dataPack.VlocityDataPackKey] = dataPack;
    });

    await this.vlocity.datapacksutils.getFieldDiffs(sourceDataByKey, allTargetDataPacks, jobInfo);

    jobInfo.errors = [];
    jobInfo.hasError = false;
    jobInfo.singleFile = false;
    jobInfo.jobAction = 'Deploy';

    for (var dataPackKey in jobInfo.currentStatus) {
        if (jobInfo.diffType[dataPackKey] != 'Unchanged') { 

            jobInfo.currentStatus[dataPackKey] = 'Ready';
            
            if (jobInfo.failIfHasDiffs) {
                jobInfo.errors.push(dataPackKey + ' Changed');
                jobInfo.hasError = true;
            }
        }
        
        VlocityUtils.warn('Diff Status', jobInfo.diffType[dataPackKey], dataPackKey);
    }

    if (!jobInfo.cancelDeploy) {
        await this.runJobWithInfo(jobInfo, jobInfo.jobAction);
    }
};

DataPacksJob.prototype.cleanOrgData = async function(jobInfo) {
    await this.vlocity.utilityservice.matchingKeysCheckUpdate(jobInfo);
    jobInfo.javascript = 'cleanData.js';
    await this.reExpandAllFilesAndRunJavaScript(jobInfo);
    //await this.vlocity.datapacksutils.runApex(jobInfo.projectPath, 'RemoveOldAttributeAssignments.cls', []);
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

    VlocityUtils.verbose('Getting DataPacks', fullDataPath, jobInfo.manifest);

    let dataJson = await this.vlocity.datapacksbuilder.buildImport(fullDataPath, jobInfo);

    if (!dataJson) {
        dataJson = {};
    }

    if (!dataJson.dataPacks) {
        dataJson.dataPacks = [];
    }
    
    if (jobInfo.includeSalesforceMetadata) {
        
        await this.vlocity.datapacksutils.getSfdxData(jobInfo);

        for (var dataPack of jobInfo.sfdxData) {
            dataJson.dataPacks.push(dataPack);
            
            let dataPackInfoForManifest = this.vlocity.datapacksutils.getAsManifestInfo(dataPack);

            jobInfo.dataPackDisplayLabels[dataPackInfoForManifest.key] = dataPackInfoForManifest.label;

            if (!jobInfo.currentStatus[dataPackInfoForManifest.key]) {
                jobInfo.currentStatus[dataPackInfoForManifest.key] = "Added";
            }
        }
    }
 
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
    VlocityUtils.log('Running All JavaScript', jobInfo.javascript);

    if (typeof jobInfo.javascript == 'string') {
        await this.vlocity.datapacksutils.runJavaScript(jobInfo.projectPath, jobInfo.javascript, null, jobInfo);
    } else {
        var fullDataPath = jobInfo.projectPath;

        jobInfo.singleFile = true;
        jobInfo.disablePagination = true;
        jobInfo.compileOnBuild = false;
        jobInfo.fullStatus = true;

        VlocityUtils.verbose('Getting DataPacks', fullDataPath, jobInfo.manifest);

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

        if (!jobInfo.skipExpand) { 
            await this.vlocity.datapacksexpand.expand(jobInfo.projectPath + '/' + jobInfo.expansionPath, dataJson, jobInfo);
        }
    }
};

DataPacksJob.prototype.runApex = async function(jobInfo) {
    
    VlocityUtils.report('Running Apex', jobInfo.apex);

    await this.vlocity.datapacksutils.runApex(jobInfo.folder ? jobInfo.folder : jobInfo.projectPath, jobInfo.apex, []);
};

DataPacksJob.prototype.retrieveSalesforce = async function(jobInfo) {
    await this.vlocity.datapacksutils.retrieveSalesforce(jobInfo);
}

DataPacksJob.prototype.deploySalesforce = async function(jobInfo) {
    VlocityUtils.milestone('Deploying Salesforce Metadata');
    await this.vlocity.datapacksutils.deploySalesforce(jobInfo);
}

DataPacksJob.prototype.rmdirCustom = async function (dir) {
    var list = fs.readdirSync(dir);
    for (var i = 0; i < list.length; i++) {
        var filename = path.join(dir, list[i]);
        var stat = fs.statSync(filename);

        if (filename == "." || filename == "..") {
            // pass these files
        } else if (stat.isDirectory()) {
            // rmdir recursively
            this.rmdirCustom(filename);
        } else {
            // rm fiilename
            fs.unlinkSync(filename);
        }
    }
    fs.rmdirSync(dir);
};

DataPacksJob.prototype.downloadVplDatapack = async function (jobInfo) {
    var deletedOnce = false;
    let VplAssetRecords;
    let vplAttachmentRecords;
    let vplName = jobInfo.VplName;
    var query;
    var result;
    try {

        if (vplName.includes("---")) {
            vplName = vplName.split("---").join("/");
        }

        query = "SELECT VPL_Asset__c FROM VlocityProcessAssetAssociation__c WHERE VPL_Listing__r.Name = '" + vplName + "' AND VPL_Asset__r.Type__c='JSON DataPack' AND VPL_Asset__r.Active__c=true";
        result = await this.vlocity.jsForceConnection.query(query);

        if (result) {
            VplAssetRecords = result.records;
            jobInfo.data = result;
        }

        for (res in VplAssetRecords) {
            query = "SELECT Name, Body FROM Attachment WHERE ParentId = '" + VplAssetRecords[res].VPL_Asset__c + "'";
            result = await this.vlocity.jsForceConnection.query(query);
            if (result) {
                vplAttachmentRecords = result.records;
            }

            for (record in vplAttachmentRecords) {
                let fileName = vplAttachmentRecords[record].Name;
                let folderName = jobInfo.VplName;

                if (fileName.includes("/")) {
                    fileName = fileName.split("/").join("-");
                }

                var folderPath = path.join(jobInfo.projectPath, folderName);

                var filepath = path.join(folderPath, fileName);

                if (fs.existsSync(folderPath) && deletedOnce === false) {
                    deletedOnce = true;
                    await this.rmdirCustom(folderPath);
                }

                await fs.ensureDirSync(folderPath);

                let attachmentBody = await this.vlocity.jsForceConnection.request(vplAttachmentRecords[record].Body);
                var filePtr = await fs.openSync(filepath, 'w');
                await fs.writeSync(filePtr, JSON.stringify(attachmentBody));
                await fs.closeSync(filePtr);
                let jobInfo_t = JSON.parse(JSON.stringify(jobInfo));
                jobInfo_t.buildFile = filepath;
                jobInfo_t.expansionPath = 'datapacks';
                await this.expandFile(jobInfo_t);
            }
        }
    }
    catch (err) {
        jobInfo.hasError = true;
        jobInfo.errors.push(err);
        VlocityUtils.error('Error Downloading VPL', err);
    }
}

DataPacksJob.prototype.refreshVlocityProcessListing = async function (jobInfo) {
    var VplList;
    var query;
    var result;
    jobInfo.data = [];

    try {
        var query = "SELECT VPL_Listing__r.Name  FROM VlocityProcessAssetAssociation__c WHERE VPL_Asset__c IN (SELECT Id FROM Vlocity_Process_Asset__c WHERE Active__c=true AND Type__c='JSON DataPack')";
        var result = await this.vlocity.jsForceConnection.query(query);

        if (result) {
            VplList = result.records.map(item => {
                return item.VPL_Listing__r.Name;
            });
        }

        for (item in VplList) {
            if (VplList[item].includes("/")) {
                VplList[item] = VplList[item].split("/").join("---");
            }
            if(jobInfo.data.indexOf(VplList[item]) === -1) {
                jobInfo.data.push(VplList[item]);
            }
        }
    }
    catch (err) {
        VlocityUtils.error('Error Refreshing Process Listing', err.stack);
        jobInfo.hasError = true;
        jobInfo.errors.push(err);
    }
}

DataPacksJob.prototype.downloadPerformanceData = async function (jobInfo) {
    return new Promise(async (resolve, reject) => {
        
        var field_name = this.vlocity.namespace +'__Data__c';
        var query = `SELECT ${field_name},CreatedBy.Username,CreatedBy.Profile.Name FROM ${this.vlocity.namespace}__VlocityTrackingEntry__c WHERE Name = 'StepActionTime' ORDER BY CreatedDate DESC`;
        var records = [];

        VlocityUtils.milestone('Downloading Performance Data');

        var totalEntries = await this.vlocity.jsForceConnection.query(`SELECT count() FROM ${this.vlocity.namespace}__VlocityTrackingEntry__c WHERE Name = 'StepActionTime'`);

        if (totalEntries.totalSize == 0) {
            jobInfo.hasError = true;
            jobInfo.errors.push('No Tracking Entries Found');
            return resolve();
        }

        var i = 0;

        var self = this;

        this.vlocity.jsForceConnection.query(query)
            .on("record", function (record) {
                i++;
                if ((i % 500) == 0) {
                    VlocityUtils.log(`${i} of ${totalEntries.totalSize}`);
                }
                
                records.push(record);
            })
            .on("end", async function () {

                let omni_id = records.map(item => {
                    return JSON.parse(item[field_name]).OmniScriptId;
                });

                VlocityUtils.log(`${i} of ${totalEntries.totalSize}`);

                let unique_omni_id = Array.from([...new Set(omni_id)]);

                let res = [];

                let elements = new Map();

                let keys = ["preTransformBundle", "postTransformBundle", "sendJSONNode", "sendJSONPath", "responseJSONNode", "responseJSONPath", "useQueueableApexRemoting", "remoteTimeout",
                    "sendJSONNode", "sendJSONPath", "responseJSONNode", "responseJSONPath", "cacheType", "chainOnStep", "failOnStepError", "scheduledJobId", "remoteOptions.configurationName",
                    "bundle", "emailTemplateInformation.emailTemplateName", "restPath", "restMethod", "namedCredential", "type", "retryCount", "xmlPreTransformBundle", "xmlPostTransformBundle",
                    "machineDeveloperName", "integrationProcedureKey", "useContinuation", "remoteOptions.useQueueable", "remoteOptions.useFuture", "remoteOptions.chainable", "remoteOptions.queueableChainable",
                    "remoteOptions.matrixName", "Type", "Sub Type", "Language", "preIP", "postIP", "remoteClass", "remoteMethod", "returnFullDataJSON"];

                while (unique_omni_id.length > 0) {
                    try{
                        let chunk = unique_omni_id.splice(0, 150);
                        let unique_omni_id_format = "";

                        chunk.forEach(omniId => {
                            if (omniId) {
                                unique_omni_id_format += `'${omniId}',`;
                            }
                        });
                        if (unique_omni_id_format) {
                            unique_omni_id_format = unique_omni_id_format.slice(0, -1);

                            let additional_data = await self.vlocity.jsForceConnection.query(`SELECT ${self.vlocity.namespace}__PropertySet__c,Name,${self.vlocity.namespace}__Type__c,${self.vlocity.namespace}__OmniScriptId__c 
                                        FROM ${self.vlocity.namespace}__Element__c WHERE ${self.vlocity.namespace}__OmniScriptId__c IN (${unique_omni_id_format})`);

                            additional_data.records.map(item => {
                                elements[item['Name'] + item[self.vlocity.namespace + '__OmniScriptId__c']] = item;
                            });
                        }
                    } catch(err){
                        VlocityUtils.verbose('Malformed Query', err);
                    }
                }

                records.map(item => {
                    try {
                        let element_data = JSON.parse(item[field_name])
                        var element_name = element_data.ElementName;
                        let element_omniScript_id = element_data.OmniScriptId;
                        let key = element_name + element_omniScript_id;

                        if (!element_data.VlocityInteractionToken) {
                            element_data.VlocityInteractionToken = element_data.Timestamp;
                        }

                        element_data.Username = item.CreatedBy.Username;
                        element_data.UserProfile = item.CreatedBy.Profile.Name;

                        if (elements[key]) {                        
                            let propertyset = JSON.parse(elements[key][self.vlocity.namespace + '__PropertySet__c']);
                            var element_type = elements[key][self.vlocity.namespace + '__Type__c'];

                            keys.map(k => {            
                                if (k.indexOf('.') != -1) {
                                    let i = k.split('.');

                                    if ((propertyset[i[0]] !== "") && (propertyset[i[0]] !== undefined)) {
                                        if ((propertyset[i[0]][i[1]] !== "") && (propertyset[i[0]][i[1]] !== undefined)) {
                                            element_data[i[1]] = propertyset[i[0]][i[1]];
                                        }
                                    }
                                } else if ((propertyset[k] !== "") && (propertyset[k] !== undefined)) {
                                    element_data[k] = propertyset[k];
                                }
                            });

                            if (!item.ElementType) {
                                element_data.ElementType = element_type
                            }
                           
                            res.push(JSON.stringify(element_data));
                        } else {
                            res.push(JSON.stringify(element_data));
                        }
                    } catch (e) {
                        res.push(item[field_name]);
                    }
                });

                if (res.length > 0) {
                    fs.outputFileSync(jobInfo.projectPath, JSON.stringify(res));
                    jobInfo.data = res;
                    jobInfo.hasError = false;
                } else {
                    jobInfo.hasError = true;
                    jobInfo.errors.push('No Tracking Entries Found');
                }

                resolve();
            })
            .on("error", function (err) {
                VlocityUtils.error('Error Getting Tracking Entries', err);
                reject();
            })
            .run({ autoFetch: true, maxFetch: 1000000 });
    });
}

DataPacksJob.prototype.getUserNameFromUserId = async function (jobInfo) {
    var query;
    var result;
    var records = [];
    jobInfo.data = [];
    var userIds = jobInfo.userIdList;
    var userIdList = "";

    for (let j = 0; j < userIds.length; j++) {
        if (j == (userIds.length - 1)) {
            userIdList = userIdList + `'${userIds[j]}'`
        } else {
            userIdList = userIdList + `'${userIds[j]}',`;
        }
    }

    try {
        query = `SELECT Id, Name FROM User where Id IN (${userIdList})`;
        result = await this.vlocity.jsForceConnection.query(query);
        records = result.records;
        jobInfo.data = records;
    }
    catch (err) {
        VlocityUtils.verbose('Error occurred while fetching the usernames', err);
        jobInfo.hasError = true;
        jobInfo.errors.push(err);
    }
}

DataPacksJob.prototype.getOrgProjects = async function (jobInfo) {
    try {
        let query = `SELECT Name, RecordType.Name FROM ${this.vlocity.namespacePrefix}Project__c WHERE ${this.vlocity.namespacePrefix}IsActive__c = true AND ${this.vlocity.namespacePrefix}Status__c IN ('Released') AND (RecordType.DeveloperName = 'WorkSet' OR RecordType.DeveloperName = 'Module')`;
        let result = await this.vlocity.jsForceConnection.query(query);
        jobInfo.data = result.records.map(item => {
            return {
                label: item.Name,
                value: item.Name,
                recordType: item.RecordType.Name
            };
        });
    }
    catch (err) {
        VlocityUtils.verbose('Error occurred while fetching the projects from org', err);
        jobInfo.hasError = true;
        jobInfo.errors.push(err);
    }
}

DataPacksJob.prototype.getTrackingEntryUrl = async function (jobInfo) {
    try {
        let actionsConfig = this.vlocity.datapacksutils.dataPacksExpandedDefinition.IPActionsConfig;
        let orgUrl = '';
        let entry = jobInfo.trackingEntry;
        if (actionsConfig[entry.ElementType]) {
            let config = actionsConfig[entry.ElementType];
            let dataFieldValue = config.dataField.split('.').reduce(function (currentNameObj, key) {
                return currentNameObj[key];
            }, entry)

            let query = config.query.replace(/%vlocity_namespace%__/g, this.vlocity.namespacePrefix).replace(/%dataFieldValue%/g, dataFieldValue);
            let results = await this.vlocity.jsForceConnection.query(query);
            if (results.records[0] && results.records[0].Id) {
                orgUrl = this.vlocity.utilityservice.getVisualForcePageUrl(config.type, results.records[0].Id);
            }
        }
        jobInfo.data = orgUrl;
    } catch (err) {
        VlocityUtils.verbose('Error occurred while opening browser', err);
        jobInfo.hasError = true;
        jobInfo.errors.push(err);
    }
}

DataPacksJob.prototype.datapackOpen = async function (jobInfo) {
    try {
        for (const obj of jobInfo.queries) {
            if (obj.VlocityDataPackType === jobInfo.type) {
                let query = obj.query.replace(/%vlocity_namespace%__/g, this.vlocity.namespacePrefix);
                query += query.includes('WHERE') ? ` AND Name = '${jobInfo.name}'` : ` Where Name = '${jobInfo.name}'`;
                let results = await this.vlocity.jsForceConnection.query(query);
                if (results.records[0] && results.records[0].Id) {
                    jobInfo.data = results.records;
                    open(this.vlocity.jsForceConnection.instanceUrl + this.vlocity.utilityservice.getVisualForcePageUrl(jobInfo.type, results.records[0].Id), { wait: false });
                } else {
                    throw (`DataPack named ${jobInfo.name} does not exist.`)
                }
                break;
            }
        }
    } catch (err) {
        VlocityUtils.verbose('Error occurred while opening datapack in designer', err);
        jobInfo.hasError = true;
        jobInfo.errors.push(err);
    }
}