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
            let expandResult = await Vlocity.runDataPacksCommand('ExpandFile', options);

            delete options.manifest;

            options.buildFile = comparisonInfo.targetFileCurrent;
            await Vlocity.getDataPacks(Vlocity.getEnvironmentInfo(options.target, options));
            
            return expandResult;
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

    var revertByKey = [];

    if (options.revertByKey) {

        if (options.revertByKey[0]) {
            for (var i = 0; i < 1000; i++) {
                if (options.revertByKey[i]) {
                    revertByKey.push(options.revertByKey[i]);
                }
            }
        } else {
            revertByKey = [ options.revertByKey ];
        }
    }

    for (var revertRecord of revertByKey) {
        var revertSObject = allDataPacksBySourceKey[revertRecord.VlocityRecordSourceKey];

        if (revertRecord.field.includes('.')) {
            var fieldPaths = revertRecord.field.split('.');
            revertSObject[fieldPaths[0]] = JSON.parse(revertSObject[fieldPaths[0]]);

            var currentObject = revertSObject[fieldPaths[0]];
            var i = 1;
            for (; i < fieldPaths.length-1; i++) {
                currentObject = currentObject[fieldPaths[i]];
            }

            currentObject[fieldPaths[i]] = revertRecord.old;
            revertSObject[fieldPaths[0]] = stringify(revertSObject[fieldPaths[0]]);
        } else {
            revertSObject[revertRecord.field] = revertRecord.old;
        }
    }

    if (typeof options.editByKey == 'string') {
        options.editByKey = JSON.parse(options.editByKey);
    }

    if (options.editByKey && !Array.isArray(options.editByKey)) {
        options.editByKey = [ options.editByKey ];
    }

    for (var overwritingSObject of (options.editByKey || [])) {

        var currentSObject = allDataPacksBySourceKey[overwritingSObject.VlocityRecordSourceKey];

        for (var field in currentSObject) {

            if (!Vlocity.isSObjectArray(currentSObject[field])) {
                delete currentSObject[field];
            }
        }

        for (var field in overwritingSObject) {

            if (typeof overwritingSObject[field] === 'object') {

                if (!overwritingSObject[field].VlocityRecordSObjectType) {
                    overwritingSObject[field] = stringify(overwritingSObject[field]);
                }
            }
        }

        Object.assign(currentSObject, overwritingSObject);
    }

    fs.outputFileSync(comparisonInfo.sourceFileCurrent, JSON.stringify(comparisonFile), 'utf8');

    return { status: 'success' };
}

Vlocity.isSObjectArray = function(objectList) {

    return Array.isArray(objectList) && objectList.length > 0 && typeof objectList[0] == 'object' && objectList[0] != null && objectList[0].VlocityRecordSObjectType;
}
Vlocity.compare = async function(options) {
    // username
    // projectfile
    //let retrieve = await Vlocity.runDataPacksCommand('RetrieveSalesforce', Vlocity.getEnvironmentInfo(options.source, options));

    //fs.outputFileSync(comparisonInfo.sourceFileCurrent + 'sfdx.json', stringify(retrieve, { space: 4 }), 'utf8');

    //return;
    var comparisonInfo = Vlocity.getComparisonInfo(options);
    if (!options.refresh && fs.existsSync(comparisonInfo.diffsFileCurrent)) {
       // return JSON.parse(fs.readFileSync(comparisonInfo.diffsFileCurrent, 'utf8'));
    } 
    
    if (options.refreshSource || options.refresh) { 
        if (options.refresh) {
            fs.removeSync(comparisonInfo.comparisonFolder);
        }
        
        options.deleteSfdxProject = true;
        await Vlocity.refresh(Vlocity.getEnvironmentInfo(options.source, options));
    }

    if (!fs.existsSync(comparisonInfo.sourceFileCurrent)) {
        options.sourceData = await Vlocity.getDataPacks(Vlocity.getEnvironmentInfo(options.source, options));
        if (options.sourceData) {
            fs.outputFileSync(comparisonInfo.sourceFileCurrent, stringify(options.sourceData, {space: 4}), 'utf8');
        }
    } else {
        options.sourceData = JSON.parse(fs.readFileSync(comparisonInfo.sourceFileCurrent, 'utf8'));
    }

    options.manifest = [];

    for (var dataPack of options.sourceData.dataPacks) {
        options.manifest.push(dataPack.VlocityDataPackKey);
    }

    if (options.refreshTarget || (options.refresh && options.target != 'local')) {
        options.deleteSfdxProject = true;
        await Vlocity.refresh(Vlocity.getEnvironmentInfo(options.target, options));
    }

    if (options.refreshTarget || !fs.existsSync(comparisonInfo.targetFileCurrent)) {
        options.targetData = await Vlocity.getDataPacks(Vlocity.getEnvironmentInfo(options.target, options));

        if (options.targetData) {
            fs.outputFileSync(comparisonInfo.targetFileCurrent, stringify(options.targetData,  {space: 4}), 'utf8');
        }
    } else {
        options.targetData = JSON.parse(fs.readFileSync(comparisonInfo.targetFileCurrent, 'utf8'));
    }

    if (options.source != 'local') {
        options.sfdxUsername = options.source;
    } else if (options.target != 'local') {
        options.sfdxUsername = options.target;
    } 

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