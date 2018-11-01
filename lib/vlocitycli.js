var yaml = require('js-yaml');
var fs = require('fs-extra');
var path = require('path');
var async = require('async');
var nopt = require('nopt');
var vlocity = require('./vlocity.js');
var properties = require('properties');
var stringify = require('json-stable-stringify');

var VLOCITY_COMMANDLINE_OPTIONS = {
    "activate": Boolean,
    "addSourceKeys": Boolean,
    "apex": String,
    "buildFile": String,
    "compileOnBuild": Boolean,
    "continueAfterError": Boolean,
    "defaultMaxParallel": Number,
    "expansionPath": String,
    "folder": String,
    "id": String,
    "ignoreAllErrors": Boolean,
    "javascript": String,
    "job": String,
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
    "fixLocalGlobalKeys": Boolean
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
        description: 'Deploy and Activate the Base Vlocity DataPacks included in the Managed Package'
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
    runDeltaCheck: {
        name: 'RunDeltaCheck',
        description: 'Run Delta Check'
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
    }
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
            return stringify({ status: 'error', message: response.stack ? response.stack : response.message, result: response }, self.isJsonPretty ? { space: 4 } : {}); 
        } else if (typeof response == 'string') {
            return stringify({ message: response, status: 'error', result: null }, self.isJsonPretty ? { space: 4 } : {}); 
        } else {
            return stringify(response, self.isJsonPretty ? { space: 4 } : {});
        }
    } else if (response instanceof Error) {
        return response.stack ? response.stack : response.message;
    } else if (typeof response == 'string') {
        return response;
    }

    if (response.message && response.action) {
        return response.action + ' ' + response.status + ':\n' + response.message;
    }

    if (response.message) {
        return response.message;
    }

    return response;
}

VlocityCLI.runCLI = async function() {
    process.exitCode = 1; 
    
    var commandLineOptions = nopt(VLOCITY_COMMANDLINE_OPTIONS, VLOCITY_COMMANDLINE_OPTIONS_SHORTHAND, process.argv, 2);

    commands = commandLineOptions.argv.remain;

    let promise = await new Promise((resolve, reject) => {

        let vlocity_cli = new VlocityCLI();

        vlocity_cli.runCommands(commands, commandLineOptions, 
            function(result) {
                
                process.exitCode = 0;

                if (!VlocityUtils.quiet) {
                    console.log(result);
                }

                resolve(result);
            }, 
            function(result) {
                
                process.exitCode = 1;

                console.log(result);

                reject(result);
            }).catch(function(err) {
                console.log(err);

                reject(err);
            });
        });

    return promise;
}

