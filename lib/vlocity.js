var jsforce = require('jsforce');
var yaml = require('js-yaml');
var fs = require('fs-extra');
var path = require('path');
var stringify = require('json-stable-stringify');

var datapacks = require('./datapacks');
var datapacksjob = require('./datapacksjob');
var datapacksexpand = require('./datapacksexpand');
var datapacksbuilder = require('./datapacksbuilder');
var datapacksutils = require('./datapacksutils');
var datapacksexportbuildfile = require('./datapacksexportbuildfile');
var vlocityutils = require('./vlocityutils.js');
var datapackserrorhandling = require('./datapackserrorhandling.js');
var queryservice = require('./queryservice.js');
var validationtest = require('./validationtest');
var deltacheck = require('./deltacheck');
var utilityservice = require('./utilityservice.js');

VLOCITY_BUILD_VERSION = require('../package.json').version;

var SOURCE_FILE_CURRENT = 'sourceFileCurrent.json';
var TARGET_FILE_CURRENT = 'targetFileCurrent.json';
var DIFFS_FILE_CURRENT = 'diffsFileCurrent.json';

var Vlocity = module.exports = function(options) {
    options = options || {};

    this.passedInNamespace = options.vlocityNamespace;

    this.passedInOptionsOverride = options.commandLineOptionsOverride;

    this.tempFolder = options.tempFolder || './vlocity-temp/';

    this.verbose = !!options.verbose;

    VlocityUtils.verboseLogging = !!options.verbose;
    VlocityUtils.performance = !!options.performance;

    VlocityUtils.verbose('Verbose mode enabled');

    this.sfdxUsername = options.sfdxUsername;
    this.username = options.username || options.sfdxUsername;
    this.password = options.password;
    this.sessionId = options.sessionId;
    this.instanceUrl = options.instanceUrl;
    this.accessToken = options.accessToken;

    if (this.username) {
        VlocityUtils.report('Org', this.username);
    }

    this.jsForceConnection = new jsforce.Connection({
        loginUrl: options.loginUrl ? options.loginUrl : 'https://login.salesforce.com',
        httpProxy: options.httpProxy ? options.httpProxy : null,
        sessionId: this.sessionId,
        instanceUrl: this.instanceUrl,
        accessToken: this.accessToken
    });

    this.datapacksutils = new datapacksutils(this);
    this.datapacks = new datapacks(this);
    this.datapacksjob = new datapacksjob(this);
    this.datapacksexpand = new datapacksexpand(this);
    this.datapacksbuilder = new datapacksbuilder(this);
    this.datapacksexportbuildfile = new datapacksexportbuildfile(this);
    this.datapackserrorhandling = new datapackserrorhandling(this);
    this.queryservice = new queryservice(this);
    this.validationtest = new validationtest(this);
    this.utilityservice = new utilityservice(this);
    this.deltacheck = new deltacheck(this);
};

Vlocity.runDataPacksCommand = async function(action, options) {
    var passedInOptions = JSON.parse(JSON.stringify(options));
    
    switch (action) {
        case 'Compare':
            return await Vlocity.compare(options);
        case 'Migrate':
            return await Vlocity.migrate(options);
        case 'RevertChange':
            return await Vlocity.revertChange(options);
        case 'DeltaMigrate':
            return await Vlocity.deltaMigrate(options);
        case 'GetAvailable':
            return await Vlocity.getAvailable(options);
    }

    var vlocity_run = new Vlocity(passedInOptions);
    delete passedInOptions.password;
    delete passedInOptions.accessToken;
    
    await vlocity_run.checkLogin();

    return await vlocity_run.datapacksjob.runJob(action, passedInOptions);
}

Vlocity.getEnvironmentInfo = function(environment, options) {
    var passedInOptions = JSON.parse(JSON.stringify(options));

    if (environment == 'local') {

    } else {
        passedInOptions.sfdxUsername = environment;
        passedInOptions.tempFolder = path.join(passedInOptions.tempFolder, environment.replace('.', '_').replace('@', '_'));
        passedInOptions.projectPath = path.join(passedInOptions.tempFolder, 'project');
        passedInOptions.buildFile = path.join(passedInOptions.tempFolder, 'AllDataPacks.json');
        passedInOptions.expansionPath = 'datapacks';
    }

    return passedInOptions;
}

