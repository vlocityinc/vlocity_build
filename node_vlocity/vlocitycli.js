var yaml = require('js-yaml');
var fs = require('fs-extra');
var path = require('path');
var async = require('async');
var nopt = require('nopt');
var vlocity = require('./vlocity.js');
var notifier = require('node-notifier');
var properties = require('properties');

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
    "ignoreJobFailures": Boolean
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
    "ijf": [ "-ignoreJobFailures" ]
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
        description: 'Export All DataPack Types defined in QueryDefinitions'
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
    runJavaScript: {
        action: 'JavaScript',
        description: 'Run JavaScript on all DataPacks in the Project then recreate the files'
    },
    runTestJob: {
        action: 'runTestJob',
        description: 'Test all commands in the Vlocity Build Project'
    }
};

VlocityCLI = module.exports = function () {
    this.commandLineOptions = {};
    this.properties = {};

    this.queryDefinitions = yaml.safeLoad(fs.readFileSync(path.join(__dirname, 'QueryDefinitions.yaml'), 'utf8'));

    return this;
}

VlocityCLI.prototype.optionOrProperty = function(key) {
    return this.commandLineOptions[key] ? this.commandLineOptions[key] : this.properties[key];
}

VlocityCLI.prototype.runCLI = function(commands, success, error) {
    var self = this;

    self.commandLineOptions = nopt(VLOCITY_COMMANDLINE_OPTIONS, VLOCITY_COMMANDLINE_OPTIONS_SHORTHAND, process.argv, 2);

    if (self.commandLineOptions.help) {
        Object.keys(VLOCITY_COMMANDLINE_COMMANDS).forEach(function(command) {  
            console.log(command, '-', VLOCITY_COMMANDLINE_COMMANDS[command].description);
        });

        return;
    }

    var basedir = process.env.PWD;

    if (!basedir) {
        basedir = process.cwd();
    }

    var file = self.commandLineOptions.propertyfile ? self.commandLineOptions.propertyfile : 'build.properties';

    try {
        this.properties = properties.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        console.log('Could not load properties file from ' + file, e);
    }

    var jobName = self.optionOrProperty('job');

    if (!jobName) {
        jobName = self.optionOrProperty('vlocity.dataPackJob');
    }
    
    var dataPacksJobFolder = self.optionOrProperty('vlocity.dataPacksJobFolder');

    if (!dataPacksJobFolder) {
        dataPacksJobFolder = path.join(__dirname, '../dataPacksJobs');
    }

    var dataPacksJobsData = {};

    var dataPackFolderExists;

    try {
        fs.readdirSync(dataPacksJobFolder).filter(function(file) {
            try {
                if (file.indexOf('.yaml') != -1) {
                    var fileName = file.substr(0, file.indexOf('.'));
                    dataPacksJobsData[fileName] = yaml.safeLoad(fs.readFileSync(dataPacksJobFolder + '/' + file, 'utf8'));
                    
                    dataPacksJobsData[fileName].QueryDefinitions = self.queryDefinitions;

                    JOB_OPTIONS.forEach(function(key) { 
                        if (key.indexOf('sf.') == -1 && self.commandLineOptions[key] != null) {
                            dataPacksJobsData[fileName][key] = self.commandLineOptions[key];
                        }
                    });
                }
            } catch (jobError) { 
                console.log('Error loading Job File ' + file, jobError);
            }
        });
    } catch (e2) {
        console.log('No DataPacksJob Folder Found: ' + dataPacksJobFolder);
    }

    var hasError = false;

    var notifyError = function(result, callback) {
        notifier.notify({
            title: 'Vlocity deployment tools',
            message: 'Failed - ' + jobName + ' - ' + result.jobAction + '\n'+
                     'Job executed in ' + ((Date.now() - jobStartTime)  / 1000).toFixed(0) + ' second(s)',                      
            icon: path.join(__dirname, '..', 'images', 'toast-logo.png'), 
            sound: true
        }, function (notifierError, response) {
            if (notifierError) {
                console.log(notifierError);
            }

            callback();
        });
    }

    var notifySuccess = function(result, callback) {

        var message = 'Success - ' + jobName + ' - ' + result.jobAction + '\n'+
                     'Job executed in ' + ((Date.now() - jobStartTime)  / 1000).toFixed(0) + ' second(s)';

        console.log(message);
        notifier.notify({
            title: 'Vlocity deployment tools',
            message: message,                      
            icon: path.join(__dirname, '..', 'images', 'toast-logo.png'), 
            sound: true
        }, function (notifierError, response) {
            if (notifierError) {
                console.log(notifierError);
            }
            callback();
        });
    }

    var jobStartTime = Date.now();

    var fatalErrors = [];

    var jobError = function(err) {
        return 'DataPacks Job Failed - ' + err.jobAction + ' - ' + jobName + '\nErrors:\n' + err.errorMessage;
    }

    // If No Commands Passed in then run from Parsed Command Line
    async.eachSeries(commands || self.commandLineOptions.argv.remain, function(command, callback) {
        if (VLOCITY_COMMANDLINE_COMMANDS[command]) {
            command = VLOCITY_COMMANDLINE_COMMANDS[command].action;
        }

        if (command == 'runTestJob') {
            self.runTestJob(dataPacksJobsData, 
                function(result) {
                    notifySuccess(result, callback);
                },
                function(result) {
                    notifyError(result, callback);
                });
        } else {
            self.runJob(JSON.parse(JSON.stringify(dataPacksJobsData)), jobName, command, function(result) {
                    notifySuccess(result, callback);
                },
                function(result) {
                    if (self.optionOrProperty('ignoreJobFailures')) {
                        console.log(jobError(result));
                        notifyError(result, callback);
                    } else {
                        notifyError(result, function() {
                            callback(result);
                        });
                    }
                });
        }
    }, function(err, result) {
        if (err) {
            error(jobError(err));
        } else {
            success('Finished');
        }
    });
}

VlocityCLI.prototype.runJob = function(dataPacksJobsData, jobName, action, success, error) {

    var self = this;

    if (!jobName) {
        return error({ action: action, errorMessage: 'No Job Specified' });
    }

    if (dataPacksJobsData[jobName]) {

        if (!dataPacksJobsData[jobName].projectPath) {
            dataPacksJobsData[jobName].projectPath = dataPacksJobFolder;
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

        if (action == 'ExportAllDefault' && self.queryDefinitions) {
            dataPacksJobsData[jobName].queries = Object.keys(self.queryDefinitions);
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

        self.runJob(JSON.parse(JSON.stringify(dataPacksJobsData)), 'TestJob', command, function(jobInfo) {
            var hasErrors = false;

            if (!jobInfo.currentStatus || Object.keys(jobInfo.currentStatus).length == 0) {
                hasErrors = true;
            } else {
                Object.keys(jobInfo.currentStatus).forEach(function(dataPackKey) {
                    if (command == 'BuildFile' || command =='JavaScript') {
                        if (jobInfo.currentStatus[dataPackKey] != 'Added') {
                            console.log(dataPackKey, jobInfo.currentStatus[dataPackKey]);
                            hasErrors = true;
                        }
                    } else if (jobInfo.currentStatus[dataPackKey] != 'Success'){
                        console.log(dataPackKey, jobInfo.currentStatus[dataPackKey]);
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
            console.log(command + ': ' + allElapsed[command] + 's');
        });

        fs.removeSync('./test/testJobRunning');
        
        success({jobAction: 'runAllTests' });
    });
}