VlocityCLI.prototype.runCommands = function(commands, options, onSuccess, onError) {
    var self = this;

    self.passedInOptions = options;
    if (!Array.isArray(commands)) {
        commands = [ commands ];
    }

    if (self.optionOrProperty('json') 
    || self.optionOrProperty('json-pretty') 
    || self.optionOrProperty('json-test')) {

        self.responseFormat = 'JSON';
        VlocityUtils.showLoggingStatements = false;
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

    if (commands.length == 0) {
        if (self.responseFormat == 'JSON') {
            return onSuccess(self.formatResponseCLI({ message: 'Vlocity Build', records: [], action: 'none', status: 'success' }));
        } else {
            return onSuccess('');
        }
    } else if (commands[0] == 'help') {
        VlocityUtils.log('All available commands:');
        Object.keys(VLOCITY_COMMANDLINE_COMMANDS).forEach(function(command) {  
            VlocityUtils.log(command, VLOCITY_COMMANDLINE_COMMANDS[command].description);
        });
        if (self.responseFormat == 'JSON') {
            return onSuccess(self.formatResponseCLI({ message: 'Commands', records: Object.values(VLOCITY_COMMANDLINE_COMMANDS), action: 'help', status: 'success' }));
        } else {
            return onSuccess('');
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
                VlocityUtils.onError('Error', 'propertyfile not found:', propertyfile);

                return onError(self.formatResponseCLI({ message: 'propertyfile not found: ' + propertyfile + '\n' + (VlocityUtils.verbose ? e.stack : e.message), status: 'error' }));
            } else {
                VlocityUtils.error('Error', 'Error loading properties from file:', propertyfile);

                return onError(self.formatResponseCLI({ message: 'Could not load properties from file ' + propertyfile, stack: 'Error loading properties from file: ' + propertyfile + '\n' + (VlocityUtils.verbose ? e.stack : e.message), status: 'error' }));
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
                return onError(self.formatResponseCLI({ message: 'Job File not found: ' + jobName, status: 'error' }));
            }

            dataPacksJobData = yaml.safeLoad(fs.readFileSync(jobfileName, 'utf8'));
            dataPacksJobData.jobName = jobName;
        }
    } catch (e) {
        VlocityUtils.log('Error Loading Job: ' + e.message);
        return onError(self.formatResponseCLI(e)); 
    }

    self.passedInOptionsOverride = {};

    Object.keys(VLOCITY_COMMANDLINE_OPTIONS).forEach(function(key) {
        if (key.indexOf('sf.') == -1 && self.passedInOptions[key] != null) {

            if (dataPacksJobData) {
                dataPacksJobData[key] = self.passedInOptions[key];
            }

            self.passedInOptionsOverride[key] = self.passedInOptions[key];
        }
    });

    var finalResult;

    if (commands[0] == 'runTestJob') {
        self.runTestJob(dataPacksJobData, 
            function(result) {
                onSuccess(self.formatResponseCLI(result));
            },
            function(result) {
                onError(self.formatResponseCLI(result));
        });
    } else {
        // If No Commands Passed in then run from Parsed Command Line
        async.eachSeries(commands, function(command, callback) {
            if (VLOCITY_COMMANDLINE_COMMANDS[command]) {
                command = VLOCITY_COMMANDLINE_COMMANDS[command].name;
            } else {
                finalResult = 'Command not found ' + command;
            }

            finalResult = null;

            self.runJob(JSON.parse(JSON.stringify(dataPacksJobData)), command, 
                function(result) {
                    finalResult = result;
                    callback();
                },
                function(result) {
                    finalResult = result;
                
                    if (self.optionOrProperty('ignoreJobFailures')) {
                        VlocityUtils.log(self.formatResponseCLI(result));
                        callback();
                    } else {
                        callback(result);
                    }
                });
            
        }, function(err) {
            
            if (err) {
                onError(self.formatResponseCLI(err));
            } else {
                onSuccess(self.formatResponseCLI(finalResult));
            }
        });
    }
}

