var yaml = require('js-yaml');
var fs = require('fs-extra');
var path = require('path');
var async = require('async');
var nopt = require('nopt');
var vlocity = require('./vlocity.js');
var properties = require('properties');
var stringify = require('json-stable-stringify');
var semver = require('semver')

var VLOCITY_COMMANDLINE_OPTIONS = {
    "activate": Boolean,
    "addSourceKeys": Boolean,
    "apex": String,
    "buildFile": String,
    "compileOnBuild": Boolean,
    "defaultMaxParallel": Number,
    "expansionPath": String,
    "folder": String,
    "id": String,
    "ignoreAllErrors": Boolean,
    "javascript": String,
    "job": String,
    "key": String,
    "manifestOnly": Boolean,
    "maxDepth": Number,
    "maximumDeployCount": Number,
    "projectPath": String,
    "propertyfile": String,
    "query": String,
    "sf.instanceUrl": String,
    "sf.loginUrl": String,
    "sf.password": String,
    "sf.sessionId": String,
    "sf.accessToken": String,
    "oauthConnection": Boolean,
    "sf.username": String,
    "sfdx.username": String,
    "supportForceDeploy": Boolean,
    "supportHeadersOnly": Boolean,
    "test": String,
    "type": String,
    "useAllRelationships": Boolean,
    "verbose": Boolean,
    "performance": Boolean,
    "vlocity.dataPacksJobFolder": String,
    "vlocity.namespace": String,
    "ignoreJobFailures": Boolean,
    "json": Boolean,
    "manifest": String,
    "queryAll": Boolean,
    "json-test": Boolean,
    "nojob": Boolean,
    "sandbox": Boolean,
    "json-pretty": Boolean,
    "version": Boolean,
    "quiet": Boolean,
    "simpleLogging": Boolean,
    "useVlocityTriggers": Boolean,
    "fixLocalGlobalKeys": Boolean,
    "skipRefresh": Boolean,
    "tempFolder": String,
    "source": String,
    "target": String,
    "refresh": Boolean,
    "revertByKey": String,
    "force": Boolean,
    "deltaCheck": Boolean,
    "gitCheck": Boolean,
    "includeSalesforceMetadata": Boolean,
    "sfdxExpandFolder": String,
    "checkStaleObjects": Boolean,
    "deleteSfdxProject": Boolean,
    "autoRetryErrors": Boolean,
    "refreshSource": Boolean,
    "refreshTarget": Boolean,
    "discardSObjectByKey": String,
    "resetDiffs": Boolean,
    "autoDeployDependencies": Boolean,
    "enableFullGitSupport": Boolean,
    "commitMessage": String,
    "currentBranch": String,
    "targetBranch": String,
    "gitRemoteUrl": String,
    "localRepoPath": String,
    "fileName": String
};

var VLOCITY_COMMANDLINE_OPTIONS_SHORTHAND = {
    "depth": [ "-maxDepth" ],
    "js": [ "-javascript" ],
    "ijf": [ "-ignoreJobFailures" ],
    "all": [ "-queryAll" ],
    "perf": ["-performance"],
    "u": ["-sf.username"],
    "p": ["-sf.password"],
    "q": ["-quiet"],
    "disableVlocityTriggers": ["-useVlocityTriggers", "false"]
};

var VLOCITY_COMMANDLINE_OPTIONS_DEFAULTS = {
    tempFolder: './vlocity-temp/',
    source: 'local',
    target: 'local'
};

