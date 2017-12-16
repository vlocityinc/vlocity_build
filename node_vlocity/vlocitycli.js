var yaml = require('js-yaml');
var fs = require('fs-extra');
var path = require('path');
var async = require('async');
var nopt = require('nopt');
var vlocity = require('./vlocity.js');
var notifier = require('node-notifier');
var properties = require('properties');
var stringify = require('json-stable-stringify');

var VLOCITY_COMMANDLINE_OPTIONS ={
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
    "sf.username": String,
    "supportForceDeploy": Boolean,
    "supportHeadersOnly": Boolean,
    "test": String,
    "type": String,
    "useAllRelationships": Boolean,
    "verbose": Boolean,
    "vlocity.dataPacksJobFolder": String,
    "vlocity.namespace": String,
    "ignoreJobFailures": Boolean,
    "json": Boolean,
    "manifest": String,
    "queryAll": Boolean,
    "stack": Boolean,
    "json-test": Boolean
};

var JOB_OPTIONS = [ 
    "activate",
    "expansionPath",
    "ignoreAllErrors",
    "javascript",
    "manifestOnly",
    "maxDepth",
    "maximumDeployCount",
    "projectPath",
    "supportForceDeploy",
    "supportHeadersOnly"
];

var VLOCITY_COMMANDLINE_OPTIONS_SHORTHAND = {
    "depth": [ "-maxDepth" ],
    "js": [ "-javascript" ],
    "ijf": [ "-ignoreJobFailures" ],
    "all": [ "-queryAll" ]
};

VLOCITY_COMMANDLINE_COMMANDS = {
    packExport: {
        action: 'Export',
        description: 'Export all DataPacks'
    },
    packExportSingle: {
        action: 'ExportSingle',
        description: 'Export a Single DataPack'
    },
    packExportAllDefault: {
        action: 'ExportAllDefault',
        description: 'Export All Default DataPacks'
    },
    packDeploy: {
        action: 'Deploy',
        description: 'Deploy all DataPacks'
    },
    packUpdateSettings: {
        action: 'UpdateSettings',
        description: 'Update the DataPack Settings in your Org'
    },
    packGetDiffs: {
        action: 'GetDiffs',
        description: 'Find all Diffs in Org Compared to Local Files'
    },
    packGetDiffsAndDeploy: {
        action: 'GetDiffsAndDeploy',
        description: 'Find all Diffs then Deploy only the Changed DataPacks'
    },
    packBuildFile: {
        action: 'BuildFile',
        description: 'Build a DataPack File from all DataPacks'
    },
    packRetry: {
        action: 'Retry',
        description: 'Continue Running a DataPacks Job Resetting Errors to Ready'
    },
    packContinue: {
        action: 'Continue',
        description: 'Continue a DataPack Job'
    },
    packGetAllAvailableExports: {
        action: 'GetAllAvailableExports',
        description: 'Get list of all DataPacks that can be exported'
    },
    refreshVlocityBase: {
        action: 'RefreshVlocityBase',
        description: 'Deploy and Activate the Base Vlocity DataPacks included in the Managed Package'
    },
    runJavaScript: {
        action: 'JavaScript',
        description: 'Run JavaScript on all DataPacks in the Project then recreate the files'
    },
    runTestJob: {
        action: 'runTestJob',
        description: 'Test all commands in the Vlocity Build Project'
    }, 
    help: {
        action: 'help',
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
            return stringify({ status: 'error', message: self.stack ? e.stack : e.message, result: e }); 
        } else if (typeof response == 'string') {
            return stringify({ message: response, status: 'error', result: null }); 
        } else {
            return stringify(response);
        }
    } else if (e && e.message) {
        return self.stack ? e.stack : e.message;
    } else if (typeof response == 'string') {
        return response;
    }

    if (response.message && response.action) {
        return response.action + ' ' + response.status + ':\n' + response.message;
    }

    return response;
}