Vlocity.getComparisonInfo = function(options) {
    var passedInOptions = JSON.parse(JSON.stringify(options));
    passedInOptions.comparisonFolder = path.join(options.tempFolder, 'comparison', options.source.replace('.', '_').replace('@', '_'), options.target.replace('.', '_').replace('@', '_'));
    passedInOptions.sourceFileCurrent = path.join(passedInOptions.comparisonFolder, SOURCE_FILE_CURRENT);
    
    passedInOptions.diffsFileCurrent = path.join(passedInOptions.comparisonFolder, DIFFS_FILE_CURRENT);
    passedInOptions.targetFileCurrent = path.join(passedInOptions.comparisonFolder, TARGET_FILE_CURRENT);
   
    passedInOptions.hasComparison = fs.existsSync(passedInOptions.sourceFileCurrent);
    return passedInOptions;
}

Vlocity.migrate = async function(options) {
    var comparisonInfo = Vlocity.getComparisonInfo(options);

    if (comparisonInfo.hasComparison) {
        if (options.target == 'local') {
            options.buildFile = comparisonInfo.sourceFileCurrent;
            return await Vlocity.runDataPacksCommand('ExpandFile', options);
        } else {
            options.sfdxUsername = options.target;
            options.buildFile = comparisonInfo.sourceFileCurrent;
            options.projectPath = comparisonInfo.comparisonFolder;
            options.expansionPath = 'datapacks';
            fs.removeSync(path.join(comparisonInfo.comparisonFolder, comparisonInfo.expansionPath));

            await Vlocity.runDataPacksCommand('ExpandFile', options);
            return await Vlocity.runDataPacksCommand('Deploy', options);
        }  
    } else if (options.source == 'local') {
        if (options.target == 'local') {

        } else {
            options.sfdxUsername = options.target;
            return await Vlocity.runDataPacksCommand('Deploy', options);
        }
    } else {
        if (options.target == 'local') {
            options.sfdxUsername = options.source;
            return await Vlocity.runDataPacksCommand('Export', options);
        } else if (options.target) {
            var sourceOptions = Vlocity.getEnvironmentInfo(options.source, options);
            sourceOptions.sfdxUsername = options.target;
            return await Vlocity.runDataPacksCommand('Deploy', sourceOptions);
        } 
    } 
}

Vlocity.refresh = async function(options) {

    if (options.sfdxUsername) {
       // options.deltaCheck = true;
        await Vlocity.runDataPacksCommand('Export', options);
    }
}

Vlocity.getDataPacks = async function(options) {
    var passedInOptions = JSON.parse(JSON.stringify(options));

    passedInOptions.workingSet = null;

    let buildResult = await Vlocity.runDataPacksCommand('BuildFile', passedInOptions);

    return buildResult.records[0];
}

Vlocity.getAllDataByRecordSourceKey = function(dataPackData, dataPackBySourceKey) {

    if (dataPackData.VlocityDataPackData) {
        Vlocity.getAllDataByRecordSourceKey(dataPackData.VlocityDataPackData, dataPackBySourceKey);
    } else {
        if (dataPackData.VlocityRecordSourceKey) {
            dataPackBySourceKey[dataPackData.VlocityRecordSourceKey] = dataPackData;
        }

        Object.keys(dataPackData).forEach(function(childDataKey) {

            var childData = dataPackData[childDataKey];

            if (Array.isArray(childData)) {
                childData.forEach(function(child) {
                    Vlocity.getAllDataByRecordSourceKey(child, dataPackBySourceKey);
                });
            }
        });
    }
}