VLOCITY_COMMANDLINE_COMMANDS = {
    packExport: {
        name: 'Export',
        description: 'Export all DataPacks'
    },
    packExportSingle: {
        name: 'ExportSingle',
        description: 'Export a Single DataPack'
    },
    packExportAllDefault: {
        name: 'ExportAllDefault',
        description: 'Export All Default DataPacks'
    },
    packDeploy: {
        name: 'Deploy',
        description: 'Deploy all DataPacks'
    },
    cleanOrgData: {
        name: 'CleanOrgData',
        description: 'Run Scripts to Clean Data in the Org and Add Global Keys to SObjects missing them'
    },
    validateLocalData: {
        name: 'ValidateLocalData',
        description: 'Check for Missing Global Keys in Local Data. Use argument --fixLocalGlobalKeys to additionally add missing or change duplicate keys.'
    },
    refreshProject: {
        name: 'RefreshProject',
        description: 'Refresh the Project\'s Data to the latest format for this tool'
    },
    packRetry: {
        name: 'Retry',
        description: 'Continue Running a DataPacks Job Resetting Errors to Ready'
    },
    packContinue: {
        name: 'Continue',
        description: 'Continue a DataPack Job'
    },
    packUpdateSettings: {
        name: 'UpdateSettings',
        description: 'Update the DataPack Settings in your Org'
    },
    packGetDiffs: {
        name: 'GetDiffs',
        description: 'Find all Diffs in Org Compared to Local Files'
    },
    packGetDiffsAndDeploy: {
        name: 'GetDiffsAndDeploy',
        description: 'Find all Diffs then Deploy only the Changed DataPacks'
    },
    packGetDiffsCheck: {
        name: 'GetDiffsCheck',
        description: 'Find all Diffs in Org Compared to Local Files and fail if any found'
    },
    packBuildFile: {
        name: 'BuildFile',
        description: 'Build a DataPack File from all DataPacks'
    },
    packGetAllAvailableExports: {
        name: 'GetAllAvailableExports',
        description: 'Get list of all DataPacks that can be exported'
    },
    refreshVlocityBase: {
        name: 'RefreshVlocityBase',
        description: 'Deploy and Activate the Vlocity Authored Cards and Templates included in the Managed Package'
    },
    installVlocityInitial: {
        name: 'InstallVlocityInitial',
        description: 'Deploy and Activate all the initial Vlocity DataPacks included in the Managed Package' 
    },
    runApex: {
        name: 'Apex',
        description: 'Run Anonymous Apex'
    }, 
    runJavaScript: {
        name: 'JavaScript',
        description: 'Run JavaScript on all DataPacks in the Project then recreate the files'
    },
    runTestJob: {
        name: 'runTestJob',
        description: 'Test all commands in the Vlocity Build Project'
    }, 
    runValidationTest: {
        name: 'RunValidationTest',
        description: 'Run validation test'
    }, 
    deltaCheck: {
        name: 'DeltaCheck',
        description: 'Delta Check'
    },
    help: {
        name: 'help',
        description: 'Get all commands for Vlocity Build'
    },
    packExpandFile: {
        name: 'ExpandFile',
        description: 'Expand a File'
    },
    packBuildManifest: {
        name: 'BuildManifest',
        description: 'Build Manifest'
    },
    compare: {
        name: 'Compare',
        description: 'Compare'
    },
    migrate: {
        name: 'Migrate',
        description: 'Migrate'
    },
    revertChange: {
        name: 'RevertChange',
        description: 'RevertChange'
    },
    deltaMigrate: {
        name: 'DeltaMigrate',
        description: 'DeltaMigrate'
    },
    getAvailable: {
        name: 'GetAvailable',
        description: 'GetAvailable'
    },
    checkStaleObjects: {
        name: 'CheckStaleObjects',
        description: 'CheckStaleObjects'
    },
    retrieveSalesforce: {
        name: 'RetrieveSalesforce',
        description: 'None'
    },
    deploySalesforce: {
        name: 'DeploySalesforce',
        description: 'None'
    }/*,
    runGitInit: {
        name: 'GitInit',
        description: 'Initializes the git repo'
    },
    runGitCommit: {
        name: 'GitCommit',
        description: 'Commit the files'
    },
    runGitClone: {
        name: 'GitClone',
        description: 'Clone the git repository'
    },
    runGitCheckoutBranch: {
        name: 'GitCheckoutBranch',
        description: 'switch to a new branch'
    },
    runGitPush: {
        name: 'GitPush',
        description: 'Pushes the changes to the git repo'
    }*/
};

VlocityCLI = module.exports = function () {
    this.passedInOptions = {};
    this.properties = {};
    this.responseFormat = 'JSON';
    this.isCLI = false;
    this.basedir = process.env.PWD;
    
    if (!this.basedir) {
        this.basedir = process.cwd();
    }

    return this;
}

VlocityCLI.prototype.optionOrProperty = function(key) {
    return this.passedInOptions[key] ? this.passedInOptions[key] : this.properties[key];
}

