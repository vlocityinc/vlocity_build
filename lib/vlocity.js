var jsforce = require('jsforce');
var yaml = require('js-yaml');
var fs = require('fs-extra');
var path = require('path');
var stringify = require('json-stable-stringify');
var child_process = require('child_process');

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

    this.id = options.id;

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

process.on('message', async (input) => {
    let response = await Vlocity.runDataPacksCommand(input.action, input.options);
    process.send(response);
});

Vlocity.runDataPacksCommandInChildProcess = async function(action, options) {
    let promise = await new Promise((resolve) => {

        try {

            var childOptions = JSON.parse(JSON.stringify(options));

            childOptions.chdir = childOptions.tempFolder;
            childOptions.projectPath = path.relative(childOptions.tempFolder, childOptions.projectPath);
            
            const forkedVlocity = child_process.fork(path.join(__dirname, 'vlocity.js'), { stdio: 'inherit' });
            forkedVlocity.send({ action: action, options: childOptions });

            forkedVlocity.on('message', response => {
                resolve(response);
            });        
        } catch (e) {
            VlocityUtils.error(e);
        }
           
    });

    return promise;
}

Vlocity.runDataPacksCommand = async function(action, options) {

    if (options.chdir) {
        if (!fs.existsSync(options.chdir)) {
            VlocityUtils.report(`No ${options.chdir} found - will create new one`);
            fs.mkdirSync(options.chdir, { recursive: true });
        }

        process.chdir(options.chdir);
    }

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

    try {
        await vlocity_run.checkLogin();
    } catch (e) {
        VlocityUtils.error('Login Failed', e);
        return { message: e, result: [], status: 'loginerror' };
    }

    return await vlocity_run.datapacksjob.runJob(action, passedInOptions);
}

