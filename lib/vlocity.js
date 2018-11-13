var jsforce = require('jsforce');
var yaml = require('js-yaml');
var fs = require('fs-extra');
var path = require('path');
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
var sfdx = require('sfdx-node');
var stringify = require('json-stable-stringify');

VLOCITY_BUILD_VERSION = require('../package.json').version;

var COMPARISON_FILE_CURRENT = 'comparisonFileCurrent.json';
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
/*
Vlocity.revertDiff = async function(options) {

    var comparisonFile = JSON.parse(fs.readFileSync(path.join(Vlocity.getComparisonFile(options.tempFolder, options.source, options.target), 'compareFileCurrent.json'), 'utf8'));

    var diffsFile = JSON.parse(fs.readFileSync(path.join(Vlocity.getComparisonFile(options.tempFolder, options.source, options.target), 'diffsFileCurrent.json'), 'utf8'));

    //for (comparisonFile.)
    Vlocity.getAllDataByRecordSourceKey()

    for (var data of options.revertData) {

    }

    fs.outputFileSync(path.join(Vlocity.getComparisonFile(options.tempFolder, options.source, options.target), 'compareFileCurrent.json'), stringify(comparisonFile), 'utf8');
    
    // org/username
    // project/path
    // git/url

    try {
        if (!options.source) {
            options.source = 'local';
        }

        if (!options.target) {
            options.target = 'local';
        }

        if (options.refresh) {
            await Vlocity.refresh(options.source, options);
            await Vlocity.refresh(options.target, options);
        }

        options.sourceData = await Vlocity.getDataPacks(options.source, options);
        options.targetData = await Vlocity.getDataPacks(options.target, options);

        return await Vlocity.runDataPacksCommand('DiffPacks', options);
    } catch (e) {
        console.log(e);
    }
}
*/

Vlocity.compare = async function(options) {

    // username
    // projectfile
    
    var comparisonInfo = Vlocity.getComparisonInfo(options);
    if (options.refresh) {
        fs.removeSync(comparisonInfo.comparisonFolder);
        await Vlocity.refresh(Vlocity.getEnvironmentInfo(options.source, options));
    }

    options.sourceData = await Vlocity.getDataPacks(Vlocity.getEnvironmentInfo(options.source, options));

    options.manifest =  [];

    for (var dataPack of options.sourceData.dataPacks) {
        options.manifest.push(dataPack.VlocityDataPackKey);
    }

    if (options.refresh) {
        await Vlocity.refresh(Vlocity.getEnvironmentInfo(options.target, options));
    }

    options.targetData = await Vlocity.getDataPacks(Vlocity.getEnvironmentInfo(options.target, options));

    options.sfdxUsername = options.source != 'local' ? options.source : options.target;

    fs.outputFileSync(comparisonInfo.comparisonFileCurrent, stringify(options.sourceData), 'utf8');

    let differences = await Vlocity.runDataPacksCommand('DiffPacks', options);

    fs.outputFileSync(comparisonInfo.diffsFileCurrent, stringify(differences), 'utf8');
   
    return differences;
}

Vlocity.prototype.loginFailedMessage = function(error) {
    return 'Login Failed - Username: ' + (this.username ? (this.username + ' ') : 'None Provided') + ' Error ' + error;
}

Vlocity.prototype.sfdxLogin = async function() {
    var self = this;

    VlocityUtils.report('Using SFDX', self.sfdxUsername);

    try {
        var stored = JSON.parse(fs.readFileSync(path.join(self.tempFolder, 'sfdx', self.sfdxUsername + '.json')));

        self.jsForceConnection = new jsforce.Connection(stored);

        var identity = await self.jsForceConnection.identity();
        
        if (identity.username == stored.username) {
            VlocityUtils.report('Using SFDX Session');
            return stored;
        }

    } catch (e) {
        VlocityUtils.verbose('Session Not Found');
    }

    VlocityUtils.report('Refreshing SFDX Session', self.sfdxUsername);

    let orgInfo = await sfdx.org.display({ targetusername: self.sfdxUsername });

    if (orgInfo) {
        self.jsForceConnection = new jsforce.Connection(orgInfo);
        fs.outputFileSync(path.join(self.tempFolder, 'sfdx', self.sfdxUsername + '.json'), stringify(orgInfo, { space: 4 }));
        return orgInfo;
    } else {
        throw self.loginFailedMessage('Salesforce DX Org Info Not Found');
    }   
}