VlocityCLI.prototype.runJob = function(dataPacksJobData, action, onSuccess, onError) {

    var self = this;

    if (onSuccess && !onError) {
        onError = onSuccess;
    }

    if (!dataPacksJobData || !dataPacksJobData.jobName) {
        return onError({ action: action, message: 'No Job Specified' });
    }

    if (dataPacksJobData) {

        if (typeof dataPacksJobData.manifest === 'string') {
            dataPacksJobData.manifest = JSON.parse(dataPacksJobData.manifest);
            dataPacksJobData.queries = null;
        }

        if (!dataPacksJobData.projectPath) {
            dataPacksJobData.projectPath = path.join(self.basedir);
        }

        if (self.optionOrProperty('query') && self.optionOrProperty('type')) {
            dataPacksJobData.queries = [{
                query: self.optionOrProperty('query'),
                VlocityDataPackType: self.optionOrProperty('type')
            }];
        }

        if (action == 'ExportSingle') {

            var dataPackType;
            var dataPackId;

            if (self.optionOrProperty('type') && self.optionOrProperty('id')) {
                dataPackType = self.optionOrProperty('type');
                dataPackId = self.optionOrProperty('id');
            } else {
                return onError({ action: action, message: 'No Export Data Specified' });
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

        if (action == 'UpdateSettings') {
            action = 'UpdateSettings';
        }
    }

    dataPacksJobData.sfdxUsername = self.optionOrProperty('sfdx.username');
    dataPacksJobData.username = self.optionOrProperty('sf.username'); 
    dataPacksJobData. password = self.optionOrProperty('sf.password');
    dataPacksJobData.vlocityNamespace = self.optionOrProperty('vlocity.namespace');
    dataPacksJobData.loginUrl = self.optionOrProperty('sf.loginUrl');
    dataPacksJobData.accessToken = self.optionOrProperty('sf.accessToken');
    dataPacksJobData.sessionId = self.optionOrProperty('sf.sessionId');
    dataPacksJobData.instanceUrl = self.optionOrProperty('sf.instanceUrl');
    dataPacksJobData.httpProxy = self.optionOrProperty('sf.httpProxy');
    dataPacksJobData.verbose = self.optionOrProperty('verbose');
    dataPacksJobData.performance = self.optionOrProperty('performance');
    dataPacksJobData.passedInOptionsOverride = self.passedInOptionsOverride;

    return vlocity.runDataPacksCommand(action, dataPacksJobData)


    .then(onSuccess, onError)
    .catch(onError);
}

VlocityCLI.prototype.runTestJob = function(dataPacksJobData, onSuccess, onError) {
    var self = this;

    VlocityUtils.showLoggingStatements = true;

    fs.removeSync('./test/testJobRunning');
    fs.copySync(path.join(__dirname, '..', 'test','testJobData'), './test/testJobRunning');

    var commands = [
                        'ValidateLocalData',
                        'Deploy', 
                        'DeployManifest',
                        'DeployManifestJSON',
                        'GetDiffs',
                        'Export',
                        'ExportManifestJSON',
                        'ExportSingle',
                        'GetDiffsAndDeploy', 
                        'BuildFile',
                        'JavaScript',
                        'GetAllAvailableExports',
                        'CleanOrgData'
                    ];

    if (self.optionOrProperty('test')) {
        commands = [ self.optionOrProperty('test') ];
    }

    var allElapsed = {};

    self.passedInOptions.type = 'VlocityUILayout';
    self.passedInOptions.id = 'datapacktest-layout';

    async.eachSeries(commands, function(command, callback) {

        var currentTime = Date.now();
        VlocityUtils.silence = false;

        VlocityUtils.log('===============', '=====================');
        VlocityUtils.log('===============', '=====================');
        VlocityUtils.report('Running TEST', command);
        VlocityUtils.log('===============', '=====================');
        VlocityUtils.log('===============', '=====================');

        var testJobData = JSON.parse(JSON.stringify(dataPacksJobData));
        var commandOriginal = command;

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
        }

        self.runJob(testJobData, command, function(result) {
            var jobHadError = false;

            if (!result.records) {
                return callback(result);
            }

            result.records.forEach(function(record) {
                if (command == 'BuildFile' || command =='JavaScript') {
                    if (record.VlocityDataPackStatus != 'Added') {
                        VlocityUtils.log(record.VlocityDataPackKey, record.VlocityDataPackStatus);
                    }
                } else if ((command == 'Export' || command == 'Deploy') && record.VlocityDataPackStatus != 'Success') {
                    VlocityUtils.error('Test Failed ' + commandOriginal, record.VlocityDataPackKey, record.VlocityDataPackStatus);
                    jobHadError = true;
                }
            });

            allElapsed[commandOriginal] = Math.floor((Date.now() - currentTime) / 1000);

            if (command == 'ValidateLocalData') {
                if (result.message != "VlocityUILayout/datapacktest-layout - VlocityUILayout__c - datapacktest-layout - Missing Global Key") {
                    result.status = 'TEST ERROR';
                    result.message = 'Failed to find Missing Global Key.\nOriginal Message: ' + result.message;
                    callback(result); 
                } else {
                    callback();
                }
            } else if (result.status == 'error' || jobHadError) {
                callback(result);
            } else {
                callback();
            }
        });
    }, function(err, result) {
        
        if (err) {
            return onError(self.formatResponseCLI(err));
        }

        var message = '';

        commands.forEach(function(command) {
            message += command + ': ' + allElapsed[command] + 's\n';
        });

        fs.removeSync('./test/testJobRunning');
        
        onSuccess({ message: message, status: 'Success', action: 'Test Job' });
    });
}