VlocityCLI.prototype.runCLI = function(commands, success, error) {
    var self = this;

    self.cliSuccess = success;
    self.cliError = error;

    self.commandLineOptions = nopt(VLOCITY_COMMANDLINE_OPTIONS, VLOCITY_COMMANDLINE_OPTIONS_SHORTHAND, process.argv, 2);

    var commands = commands || self.commandLineOptions.argv.remain;
    
    self.isJsonCLI = self.optionOrProperty('json') || self.optionOrProperty('json-test') || false;

    self.stack = self.optionOrProperty('stack');
    
    VlocityUtils.showLoggingStatements = !self.isJsonCLI || self.optionOrProperty('json-test');

    if (commands.length == 0) {
        if (self.isJsonCLI) {
            return success(self.formatResponseCLI({ message: 'Vlocity Build', records: [], action: 'none', status: 'success' }));
        } else {
            return success('Vlocity Build');
        }
    } else if (self.commandLineOptions.help || commands[0] == 'help') {
        VlocityUtils.log('All available commands:');
        Object.keys(VLOCITY_COMMANDLINE_COMMANDS).forEach(function(command) {  
            VlocityUtils.log(command, '-', VLOCITY_COMMANDLINE_COMMANDS[command].description);
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
            return self.formatResponseCLI(null, { message: 'Could not load properties from file ' + propertyfile, stack: 'Could not load properties from file ' + propertyfile + '\n' + e.stack });
        }
    }

    var jobName = self.optionOrProperty('job');

    if (!jobName) {
        jobName = self.optionOrProperty('vlocity.dataPackJob');
    }

    if (commands[0] == 'runTestJob') {
        jobName = 'TestJob';
    }
    
    var dataPacksJobFolder = self.optionOrProperty('vlocity.dataPacksJobFolder');

    if (!dataPacksJobFolder) {
        dataPacksJobFolder = path.join(self.basedir, 'dataPacksJobs');
    }

    var dataPacksJobsData = {};

    var dataPackFolderExists;

    var finalMessage = 'Finished';

    try {
        if (jobName) {
            // Allow to just specify file / filepath
            if (fs.existsSync(jobName)) {
                dataPacksJobsData[jobName] = yaml.safeLoad(fs.readFileSync(jobName, 'utf8'));
            } else if (fs.existsSync(dataPacksJobFolder + '/' + jobName)) {
                dataPacksJobsData[jobName] = yaml.safeLoad(fs.readFileSync(dataPacksJobFolder + '/' + jobName, 'utf8'));
            } else if (fs.existsSync(dataPacksJobFolder + '/' + jobName + '.yaml')) {
                dataPacksJobsData[jobName] = yaml.safeLoad(fs.readFileSync(dataPacksJobFolder + '/' + jobName + '.yaml', 'utf8'));
            }
        }
    } catch (e) {
        VlocityUtils.log('Error Loading Job: ' + e.message);
        return error(self.formatResponseCLI(null, e)); 
    }

    JOB_OPTIONS.forEach(function(key) { 
        if (key.indexOf('sf.') == -1 && self.commandLineOptions[key] != null) {
            dataPacksJobsData[jobName][key] = self.commandLineOptions[key];
        }
    });

    var hasError = false;

    var notify = function(success, result) {
        if (!self.isJsonCLI) {
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
                command = VLOCITY_COMMANDLINE_COMMANDS[command].action;
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
        return error({ action: action, errorMessage: 'No Job Specified' });
    }

    if (dataPacksJobsData[jobName]) {

        if (!dataPacksJobsData[jobName].projectPath) {
            dataPacksJobsData[jobName].projectPath = path.join(self.basedir, 'datapacks');
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
                return error({ action: action, errorMessage: 'No Export Data Specified' });
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
            action = 'Deploy';
            jobName = 'UpdateSettings';
            dataPacksJobsData = {
                UpdateSettings: {
                    projectPath: './DataPackSettings',
                    delete: true,
                    defaultMaxParallel: 10,
                    preJobApex: { 
                        Deploy: 'ResetDataPackMappings.cls' 
                    }
                }
            };
        }
    }

    var vlocity_run = new vlocity({
          username: self.optionOrProperty('sf.username'), 
          password:  self.optionOrProperty('sf.password'), 
          vlocityNamespace: self.optionOrProperty('vlocity.namespace'),
          loginUrl: self.optionOrProperty('sf.loginUrl'),
          sessionId: self.optionOrProperty('sf.sessionId'),
          instanceUrl: self.optionOrProperty('sf.instanceUrl'),
          verbose: self.optionOrProperty('verbose')
    });

    vlocity_run.datapacksjob.runJob(dataPacksJobsData, jobName, action, success, error);
}

VlocityCLI.prototype.runTestJob = function(dataPacksJobsData, success, error) {
    var self = this;

    fs.removeSync('./test/testJobRunning');
    fs.copySync(path.join(__dirname, '..', 'test','testJobData'), './test/testJobRunning');

    var commands = [
                        'Deploy', 
                        'GetDiffs',
                        'Export',
                        'ExportSingle',
                        'GetDiffsAndDeploy', 
                        'BuildFile',
                        'JavaScript' 
                    ];

    if (self.optionOrProperty('test')) {
        commands = [ self.optionOrProperty('test') ];
    }

    var allElapsed = {};

    self.commandLineOptions.type = 'VlocityUILayout';
    self.commandLineOptions.id = 'datapacktest-layout';

    async.eachSeries(commands, function(command, callback) {

        var currentTime = Date.now();

        VlocityUtils.log('\x1b[36m', 'Running TEST -', command);

        self.runJob(JSON.parse(JSON.stringify(dataPacksJobsData)), 'TestJob', command, function(jobInfo) {
            var hasErrors = false;

            if (!jobInfo.currentStatus || Object.keys(jobInfo.currentStatus).length == 0) {
                hasErrors = true;
            } else {
                Object.keys(jobInfo.currentStatus).forEach(function(dataPackKey) {
                    if (command == 'BuildFile' || command =='JavaScript') {
                        if (jobInfo.currentStatus[dataPackKey] != 'Added') {
                            VlocityUtils.log(dataPackKey, jobInfo.currentStatus[dataPackKey]);
                            hasErrors = true;
                        }
                    } else if (jobInfo.currentStatus[dataPackKey] != 'Success'){
                        VlocityUtils.log(dataPackKey, jobInfo.currentStatus[dataPackKey]);
                        hasErrors = true;
                    }
                });
            }

            if (jobInfo.hasErrors || hasErrors) {
                error('Test Failed');
            }

            allElapsed[command] = Math.floor((Date.now() - currentTime) / 1000);

            callback();
        });
    }, function(err, result) {

        commands.forEach(function(command) {
            VlocityUtils.log(command + ': ' + allElapsed[command] + 's');
        });

        fs.removeSync('./test/testJobRunning');
        
        success({ jobAction: 'runTestJob' });
    });
}