Vlocity.getEnvironmentInfo = function(environment, options) {
    var passedInOptions = JSON.parse(JSON.stringify(options));

    if (environment == 'local') {

    } else {
        passedInOptions.id = options.id;
        passedInOptions.sfdxUsername = environment;
        passedInOptions.tempFolder = path.join(passedInOptions.tempFolder, environment.replace('.', '_').replace('@', '_'));
        passedInOptions.projectPath = path.join(passedInOptions.tempFolder, 'project');
        passedInOptions.buildFile = path.join(passedInOptions.tempFolder, 'AllDataPacks.json');
        passedInOptions.expansionPath = 'datapacks';
        passedInOptions.resetSfdxProjectLocation = true;
        //passedInOptions.deleteSfdxProject = options.refresh;
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

    VlocityUtils.report('Starting Migrate', comparisonInfo);

    if (comparisonInfo.hasComparison) {
        if (options.target == 'local') {
            options.buildFile = comparisonInfo.sourceFileCurrent;
         
            if (!fs.existsSync(path.join(options.projectPath, 'sfdx-project.json'))) {
                fs.outputFileSync(path.join(options.projectPath, 'sfdx-project.json'), JSON.stringify({
                    "packageDirectories": [
                        {
                            "path": 'salesforce_sfdx',
                            "default": true
                        }
                    ],
                    "namespace": "",
                    "sfdcLoginUrl": "https://login.salesforce.com",
                    "sourceApiVersion": 44.0
                }, null, 4), {encoding: 'utf8'});
            }
            
            var sfdxProject = JSON.parse(fs.readFileSync(path.join(options.projectPath, 'sfdx-project.json')));

            options.sfdxFolderPath = path.join(options.projectPath, sfdxProject.packageDirectories[0].path);

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
            options.resetSfdxProjectLocation = true;
            options.sfdxExpandFolder = comparisonInfo.comparisonFolder;

            try {
                fs.removeSync(path.join(comparisonInfo.comparisonFolder, comparisonInfo.expansionPath));
                fs.removeSync(path.join(comparisonInfo.comparisonFolder, 'DX'));
            } catch (e) {
                VlocityUtils.error('Cannot Remove Directories', e);
            }
            
            await Vlocity.runDataPacksCommand('ExpandFile', options);

            //delete options.manifest;

            VlocityUtils.success('Starting Deploy', options);
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
    var passedInOptions = JSON.parse(JSON.stringify(options));

    passedInOptions.workingSet = null;
    passedInOptions.resetSfdxProjectLocation = true;

    try {
        let buildResult = await Vlocity.runDataPacksCommand('BuildFile', passedInOptions);
        return buildResult.records[0];
    } catch (e) {
        return;
    }
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

Vlocity.removeDiscardedSObjects = function(dataPackData) {

    if (!dataPackData) return;

    if (dataPackData.dataPacks) {
        dataPackData.dataPacks.forEach(dataPack => {
            Vlocity.removeDiscardedSObjects(dataPack.VlocityDataPackData);
        });
    } else if (dataPackData) { 
        if (dataPackData.VlocityDataPackIsIncluded === true) {
            Object.keys(dataPackData).forEach(function(childDataKey) {

                if (Array.isArray(dataPackData[childDataKey])) {

                    dataPackData[childDataKey] = dataPackData[childDataKey].filter(child => {
                        return !(child.VlocityDataPackIsIncluded === false);
                    });

                    dataPackData[childDataKey].forEach(child => {
                        Vlocity.removeDiscardedSObjects(child);
                    });
                }
            });
        }
    }
};

Vlocity.revertChange = async function(options) {

    var comparisonInfo = Vlocity.getComparisonInfo(options);

    var comparisonFileSource = JSON.parse(fs.readFileSync(comparisonInfo.sourceFileCurrent, 'utf8')); 
    var diffsFile = JSON.parse(fs.readFileSync(comparisonInfo.diffsFileCurrent, 'utf8')); 

    var allDataPacksBySourceKeySource = {};
    for (var dataPack of comparisonFileSource.dataPacks) {
        Vlocity.getAllDataByRecordSourceKey(dataPack, allDataPacksBySourceKeySource);
    }
    
    // Lazy loaded
    var allDataPacksBySourceKeyTarget = null;

    var allDiffsBySourceKey = {};

    for (var data of diffsFile.records) {
        for (var record of (data.SObjects || [])) {
            for (var diff of (record.fieldDiffs || [])) {

                diff.ParentDiffStatus = record.diffType;
                allDiffsBySourceKey[diff.VlocityRecordSourceKey] = diff;
            }
        }
    }

    if (typeof options.revertByKey == 'string') {
        options.revertByKey = JSON.parse(options.revertByKey);
    }

    var revertByKey = [];

    if (options.revertByKey) {
        if (typeof options.revertByKey === 'object' && options.revertByKey[0]) {
            for (var key of Object.keys(options.revertByKey)) {
               revertByKey.push(options.revertByKey[key]);
            }
        } else {
            revertByKey = [ options.revertByKey ];
        }
    }

    for (var revertRecord of revertByKey) {
        var revertSObject = allDataPacksBySourceKeySource[revertRecord.VlocityRecordSourceKey];

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
        } else if (revertRecord.revertHandler) {

            if (allDataPacksBySourceKeyTarget == null) {
                var allDataPacksBySourceKeyTarget = {}; 
                var comparisonFileTarget = JSON.parse(fs.readFileSync(comparisonInfo.targetFileCurrent, 'utf8'));
                for (var dataPack of comparisonFileTarget.dataPacks) {
                    Vlocity.getAllDataByRecordSourceKey(dataPack, allDataPacksBySourceKeyTarget);
                }
            }

            DataPacksUtils.handleStaticDataPackEventSync('staticHandleRevert', revertRecord.VlocityDataPackType, { comparisonFileSource, comparisonFileTarget, revertRecord })
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
        var currentSObject = allDataPacksBySourceKeySource[overwritingSObject.VlocityRecordSourceKey];
        if (overwritingSObject.VlocityRecordEditField) {
            currentSObject[overwritingSObject.VlocityRecordEditField] = overwritingSObject.TitleObjectCode;

        } else {
            if (!currentSObject.SFDXData) {
                for (var field in currentSObject) {

                    if (!Vlocity.isSObjectArray(currentSObject[field])) {
                        delete currentSObject[field];
                    }
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
    }

    var removeDiscarded = false;

    var discardSObjectByKey = [];

    if (typeof options.discardSObjectByKey == 'string') {
        options.discardSObjectByKey = JSON.parse(options.discardSObjectByKey);
    }
    
    if (options.discardSObjectByKey) {
        if (typeof options.discardSObjectByKey === 'object' && options.discardSObjectByKey["0"]) {
            for (var key of Object.keys(options.discardSObjectByKey)) {
                discardSObjectByKey.push(options.discardSObjectByKey[key]);
            }
        } else {
            discardSObjectByKey = [ options.discardSObjectByKey ];
        }

        if (allDataPacksBySourceKeyTarget == null) {
            var allDataPacksBySourceKeyTarget = {}; 
            var comparisonFileTarget = JSON.parse(fs.readFileSync(comparisonInfo.targetFileCurrent, 'utf8'));
            for (var dataPack of comparisonFileTarget.dataPacks) {
                Vlocity.getAllDataByRecordSourceKey(dataPack, allDataPacksBySourceKeyTarget);
            }
        }
    }

    var alreadyDiscarded = {};

    let vlocityTemp = null;

    for (var discardSObject of (discardSObjectByKey || [])) {
       
        if (!alreadyDiscarded[discardSObject.VlocityRecordSourceKey]) {
            alreadyDiscarded[discardSObject.VlocityRecordSourceKey] = true;
            
            if (discardSObject.diffType === 'New') {
                var currentSObject = allDataPacksBySourceKeySource[discardSObject.VlocityRecordSourceKey];

                if (currentSObject) {
                    removeDiscarded = true;
                    currentSObject.VlocityDataPackIsIncluded = false;
                }
            } else if (discardSObject.diffType === 'Deleted') {
                var deletedObject = allDataPacksBySourceKeyTarget[discardSObject.VlocityRecordSourceKey];
                var parentObject = allDataPacksBySourceKeySource[discardSObject.VlocityDiffParentKey];

                if (deletedObject && parentObject) {

                    if (!vlocityTemp) {
                        vlocityTemp = new Vlocity(options);
                        await vlocityTemp.checkLogin();
                    }

                    var customDiscardHandler = await vlocityTemp.datapacksutils.handleDataPackEvent('discardSObjet', deletedObject.VlocityDataPackType, { deletedObject: deletedObject, parentObject: parentObject });

                    if (!customDiscardHandler) {
                        if (!parentObject[discardSObject.VlocityDiffParentField]) {
                            parentObject[discardSObject.VlocityDiffParentField] = [];
                        }

                        parentObject[discardSObject.VlocityDiffParentField].push(deletedObject);
                    }
                    
                    parentObject[discardSObject.VlocityDiffParentField] = vlocityTemp.datapacksexpand.sortList(parentObject[discardSObject.VlocityDiffParentField], discardSObject.VlocityDataPackType);
                    
                }
            } else if (discardSObject.diffType === 'Changed') {
                var targetObject = allDataPacksBySourceKeyTarget[discardSObject.VlocityRecordSourceKey];
                var sourceObject = allDataPacksBySourceKeySource[discardSObject.VlocityRecordSourceKey];

                if (targetObject && sourceObject) {

                    for (var field in sourceObject) {
                        if (!Vlocity.isSObjectArray(sourceObject[field])) {
                            delete sourceObject[field];
                        }
                    }

                    for (var field in targetObject) {
                        if (!Vlocity.isSObjectArray(targetObject[field])) {
                            sourceObject[field] = targetObject[field];
                        }
                    }
                }
            }
        }
    }

    if (removeDiscarded) {
        Vlocity.removeDiscardedSObjects(comparisonFileSource);
    }

    fs.outputFileSync(comparisonInfo.sourceFileCurrent, JSON.stringify(comparisonFileSource), 'utf8');

    return { status: 'success' };
}

Vlocity.isSObjectArray = function(objectList) {

    return Array.isArray(objectList) && objectList.length > 0 && typeof objectList[0] == 'object' && objectList[0] != null && objectList[0].VlocityRecordSObjectType;
}

Vlocity.compare = async function(options) {
    var comparisonInfo = Vlocity.getComparisonInfo(options);
    if ((options.refreshSource && options.refreshTarget) || options.resetDiffs) {

        try {
            fs.removeSync(comparisonInfo.comparisonFolder);
        } catch (e) {
            VlocityUtils.error('Cannot Remove Directories', comparisonInfo.comparisonFolder, e);
        }
       
    }

    var refreshPromises = [];
        
    if (options.refreshSource) { 

        try {
            fs.removeSync(comparisonInfo.sourceFileCurrent);
        } catch (e) {
            VlocityUtils.error('Cannot Remove Directories', comparisonInfo.sourceFileCurrent, e);
        }
        
        if (options.source != 'local') {
            var refreshOptionsSource = Vlocity.getEnvironmentInfo(options.source, options);

            if (!refreshOptionsSource.manifest) {
                try {
                    fs.removeSync(refreshOptionsSource.tempFolder);
                } catch (e) {
                    VlocityUtils.error('Cannot Remove Directories', refreshOptionsSource.tempFolder, e);
                }
            }

            if (options.allowChildProcesses 
                && refreshOptionsSource.includeSalesforceMetadata 
                && options.refreshTarget 
                && options.target != 'local') {

                var sfdxOptions =  JSON.parse(JSON.stringify(refreshOptionsSource));
                sfdxOptions.projectPath = path.join(sfdxOptions.projectPath, 'DX');
                VlocityUtils.error('sfdxOptions', sfdxOptions);
                
                await Vlocity.runDataPacksCommand('RetrieveSalesforce', sfdxOptions);

                refreshOptionsSource.includeSalesforceMetadata = false;
            }

            if (options.allowChildProcesses) {
                refreshPromises.push(Vlocity.runDataPacksCommandInChildProcess('Export', refreshOptionsSource));

            } else {
                await Vlocity.runDataPacksCommand('Export', refreshOptionsSource);
            }
        }
    }

    if (options.refreshTarget) {
    
        try {
            fs.removeSync(comparisonInfo.targetFileCurrent);
        } catch (e) {
            VlocityUtils.error('Cannot Remove Directories', comparisonInfo.targetFileCurrent, e);
        }

        if (options.target != 'local') {
            var refreshOptionsTarget = Vlocity.getEnvironmentInfo(options.target, options);

            if (!refreshOptionsTarget.manifest) {
                try {
                    fs.removeSync(refreshOptionsTarget.tempFolder);
                } catch (e) {
                    VlocityUtils.error('Cannot Remove Directories', refreshOptionsTarget.tempFolder, e);
                }   
            }

            if (options.allowChildProcesses) {
                refreshPromises.push(Vlocity.runDataPacksCommandInChildProcess('Export', refreshOptionsTarget));
            } else {
                await Vlocity.runDataPacksCommand('Export', refreshOptionsTarget);
            }
        }
    }
    
    var promiseResults = await Promise.all(refreshPromises);

    for (var promiseResults of promiseResults){
        if (promiseResults && promiseResults.status == 'loginerror') {
            throw promiseResults.message;
        }
    }        

    options.manifest = null;
    
    if (!fs.existsSync(comparisonInfo.sourceFileCurrent)) {
        options.sourceData = await Vlocity.getDataPacks(Vlocity.getEnvironmentInfo(options.source, options));
        if (options.sourceData) {
            fs.outputFileSync(comparisonInfo.sourceFileCurrent, JSON.stringify(options.sourceData, null, 4), 'utf8');
        }

        if (!options.sourceData) {
            options.sourceData = { dataPacks: [] };
        }
    } else {
        options.sourceData = JSON.parse(fs.readFileSync(comparisonInfo.sourceFileCurrent, 'utf8'));
    }
    
    if (!fs.existsSync(comparisonInfo.targetFileCurrent)) {
        options.targetData = await Vlocity.getDataPacks(Vlocity.getEnvironmentInfo(options.target, options));
       
        if (options.targetData) {
            fs.outputFileSync(comparisonInfo.targetFileCurrent, JSON.stringify(options.targetData, null, 4), 'utf8');
        }

        if (!options.targetData) {
            options.targetData = { dataPacks: [] };
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

    fs.outputFileSync(comparisonInfo.diffsFileCurrent, JSON.stringify(differences, null, 4), 'utf8');
   
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