VlocityCLI.prototype.formatResponseCLI = function(response) {
    var self = this;

    // { "status": "", "message":"", "result":"", data: {}, action: "" }
    if (self.responseFormat == 'JSON') {
        // First 2 account for issues in the CLI Runner
        if (response instanceof Error) {
            return { exitCode: 1, print: JSON.stringify({ status: 'error', message: response.stack ? response.stack : response.message, result: response }, null, self.isJsonPretty ?  4 : null)}; 
        } else if (typeof response == 'string') {
            return { exitCode: 1, print: JSON.stringify({ message: response, status: 'error', result: null }, null, self.isJsonPretty ? 4 : null)}; 
        } else {
            return { exitCode: 0, print: JSON.stringify(response, null, self.isJsonPretty ? 4 : null)};
        }
    } else if (response instanceof Error) {
        return { exitCode: 1, print: response.stack ? response.stack : response.message };
    } else if (typeof response == 'string') {
        return { exitCode: 1, print: response};
    }

    if (response.message && response.action) {
        return { exitCode: response.status == 'success' ? 0 : 1, print: response.action + ' ' + response.status + ':\n' + response.message };
    }

    if (response.message) {
        return { exitCode: response.status == 'success' ? 0 : 1, print: response.message };
    }

    return { exitCode: response.status == 'success' ? 0 : 1, print: response };
}

VlocityCLI.runCLI = async function() {
    process.exitCode = 1; 

    if (!semver.satisfies(process.version, '>=10')) {
        console.error('Error: Vlocity Requires Node Version 10 or higher');
        process.exitCode = 1;
        return;
    }
    
    var commandLineOptions = nopt(VLOCITY_COMMANDLINE_OPTIONS, VLOCITY_COMMANDLINE_OPTIONS_SHORTHAND, process.argv, 2);

    commands = commandLineOptions.argv.remain;

    let vlocity_cli = new VlocityCLI();

    try {
        let result = await vlocity_cli.runCommands(commands, commandLineOptions);

        if (result.print && !VlocityUtils.quiet) {
            console.log(result.print);
        }
        
        process.exitCode = result.exitCode;
    } catch (e) {
        process.exitCode = 1;

        if (commandLineOptions['json']) {
            console.log(JSON.serialize({ status: 'error', message: e }));
        } else {
            console.log('Error', e);
        }
    }
}

