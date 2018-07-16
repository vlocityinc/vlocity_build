var yaml = require('js-yaml');
var fs = require('fs-extra');
var path = require('path');
var async = require('async');
var nopt = require('nopt');
var vlocity = require('./vlocity.js');
var notifier = require('node-notifier');
var properties = require('properties');
var stringify = require('json-stable-stringify');

VLOCITY_BUILD_VERSION = '1.5.6';

var VLOCITY_COMMANDLINE_OPTIONS = {
    "activate": Boolean,
    "addSourceKeys": Boolean,
    "apex": String,
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
    "stack": Boolean,
    "json-test": Boolean,
    "nojob": Boolean,
    "sandbox": Boolean,
    "json-pretty": Boolean,
    "version": Boolean,
    "quiet": Boolean,
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
    help: {
        name: 'help',
        description: 'Get all commands for Vlocity Build'
    }
};

VlocityCLI = module.exports = function () {
    this.commandLineOptions = {};
    this.properties = {};
    this.isJsonCLI = false;
    this.basedir = process.env.PWD;
    
    if (!this.basedir) {
        this.basedir = process.cwd();
    }

    return this;
}

VlocityCLI.prototype.optionOrProperty = function(key) {
    return this.commandLineOptions[key] ? this.commandLineOptions[key] : this.properties[key];
}