Vlocity.revertChange = async function(options) {

    var comparisonInfo = Vlocity.getComparisonInfo(options);

    var comparisonFile = JSON.parse(fs.readFileSync(comparisonInfo.sourceFileCurrent, 'utf8')); 
    var diffsFile = JSON.parse(fs.readFileSync(comparisonInfo.diffsFileCurrent, 'utf8')); 

    var allDataPacksBySourceKey = {};
    for (var dataPack of comparisonFile.dataPacks) {
        Vlocity.getAllDataByRecordSourceKey(dataPack, allDataPacksBySourceKey);
    }

    var allDiffsBySourceKey = {};

    for (var data of diffsFile.records) {
        for (var record of (data.SObjects || [])) {
            for (var diff of (record.fieldDiffs || [])) {
                allDiffsBySourceKey[diff.VlocityRecordSourceKey] = diff;
            }
        }
    }

    if (typeof options.revertByKey == 'string') {
        options.revertByKey = JSON.parse(options.revertByKey);
    }

    if (options.revertByKey && !Array.isArray(options.revertByKey)) {
        options.revertByKey = [ options.revertByKey ];
    }

    for (var revertRecord of (options.revertByKey || [])) {
        var revertSObject = allDataPacksBySourceKey[revertRecord.VlocityRecordSourceKey];

        revertSObject[revertRecord.field] = revertRecord.old;
    }

    if (typeof options.editByKey == 'string') {
        options.editByKey = JSON.parse(options.editByKey);
    }

    if (options.editByKey && !Array.isArray(options.editByKey)) {
        options.editByKey = [ options.editByKey ];
    }

    for (var editRecord of (options.editByKey || [])) {

        var editSObject = allDataPacksBySourceKey[revertRecord.VlocityRecordSourceKey];
        editSObject.clear();

        Object.merge(editSObject, editRecord);
    }

    fs.outputFileSync(comparisonInfo.sourceFileCurrent, JSON.stringify(comparisonFile), 'utf8');

    return await Vlocity.compare(options);
}

Vlocity.compare = async function(options) {
    // username
    // projectfile

    var comparisonInfo = Vlocity.getComparisonInfo(options);
    if (options.refresh && options.source != 'local') { 
        fs.removeSync(comparisonInfo.comparisonFolder);
        await Vlocity.refresh(Vlocity.getEnvironmentInfo(options.source, options));
    }

    if (!fs.existsSync(comparisonInfo.sourceFileCurrent)) {
        options.sourceData = await Vlocity.getDataPacks(Vlocity.getEnvironmentInfo(options.source, options));

        if (options.sourceData) {
            fs.outputFileSync(comparisonInfo.sourceFileCurrent, stringify(options.sourceData), 'utf8');
        }
    } else {
        options.sourceData = JSON.parse(fs.readFileSync(comparisonInfo.sourceFileCurrent, 'utf8'));
    }

    options.manifest = [];

    for (var dataPack of options.sourceData.dataPacks) {
        options.manifest.push(dataPack.VlocityDataPackKey);
    }

    if ( options.refresh && options.target != 'local') {
        await Vlocity.refresh(Vlocity.getEnvironmentInfo(options.target, options));
    }

    if (!fs.existsSync(comparisonInfo.targetFileCurrent)) {
        options.targetData = await Vlocity.getDataPacks(Vlocity.getEnvironmentInfo(options.target, options));

        if (options.targetData) {
            fs.outputFileSync(comparisonInfo.targetFileCurrent, stringify(options.targetData), 'utf8');
        }
    } else {
        options.targetData = JSON.parse(fs.readFileSync(comparisonInfo.targetFileCurrent, 'utf8'));
    }

    options.sfdxUsername = options.source != 'local' ? options.source : options.target;

    let differences = await Vlocity.runDataPacksCommand('DiffPacks', options);

    fs.outputFileSync(comparisonInfo.diffsFileCurrent, stringify(differences, { space: 4 }), 'utf8');
   
    return differences;
}

Vlocity.getAvailable = async function(options) {
    if (options.source == 'local') {
        return await Vlocity.runDataPacksCommand('BuildManifest', options);
    } else {
        options.sfdxUsername = options.source;

        return await Vlocity.runDataPacksCommand('GetAllAvailableExports', options);
    }
}

Vlocity.prototype.checkLogin = async function(options) {
    return await this.utilityservice.checkLogin();
}