VlocityCLI.prototype.runCommands = async function(commands, options) {
    var self = this;

    self.passedInOptions = options;
    if (!Array.isArray(commands)) {
        commands = [ commands ];
    }

    if (self.optionOrProperty('json') 
    || self.optionOrProperty('json-pretty')) {
        self.responseFormat = 'JSON';
        VlocityUtils.showLoggingStatements = self.optionOrProperty('json-test') || false;
        self.isJsonCLI = true;
    } else {
        self.responseFormat = 'CONSOLE';
    }
    
    VlocityUtils.quiet = self.optionOrProperty('quiet') || false;
    VlocityUtils.simpleLogging = self.optionOrProperty('simpleLogging') || false;
    VlocityUtils.verboseLogging = self.optionOrProperty('verbose') || false;
    VlocityUtils.showLoggingStatements = VlocityUtils.quiet || !self.isJsonCLI || self.optionOrProperty('json-test');
    VlocityUtils.noErrorLogging = self.optionOrProperty('ignoreJobFailures') || false;

    VlocityUtils.log('Vlocity Build v' + VLOCITY_BUILD_VERSION);

    self.isJsonPretty = self.optionOrProperty('json-pretty') || self.optionOrProperty('json-test') || false;

    VlocityUtils.verbose('Verbose Logging Enabled');
    VlocityUtils.verbose('Commands', commands);
    VlocityUtils.verbose('Original Options', self.passedInOptions.argv.original);

    if (commands.length == 0) {
        if (self.responseFormat == 'JSON') {
            return self.formatResponseCLI({ message: 'Vlocity Build', records: [], action: 'none', status: 'success' });
        } else {
            return '';
        }
    } else if (commands[0] == 'help') {
        VlocityUtils.log('All available commands:');
        Object.keys(VLOCITY_COMMANDLINE_COMMANDS).forEach(function(command) {  
            VlocityUtils.log(command, VLOCITY_COMMANDLINE_COMMANDS[command].description);
        });
        if (self.responseFormat == 'JSON') {
            return self.formatResponseCLI({ message: 'Commands', records: Object.values(VLOCITY_COMMANDLINE_COMMANDS), action: 'help', status: 'success' });
        } else {
            return '';
        }
    }
    
    // Check to see if Propertyfile
    var propertyfile = self.optionOrProperty('propertyfile');

    if (!propertyfile && self.isCLI) {
        if (fs.existsSync('build.properties')) {
            propertyfile = 'build.properties';
        }
    }

    if (propertyfile) {
        try {
            self.properties = properties.parse(fs.readFileSync(propertyfile, 'utf8'));
        } catch (e) {
            if (!fs.existsSync(propertyfile)) {
                VlocityUtils.error('Error', 'propertyfile not found:', propertyfile);

                return self.formatResponseCLI({ message: 'propertyfile not found: ' + propertyfile + '\n' + (VlocityUtils.verbose ? e.stack : e.message), status: 'error' });
            } else {
                VlocityUtils.error('Error', 'Error loading properties from file:', propertyfile);

                return self.formatResponseCLI({ message: 'Could not load properties from file ' + propertyfile, stack: 'Error loading properties from file: ' + propertyfile + '\n' + (VlocityUtils.verbose ? e.stack : e.message), status: 'error' });
            }
        }
    }

    var jobName = self.optionOrProperty('job');

    if (!jobName) {
        jobName = self.optionOrProperty('vlocity.dataPackJob');
    }

    if (self.optionOrProperty('sandbox')) {
        self.properties['sf.loginUrl'] = 'https://test.salesforce.com';
    }

    var dataPacksJobFolder = self.optionOrProperty('vlocity.dataPacksJobFolder');

    if (!dataPacksJobFolder) {
        dataPacksJobFolder = 'dataPacksJobs';
    }

    if (commands[0] == 'runTestJob') {
        jobName = 'TestJob';
        dataPacksJobFolder = path.join(__dirname, '..', 'dataPacksJobs');
    }

    var dataPacksJobData = {};

    if (commands.indexOf('packUpdateSettings') != -1) {
        if (!jobName && commands.length == 1) {
            dataPacksJobData.jobName = 'UpdateSettings';
        }
    }

    var noJob = self.optionOrProperty('nojob');

    if (noJob) {
        dataPacksJobData.jobName = 'nojob';
    }

    VlocityUtils.verbose('DataPacksJob Data', dataPacksJobData);

    try {
        if (jobName && !dataPacksJobData.jobName) {

            var searchFolders = [
                '/',
                '.',
                path.resolve(dataPacksJobFolder),
                path.resolve(__dirname, '..', dataPacksJobFolder)
            ];

            var jobfileName = searchFolders
                .map(folderName => path.join(folderName, jobName.indexOf('.yaml') > -1 ? jobName : jobName + '.yaml'))
                .find(fileName => fs.existsSync(fileName));

            if (!jobfileName) {
                return self.formatResponseCLI({ message: 'Job File not found: ' + jobName, status: 'error' });
            }

            dataPacksJobData = yaml.safeLoad(fs.readFileSync(jobfileName, 'utf8'));
            dataPacksJobData.jobName = jobName;

            if (dataPacksJobData.VBTRequiredVersion && dataPacksJobData.VBTRequiredVersion != VLOCITY_BUILD_VERSION) {
                throw `Must Use Vlocity Build Tool version: ${requiredVersion} - Use npm install -g vlocity@${requiredVersion}`;
            }

            VlocityUtils.simpleLogging = dataPacksJobData.simpleLogging || VlocityUtils.simpleLogging;
        }
    } catch (e) {
        VlocityUtils.log('Error Loading Job: ' + e.message);
        return self.formatResponseCLI(e); 
    }

    var finalResult;

    self.passedInOptionsOverride = {};

    Object.keys(VLOCITY_COMMANDLINE_OPTIONS).forEach(function(key) {
        if (key.indexOf('sf.') == -1 && self.passedInOptions[key] != null) {

            if (dataPacksJobData) {
                dataPacksJobData[key] = self.passedInOptions[key];
            }

            self.passedInOptionsOverride[key] = self.passedInOptions[key];
        }
    });

    for (var defaultOption in VLOCITY_COMMANDLINE_OPTIONS_DEFAULTS) {
        if (dataPacksJobData && dataPacksJobData[defaultOption] == null) {
            dataPacksJobData[defaultOption] = VLOCITY_COMMANDLINE_OPTIONS_DEFAULTS[defaultOption];
        }
    }

    if (commands[0] == 'runTestJob') {
        let testResult = await self.runTestJob(dataPacksJobData);
        return self.formatResponseCLI(testResult);
    }

    for (var command of commands) {

        if (VLOCITY_COMMANDLINE_COMMANDS[command]) {
            command = VLOCITY_COMMANDLINE_COMMANDS[command].name;
        } else {
            finalResult = 'Command not found ' + command;
        }

        finalResult = await self.runJob(JSON.parse(JSON.stringify(dataPacksJobData)), command);

        if (finalResult.status != 'success' && !self.optionOrProperty('ignoreJobFailures')) {
            return self.formatResponseCLI(finalResult);
        }
    }

    return self.formatResponseCLI(finalResult);
}