Vlocity.prototype.login = async function(retryCount) {
    var self = this;
    try {
        var result = await self.jsForceConnection.login(self.username, self.password);
        self.organizationId = result.organizationId;
    } catch (err) {
        if (!retryCount || retryCount < 5) {
            VlocityUtils.error('Login Failed', 'Retrying', self.loginFailedMessage(err));
            await self.login(retryCount ? ++retryCount : 1);
        } else {
            throw self.loginFailedMessage(err);
        }

        self.getNamespace(function(err, res) {
            onSuccess();
        }, onError);
    };
}

Vlocity.prototype.checkLogin = async function() {
    var self = this;
    VlocityUtils.verbose('Check Login');

    if (self.sessionId || self.accessToken) {
        await self.getNamespace();
    } else if (self.sfdxUsername) {
        await self.sfdxLogin();
        await self.getNamespace();
    } else if (self.username && self.password) {
        await self.login();
        await self.getNamespace();
    } else {
        if (self.passedInNamespace) {
            self.namespace = self.passedInNamespace;
        } else {
            self.namespace = 'NoNamespace';
        }

        VlocityUtils.verbose('Update Definitions');

        self.datapacksutils.dataPacksExpandedDefinition = self.datapacksutils.updateExpandedDefinitionNamespace(self.datapacksutils.dataPacksExpandedDefinition);
        
        self.PackageVersion = 'No Login';
        self.BuildToolSettingVersion = "latest";
    }
};

Vlocity.prototype.getNamespace = async function() {
    var self = this;
    VlocityUtils.verbose('Get Namespace');

    if (!self.namespace) {
        var result;
        try {
            result = await self.jsForceConnection.query("Select Name, NamespacePrefix from ApexClass where Name = 'DRDataPackService'");
        } catch (err) {
            if (self.passedInNamespace) {
                return;
            } else if (err.code == 'ECONNRESET') {
                await self.getNamespace();
            } else {
                throw 'Namespace Query ' + err;
            }
        }
    
        if (result && result.records && result.records.length > 0) {
            self.namespace = result.records[0].NamespacePrefix;
        }

        if (!self.namespace && self.passedInNamespace) {
            self.namespace = self.passedInNamespace;
        }

        if (self.namespace == null) {
            throw 'No namespace found - Either set the vlocity.namespace property on the CLI or ensure you have the DRDataPackService class deployed';
        } 
        
        VlocityUtils.namespace = self.namespace;

        self.namespacePrefix = self.namespace ? self.namespace + '__' : '';

        VlocityUtils.verbose('Update Definitions');

        self.datapacksutils.dataPacksExpandedDefinition = self.datapacksutils.updateExpandedDefinitionNamespace(self.datapacksutils.dataPacksExpandedDefinition);

        await self.getPackageVersion();
        
    }
};

Vlocity.prototype.getPackageVersion = async function() {
    var self = this;
    VlocityUtils.verbose('Get Package Version');

    if (!self.packageVersion) {
        var result = await self.jsForceConnection.query("SELECT DurableId, Id, IsSalesforce, MajorVersion, MinorVersion, Name, NamespacePrefix FROM Publisher where NamespacePrefix = \'" + self.namespace + "\' LIMIT 1");

        self.buildToolsVersionSettings = yaml.safeLoad(fs.readFileSync(path.join(__dirname, "buildToolsVersionSettings.yaml"), 'utf8'));

        self.BuildToolSettingLatestVersion = self.buildToolsVersionSettings.latest;

        if (!result || !result.records || result.records.length == 0) {
            self.PackageVersion = "DeveloperOrg";
            self.BuildToolSettingVersion = "latest";
        } else {
            self.PackageVersion = result.records[0].MajorVersion + "." + result.records[0].MinorVersion;
            self.PackageMajorVersion = result.records[0].MajorVersion;
            self.PackageMinorVersion = result.records[0].MinorVersion;

            if (self.buildToolsVersionSettings[self.namespace]) {
                for (var i = 0; i < self.buildToolsVersionSettings[self.namespace].length; i++) {

                    var version = self.buildToolsVersionSettings[self.namespace][i];

                    if (self.PackageMajorVersion > version.PackageMajorVersion) {
                        self.BuildToolSettingVersion = version.version;
                        break;
                    } else if (self.PackageMajorVersion == version.PackageMajorVersion) {
                        if (self.PackageMinorVersion >= version.PackageMinorVersion) {
                            self.BuildToolSettingVersion = version.version;
                            break;
                        }
                    }
                }

                if (!self.BuildToolSettingVersion) {
                    self.BuildToolSettingVersion = "latest";
                }
            }
        }
    }
};
