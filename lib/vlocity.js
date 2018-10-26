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
var utilityservice = require('./utilityservice.js');
var sfdx = require('sfdx-node');
var stringify = require('json-stable-stringify');

VLOCITY_BUILD_VERSION = require('../package.json').version;

var Vlocity = module.exports = function(options) {
    options = options || {};

    this.sfdxUsername = options.sfdxUsername;

    this.username = options.username || options.sfdxUsername;
    this.password = options.password;

    this.passedInNamespace = options.vlocityNamespace;
    
    this.verbose = !!options.verbose;

    VlocityUtils.verboseLogging = !!options.verbose;
    VlocityUtils.performance = !!options.performance;

    this.sessionId = options.sessionId;
    this.instanceUrl = options.instanceUrl;
    this.accessToken = options.accessToken;

    this.passedInOptionsOverride = options.commandLineOptionsOverride;

    this.tempFolder = options.tempFolder || './vlocity-temp';

    VlocityUtils.verbose('Verbose mode enabled');

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

    let promise = await new Promise(async function(resolve, reject) {

        var passedInOptions = JSON.parse(JSON.stringify(options));
        var vlocity_run = new Vlocity(passedInOptions);
        delete passedInOptions.password;
        delete passedInOptions.accessToken;
        
        await vlocity_run.checkLogin();

        return vlocity_run.datapacksjob.runJob(action, passedInOptions, 
            function(result) {
                resolve(result);
            }, function(result) {
                reject(result);
            });
    })
    .catch(err => { 
        throw err;
    });

    return promise;
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
    } catch (err) {
        if (!retryCount || retryCount < 5) {
            VlocityUtils.error('Login Failed', 'Retrying', self.loginFailedMessage(err));
            await self.login(retryCount ? ++retryCount : 1);
        } else {
            throw self.loginFailedMessage(err);
        }
    }
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
                return await self.getNamespace();
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