VlocityCLI.prototype.formatResponseCLI = function(response, e) {
    var self = this;

    // { "status": "", "message":"", "result":"", data: {}, action: "" }
    if (self.isJsonCLI) {
        // First 2 account for issues in the CLI Runner
        if (e && e.message) {
            return stringify({ status: 'error', message: self.stack ? e.stack : e.message, result: e }, self.isJsonCLIPretty ? { space: 4 } : {}); 
        } else if (typeof response == 'string') {
            return stringify({ message: response, status: 'error', result: null }, self.isJsonCLIPretty ? { space: 4 } : {}); 
        } else {
            return stringify(response, self.isJsonCLIPretty ? { space: 4 } : {});
        }
    } else if (e && e.message) {
        return self.stack ? e.stack : e.message;
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

VlocityCLI.prototype.runCLI = function(commands, success, error) {
    var self = this;

    self.cliSuccess = success;
    self.cliError = error;

    self.commandLineOptions = nopt(VLOCITY_COMMANDLINE_OPTIONS, VLOCITY_COMMANDLINE_OPTIONS_SHORTHAND, process.argv, 2);

    commands = commands || self.commandLineOptions.argv.remain;

    self.isJsonCLI = self.optionOrProperty('json') || self.optionOrProperty('json-pretty') || self.optionOrProperty('json-test') || false;

    VlocityUtils.quiet = self.optionOrProperty('quiet') || false;
    VlocityUtils.verboseLogging = self.optionOrProperty('verbose') || false;
    VlocityUtils.showLoggingStatements = VlocityUtils.quiet || !self.isJsonCLI || self.optionOrProperty('json-test');

    VlocityUtils.log('Vlocity Build v' + VLOCITY_BUILD_VERSION);

    self.isJsonCLIPretty = self.optionOrProperty('json-pretty') || self.optionOrProperty('json-test') || false;

    self.stack = self.optionOrProperty('stack');

    VlocityUtils.verbose('Verbose Logging Enabled');
    VlocityUtils.verbose('Commands', commands);

    if (commands.length == 0) {
        if (self.isJsonCLI) {
            return success(self.formatResponseCLI({ message: 'Vlocity Build', records: [], action: 'none', status: 'success' }));
        } else {
            return success('');
        }
    } else if (commands[0] == 'help') {
        VlocityUtils.log('All available commands:');
        Object.keys(VLOCITY_COMMANDLINE_COMMANDS).forEach(function(command) {  
            VlocityUtils.log(command, VLOCITY_COMMANDLINE_COMMANDS[command].description);
        });
        if (self.isJsonCLI) {
            return success(self.formatResponseCLI({ message: 'Commands', records: Object.values(VLOCITY_COMMANDLINE_COMMANDS), action: 'help', status: 'success' }));
        } else {
            return success('');
        }
    }
    
    // Check to see if Propertyfile
    var propertyfile = self.optionOrProperty('propertyfile');

    if (!propertyfile) {
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
                return self.formatResponseCLI(null, { message: 'propertyfile not found: ' + propertyfile + '\n' + e.stack });
            } else {
                VlocityUtils.error('Error', 'Error loading properties from file:', propertyfile);
                return self.formatResponseCLI(null, { message: 'Could not load properties from file ' + propertyfile, stack: 'Error loading properties from file: ' + propertyfile + '\n' + e.stack });
            }
        }
    }

    var jobName = self.optionOrProperty('job');

    if (!jobName) {
        jobName = self.optionOrProperty('vlocity.dataPackJob');
    }

    if (self.optionOrProperty('sandbox')) {
        this.properties['sf.loginUrl'] = 'https://test.salesforce.com';
    }

    var dataPacksJobFolder = self.optionOrProperty('vlocity.dataPacksJobFolder');

    if (!dataPacksJobFolder) {
        dataPacksJobFolder = 'dataPacksJobs';
    }

    if (commands[0] == 'runTestJob') {
        jobName = 'TestJob';
        dataPacksJobFolder = path.join(__dirname, '..', 'dataPacksJobs');
    }

    var dataPacksJobsData = {};

    if (commands.indexOf('packUpdateSettings') != -1) {
        if (!jobName && commands.length == 1) {
            jobName = 'UpdateSettings';
        }
    }

    var dataPackFolderExists;

    var finalMessage = 'Finished';

    var noJob = self.optionOrProperty('nojob');

    if (noJob) {
        jobName = 'nojob';
        dataPacksJobsData[jobName] = { };
    }

    VlocityUtils.verbose('DataPacksJob Data', dataPacksJobsData);

    try {
        if (jobName && !dataPacksJobsData[jobName]) {
            // Allow to just specify file / filepath
            if (fs.existsSync(jobName)) {
                dataPacksJobsData[jobName] = yaml.safeLoad(fs.readFileSync(jobName, 'utf8'));
            } else if (fs.existsSync(dataPacksJobFolder + '/' + jobName)) {
                dataPacksJobsData[jobName] = yaml.safeLoad(fs.readFileSync(dataPacksJobFolder + '/' + jobName, 'utf8'));
            } else if (fs.existsSync(dataPacksJobFolder + '/' + jobName + '.yaml')) {
                dataPacksJobsData[jobName] = yaml.safeLoad(fs.readFileSync(dataPacksJobFolder + '/' + jobName + '.yaml', 'utf8'));
            } else {
                return error(self.formatResponseCLI({ message: jobName + ' Not Found' }));
            }
        }
    } catch (e) {
        VlocityUtils.log('Error Loading Job: ' + e.message);
        return error(self.formatResponseCLI(null, e)); 
    }

    self.commandLineOptionsOverride = {};

    Object.keys(VLOCITY_COMMANDLINE_OPTIONS).forEach(function(key) {
        if (key.indexOf('sf.') == -1 && self.commandLineOptions[key] != null) {

            if (dataPacksJobsData[jobName]) {
                dataPacksJobsData[jobName][key] = self.commandLineOptions[key];
            }

            self.commandLineOptionsOverride[key] = self.commandLineOptions[key];
        }
    });

    var hasError = false;

    var notify = function(success, result) {
        if (!self.isJsonCLI && !VlocityUtils.quiet) {
            var message = (success ? 'Success' : 'Failed') + ' - ' + jobName + ' - ' + result.action + '\nJob executed in ' + ((Date.now() - jobStartTime)  / 1000).toFixed(0) + ' second(s)';
            
            notifier.notify({
                title: 'Vlocity deployment tools',
                message: message,                      
                icon: path.join(__dirname, '..', 'images', 'toast-logo.png'), 
                sound: true
            }, function (notifierError, response) {
            });
        }
    }

    var jobStartTime = Date.now();

    var fatalErrors = [];
    var finalResult;

    if (commands[0] == 'runTestJob') {
        self.runTestJob(dataPacksJobsData, 
            function(result) {
                notify(true, result);
                success(self.formatResponseCLI(result));
            },
            function(result) {
                notify(false, result);
                error(self.formatResponseCLI(result));
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

            self.runJob(JSON.parse(JSON.stringify(dataPacksJobsData)), jobName, command, 
                function(result) {
                    finalResult = result;
                    notify(true, result);
                    callback();
                },
                function(result) {
                    finalResult = result;
                
                    if (self.optionOrProperty('ignoreJobFailures')) {
                        VlocityUtils.log(self.formatResponseCLI(result));
                        notify(false, result);
                        callback();
                    } else {
                        notify(false, result);
                        callback(result);
                    }
                });
            
        }, function(err, result) {
            
            if (err) {
                error(self.formatResponseCLI(err));
            } else {
                success(self.formatResponseCLI(finalResult));
            }
        });
    }
}

