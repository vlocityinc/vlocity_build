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
var utilityservice = require('./utilityservice.js');


VLOCITY_BUILD_VERSION = require('../package.json').version;

var COMPARISON_FILE_CURRENT = 'comparisonFileCurrent.json';
var DIFFS_FILE_CURRENT = 'diffsFileCurrent.json';
var TARGET_FILE_CURRENT = 'targetFileCurrent.json';

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
};

Vlocity.runDataPacksCommand = async function(action, options) {
    var passedInOptions = JSON.parse(JSON.stringify(options));
    
    switch (action) {
        case 'Compare':
            return await Vlocity.compare(options);
        case 'Migrate':
            return await Vlocity.migrate(options);
        case 'Revert':
            return await Vlocity.revert(options);
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
        passedInOptions.buildFile = path.join(passedInOptions.projectPath, 'AllDataPacks.json');
        passedInOptions.expansionPath = 'datapacks';
    }

    return passedInOptions;
}

Vlocity.getComparisonInfo = function(options) {
    var passedInOptions = JSON.parse(JSON.stringify(options));
    passedInOptions.comparisonFolder = path.join(options.tempFolder, 'comparison', options.source.replace('.', '_').replace('@', '_'), options.target.replace('.', '_').replace('@', '_'));
    passedInOptions.comparisonFileCurrent = path.join(passedInOptions.comparisonFolder, COMPARISON_FILE_CURRENT);
    
    passedInOptions.diffsFileCurrent = path.join(passedInOptions.comparisonFolder, DIFFS_FILE_CURRENT);
    passedInOptions.targetFileCurrent = path.join(passedInOptions.comparisonFolder, TARGET_FILE_CURRENT);
   
    passedInOptions.hasComparison = fs.existsSync(passedInOptions.comparisonFileCurrent);
    return passedInOptions;
}

Vlocity.migrate = async function(options) {
    var comparisonInfo = Vlocity.getComparisonInfo(options);

    if (comparisonInfo.hasComparison) {
        if (options.target == 'local') {
            options.buildFile = comparisonInfo.comparisonFileCurrent;
            return await Vlocity.runDataPacksCommand('ExpandFile', options);
        } else {
            options.sfdxUsername = options.target;
            options.buildFile = comparisonInfo.comparisonFileCurrent;
            options.projectPath = comparisonInfo.comparisonFolder;
            options.expansionPath = 'datapacks';
            fs.removeSync(path.join(comparisonInfo.comparisonFolder, migrateOptions.expansionPath));

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
        await Vlocity.runDataPacksCommand('Export', options);
    }
}

Vlocity.getDataPacks = async function(options) {

    let buildResult = await Vlocity.runDataPacksCommand('BuildFile', options);

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

Vlocity.revert = async function(options) {

    var comparisonInfo = Vlocity.getComparisonInfo(options);

    var comparisonFile = JSON.parse(fs.readFileSync(comparisonInfo.comparisonFileCurrent, 'utf8')); 
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

    for (var revertRecord of (options.revertByKey || [])) {

        var revertSObject = allDataPacksBySourceKey[revertRecord.VlocityRecordSourceKey];

        revertSObject[revertRecord.field] = revertRecord.old;
    }

    if (typeof options.editByKey == 'string') {
        options.editByKey = JSON.parse(options.editByKey);
    }

    for (var editRecord of (options.editByKey || [])) {

        var editSObject = allDataPacksBySourceKey[revertRecord.VlocityRecordSourceKey];
        editSObject.clear();

        Object.merge(editSObject, editRecord);
    }

    fs.outputFileSync(comparisonInfo.comparisonFileCurrent, JSON.stringify(comparisonFile), 'utf8');

    return await Vlocity.compare(options);
}

Vlocity.compare = async function(options) {

    // username
    // projectfile
    var comparisonInfo = Vlocity.getComparisonInfo(options);
    if (options.refresh) {
        fs.removeSync(comparisonInfo.comparisonFolder);

        await Vlocity.refresh(Vlocity.getEnvironmentInfo(options.source, options));
        options.sourceData = await Vlocity.getDataPacks(Vlocity.getEnvironmentInfo(options.source, options));
    } else {
        options.sourceData = JSON.parse(fs.readFileSync(comparisonInfo.comparisonFileCurrent, 'utf8'));
    }

    options.manifest = [];

    for (var dataPack of options.sourceData.dataPacks) {
        options.manifest.push(dataPack.VlocityDataPackKey);
    }

    if (options.refresh) {
        await Vlocity.refresh(Vlocity.getEnvironmentInfo(options.target, options));

        options.targetData = await Vlocity.getDataPacks(Vlocity.getEnvironmentInfo(options.target, options));
        fs.outputFileSync(comparisonInfo.targetFileCurrent, stringify(options.targetData), 'utf8');
    } else {
        options.targetData = JSON.parse(fs.readFileSync(comparisonInfo.targetFileCurrent, 'utf8'));
    }

    options.sfdxUsername = options.source != 'local' ? options.source : options.target;

    fs.outputFileSync(comparisonInfo.comparisonFileCurrent, stringify(options.sourceData), 'utf8');

    let differences = await Vlocity.runDataPacksCommand('DiffPacks', options);

    fs.outputFileSync(comparisonInfo.diffsFileCurrent, stringify(differences), 'utf8');
   
    return differences;
}

Vlocity.prototype.checkLogin = async function(options) {
    return await this.utilityservice.checkLogin();
}