VlocityCLI.prototype.runJob = async function(dataPacksJobData, action) {

    var self = this;

    if (!dataPacksJobData || !dataPacksJobData.jobName) {
        return { action: action, message: 'No Job Specified', status: 'error' };
    }

    if (dataPacksJobData) {

        if (typeof dataPacksJobData.manifest === 'string') {
            try {
                dataPacksJobData.manifest = JSON.parse(dataPacksJobData.manifest);
            } catch (e) {
                VlocityUtils.error('Error', 'Invalid Manifest JSON:', dataPacksJobData.manifest);

                return { message: 'Invalid Manifest JSON:'+ dataPacksJobData.manifest + '\n' +  e.message, status: 'error' };
            }

            dataPacksJobData.queries = null;
        }

        if (!dataPacksJobData.projectPath) {
            dataPacksJobData.projectPath = path.join(self.basedir);
        }

        if (action == 'GetAllAvailableExports') {
            dataPacksJobData.queries = null;
            dataPacksJobData.manifest = null;
        }

        if (self.optionOrProperty('type')) {

            if (self.optionOrProperty('query')) {
                dataPacksJobData.queries = [{
                    query: self.optionOrProperty('query'),
                    VlocityDataPackType: self.optionOrProperty('type')
                }];
            } else {
                if (self.optionOrProperty('type')) {
                    dataPacksJobData.manifest = self.optionOrProperty('type').split(',');
                }
            }
        }

        if (self.optionOrProperty('key')) {
            dataPacksJobData.manifest = [ self.optionOrProperty('key') ];
        }

        if (action == 'ExportSingle') {

            var dataPackType;
            var dataPackId;

            if (self.optionOrProperty('type') && self.optionOrProperty('id')) {
                dataPackType = self.optionOrProperty('type');
                dataPackId = self.optionOrProperty('id');
            } else {
                return { action: action, message: 'No Export Data Specified', status: 'error' };
            }

            dataPacksJobData.queries = null;
            dataPacksJobData.manifest = {};
            dataPacksJobData.manifest[dataPackType] = [ dataPackId ];
            action = 'Export';
        }

        if (action == 'ExportAllDefault') {
            dataPacksJobData.queryAll = true;
            dataPacksJobData.ignoreQueryErrors = true;
            action = 'Export';
        }

        if (self.optionOrProperty('maxDepth') != null) {
            dataPacksJobData.maxDepth = parseInt(self.optionOrProperty('maxDepth'));
        }
    }

    dataPacksJobData.sfdxUsername = self.optionOrProperty('sfdx.username');
    dataPacksJobData.username = self.optionOrProperty('sf.username'); 
    dataPacksJobData.password = self.optionOrProperty('sf.password');
    dataPacksJobData.vlocityNamespace = self.optionOrProperty('vlocity.namespace');
    dataPacksJobData.loginUrl = self.optionOrProperty('sf.loginUrl');
    dataPacksJobData.accessToken = self.optionOrProperty('sf.accessToken');
    dataPacksJobData.sessionId = self.optionOrProperty('sf.sessionId');
    dataPacksJobData.instanceUrl = self.optionOrProperty('sf.instanceUrl');
    dataPacksJobData.httpProxy = self.optionOrProperty('sf.httpProxy');
    dataPacksJobData.verbose = self.optionOrProperty('verbose');
    dataPacksJobData.performance = self.optionOrProperty('performance');
    dataPacksJobData.force = self.optionOrProperty('force');
    dataPacksJobData.passedInOptionsOverride = self.passedInOptionsOverride;

    return await vlocity.runDataPacksCommand(action, dataPacksJobData);
}