VlocityCLI.prototype.runJob = function(dataPacksJobsData, jobName, action, success, error) {

    var self = this;

    if (!jobName) {
        return error({ action: action, message: 'No Job Specified' });
    }

    if (dataPacksJobsData[jobName]) {

        if (dataPacksJobsData[jobName] && typeof dataPacksJobsData[jobName].manifest === 'string') {
            dataPacksJobsData[jobName].manifest = JSON.parse(dataPacksJobsData[jobName].manifest);
            dataPacksJobsData[jobName].queries = null;
        }

        if (!dataPacksJobsData[jobName].projectPath) {
            dataPacksJobsData[jobName].projectPath = path.join(self.basedir);
        }

        if (self.optionOrProperty('query') && self.optionOrProperty('type')) {
            dataPacksJobsData[jobName].queries = [{
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
                return error({ action: action, message: 'No Export Data Specified' });
            }

            dataPacksJobsData[jobName].queries = null;
            dataPacksJobsData[jobName].manifest = {};
            dataPacksJobsData[jobName].manifest[dataPackType] = [ dataPackId ];
            action = 'Export';
        }

        if (action == 'ExportAllDefault') {
            dataPacksJobsData[jobName].queryAll = true;
            dataPacksJobsData[jobName].ignoreQueryErrors = true;
            action = 'Export';
        }

        if (self.optionOrProperty('maxDepth') != null) {
            dataPacksJobsData[jobName].maxDepth = parseInt(self.optionOrProperty('maxDepth'));
        }

        if (action == 'UpdateSettings') {
            action = 'UpdateSettings';
        }
    }

    var vlocity_run = new vlocity({
          username: self.optionOrProperty('sf.username'), 
          password:  self.optionOrProperty('sf.password'), 
          vlocityNamespace: self.optionOrProperty('vlocity.namespace'),
          loginUrl: self.optionOrProperty('sf.loginUrl'),
          sessionId: self.optionOrProperty('sf.sessionId'),
          instanceUrl: self.optionOrProperty('sf.instanceUrl'),
          httpProxy: self.optionOrProperty('sf.httpProxy'),
          verbose: self.optionOrProperty('verbose'),
          performance: self.optionOrProperty('performance'),
          commandLineOptionsOverride: self.commandLineOptionsOverride
    });

    vlocity_run.datapacksjob.runJob(dataPacksJobsData, jobName, action, success, error);
}

VlocityCLI.prototype.runTestJob = function(dataPacksJobsData, success, error) {
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

    self.commandLineOptions.type = 'VlocityUILayout';
    self.commandLineOptions.id = 'datapacktest-layout';

    async.eachSeries(commands, function(command, callback) {

        var currentTime = Date.now();
        VlocityUtils.silence = false;

        VlocityUtils.log('===============', '=====================');
        VlocityUtils.log('===============', '=====================');
        VlocityUtils.report('Running TEST', command);
        VlocityUtils.log('===============', '=====================');
        VlocityUtils.log('===============', '=====================');

        var testJobData = JSON.parse(JSON.stringify(dataPacksJobsData));
        var commandOriginal = command;

        if (command == 'DeployManifest') {
            testJobData.TestJob.queries = null;
            testJobData.TestJob.manifest = { VlocityUILayout: [ 'datapacktest-layout' ]};
            testJobData.TestJob.manifestOnly = true;
            command = 'Deploy';
        } else if (command == 'DeployManifestJSON') {
            testJobData.TestJob.queries = null;
            testJobData.TestJob.manifest = '[ "VlocityUILayout/datapacktest-layout" ]';
            testJobData.TestJob.manifestOnly = true;
            command = 'Deploy';
        } else if (command == 'ExportManifest') {
            testJobData.TestJob.queries = null;
            testJobData.TestJob.manifest = { VlocityUITemplate: [ 'datapacktest-variables' ]};
            testJobData.TestJob.manifestOnly = true;
            command = 'Export';
        } else if (command == 'ExportManifestJSON') {
            testJobData.TestJob.queries = null;
            testJobData.TestJob.manifest = '[ "VlocityUITemplate/datapacktest-variables" ]';
            testJobData.TestJob.manifestOnly = true;
            command = 'Export';
        }

        self.runJob(testJobData, 'TestJob', command, function(result) {
            var hasErrors = false;

            result.records.forEach(function(record) {
                if (command == 'BuildFile' || command =='JavaScript') {
                    if (record.VlocityDataPackStatus != 'Added') {
                        VlocityUtils.log(record.VlocityDataPackKey, record.VlocityDataPackStatus);
                    }
                } else if ((command == 'Export' || command == 'Deploy') && record.VlocityDataPackStatus != 'Success') {
                    VlocityUtils.error('Test Failed ' + commandOriginal, record.VlocityDataPackKey, record.VlocityDataPackStatus);
                    hasErrors = true;
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
            } else if (result.status == 'error' || hasErrors) {
                callback(result);
            } else {
                callback();
            }
        });
    }, function(err, result) {
        
        if (err) {
            return error(self.formatResponseCLI(err));
        }

        var message = '';

        commands.forEach(function(command) {
            message += command + ': ' + allElapsed[command] + 's\n';
        });

        fs.removeSync('./test/testJobRunning');
        
        success({ message: message, status: 'Success', action: 'Test Job' });
    });
}