VlocityCLI.prototype.runTestJob = async function(dataPacksJobData) {
    var self = this;

    fs.removeSync('./test/testJobRunning');
    fs.copySync(path.join(__dirname, '..', 'test','testJobData'), './test/testJobRunning');

    var commands = [
                        'ValidateLocalData',
                        'Deploy', 
                        'DeployManifest',
                        'Retry',
                        'DeployManifestJSON',
                        'GetDiffs',
                        'DeltaCheck',
                        'Export',
                        'Continue',
                        'ExportManifest',
                        'ExportManifestJSON',
                        'GetDiffsAndDeploy', 
                        'ExportSingle',
                        'BuildFile',
                        'JavaScript',
                        'GetAllAvailableExports',
                        'BuildManifest',
                        'CleanOrgData',
                        'Apex',
                        'UpdateSettings'
                    ];

    if (self.optionOrProperty('test')) {
        commands = [ self.optionOrProperty('test') ];
    }

    var allElapsed = {};

    for (var command of commands) {

        var currentTime = Date.now();
        VlocityUtils.silence = false;

        VlocityUtils.log('===============', '=====================');
        VlocityUtils.log('===============', '=====================');
        VlocityUtils.report('Running TEST', command);
        VlocityUtils.log('===============', '=====================');
        VlocityUtils.log('===============', '=====================');

        var testJobData = JSON.parse(JSON.stringify(dataPacksJobData));
        var commandOriginal = command;

        delete self.passedInOptions.type;
        delete self.passedInOptions.id;

        var jobHadError = false;

        if (command == 'DeployManifest') {
            testJobData.queries = null;
            testJobData.manifest = { VlocityUILayout: [ 'datapacktest-layout' ]};
            testJobData.manifestOnly = true;
            command = 'Deploy';
        } else if (command == 'DeployManifestJSON') {
            testJobData.queries = null;
            testJobData.manifest = '[ "VlocityUILayout/datapacktest-layout" ]';
            testJobData.manifestOnly = true;
            command = 'Deploy';
        } else if (command == 'ExportManifest') {
            testJobData.queries = null;
            testJobData.manifest = { VlocityUITemplate: [ 'datapacktest-variables' ]};
            testJobData.manifestOnly = true;
            command = 'Export';
        } else if (command == 'ExportManifestJSON') {
            testJobData.queries = null;
            testJobData.manifest = '[ "VlocityUITemplate/datapacktest-variables" ]';
            testJobData.manifestOnly = true;
            command = 'Export';
        } else if (command == 'ExportSingle') {
            self.passedInOptions.type = 'VlocityUILayout';
            self.passedInOptions.id = 'datapacktest-layout';
        } else if (command == 'Apex') {
            testJobData.apex = 'ResetDataPackMappings.cls';
        }
      
        let result = await self.runJob(testJobData, command);
      
        if (!result.records) {
            throw result;
        }

        result.records.forEach(function(record) {
            if (command == 'BuildFile' || command =='JavaScript') {
                if (record.VlocityDataPackStatus != 'Added') {
                    VlocityUtils.log(record.VlocityDataPackKey, record.VlocityDataPackStatus);
                }
            } else if ((command == 'Export' || command == 'Deploy' || command == 'GetDiffsAndDeploy') && record.VlocityDataPackStatus != 'Success') {
                if (record.VlocityDataPackKey == 'AttributeCategory/datapackstest2' && record.ErrorMessage.includes('DisplaySequence__c')) {
                    result.status = 'success';
                } else {
                    VlocityUtils.error('Test Failed ' + commandOriginal, record.VlocityDataPackKey, record.VlocityDataPackStatus);
                    jobHadError = true;
                }
            }
        });

        allElapsed[commandOriginal] = Math.floor((Date.now() - currentTime) / 1000);

        if (command == 'ValidateLocalData') {
            if (result.message != "VlocityUILayout/datapacktest-layout - VlocityUILayout__c - datapacktest-layout - Missing Global Key") {
                result.status = 'TEST ERROR';
                result.message = 'Failed to find Missing Global Key.\nOriginal Message: ' + result.message;
                throw result; 
            }
        } else if (result.status == 'error' || jobHadError) {
            throw result;
        }
    }

    var message = '';

    commands.forEach(function(command) {
        message += command + ': ' + allElapsed[command] + 's\n';
    });

    fs.removeSync('./test/testJobRunning');
    
    return { message: message, status: 'success', action: 'Test Job' };
}
