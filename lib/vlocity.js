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

VLOCITY_BUILD_VERSION = '1.7.0';

var Vlocity = module.exports = function(options) {
    options = options || {};

    this.username = options.username;
    this.password = options.password;

    this.passedInNamespace = options.vlocityNamespace;
    
    this.verbose = !!options.verbose;

    VlocityUtils.verboseLogging = !!options.verbose;
    VlocityUtils.performance = !!options.performance;

    this.sessionId = options.sessionId;
    this.instanceUrl = options.instanceUrl;
    this.accessToken = options.accessToken;

    this.passedInOptionsOverride = options.commandLineOptionsOverride;

    this.tempFolder = './vlocity-temp';

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

    this.isLoggedIn = false;

    this.datapacksutils = new datapacksutils(this);
    this.datapacks = new datapacks(this);
    this.datapacksjob = new datapacksjob(this);
    this.datapacksexpand = new datapacksexpand(this);
    this.datapacksbuilder = new datapacksbuilder(this);
    this.datapacksexportbuildfile = new datapacksexportbuildfile(this);
};

Vlocity.runDataPacksCommand = async function(action, options) {

    let promise = await new Promise((resolve, reject) => {

        var passedInOptions = JSON.parse(JSON.stringify(options));
        var vlocity_run = new Vlocity(passedInOptions);
        delete passedInOptions.password;
        delete passedInOptions.accessToken;

        return vlocity_run.datapacksjob.runJob(action, passedInOptions, 
            function(result) {
                resolve(result);
            }, function(result) {
                reject(result);
            });
    })
    .catch(err => { 
        throw err 
    });

    return promise;
}

Vlocity.prototype.loginFailedMessage = function(error) {
    return 'Login Failed - Username: ' + (this.username ? (this.username + ' ') : 'None Provided') + ' Error ' + error;
}

Vlocity.prototype.checkLogin = function(onSuccess, onError, retryCount) {
    var self = this;

    if (self.isLoggedIn || self.sessionId || self.accessToken) {
        self.getNamespace(function(err, res) {
            onSuccess();
        }, onError);
    } else {
        self.jsForceConnection.login(self.username, self.password, function(err, res) {
            if (err) {
                self.isLoggedIn = false;

                if (!retryCount || retryCount < 5) {
                    VlocityUtils.error('Login Failed', 'Retrying', self.loginFailedMessage(err));
                    return self.checkLogin(onSuccess, onError, retryCount ? ++retryCount : 1);
                } else {
                    if (onError) {
                        return onError(self.loginFailedMessage(err));
                    } else {
                        throw self.loginFailedMessage(err);
                    }
                }
            }

            self.isLoggedIn = true;

            self.getNamespace(function(err, res) {
                onSuccess();
            }, onError);
        });
    }
};

Vlocity.prototype.getNamespace = function(onSuccess, onError) {
    var self = this;

    if (self.namespace) {
        onSuccess();
    } else {
        self.jsForceConnection.query("Select Name, NamespacePrefix from ApexClass where Name = 'DRDataPackService'", function(err, result) {
            if (err && !self.passedInNamespace) {

                if (err.code == 'ECONNRESET') {
                    return self.getNamespace(function(err, res) {
                        onSuccess();
                    }, onError);
                } else if (onError) {
                    return onError('Namespace Query ' + err);
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
                return onError('No namespace found - Either set the vlocity.namespace property on the CLI or ensure you have the DRDataPackService class deployed');
            } 
            
            VlocityUtils.namespace = self.namespace;

            self.namespacePrefix = self.namespace ? self.namespace + '__' : '';

            self.datapacksutils.dataPacksExpandedDefinition = self.datapacksutils.updateExpandedDefinitionNamespace(self.datapacksutils.dataPacksExpandedDefinition);

            self.getPackageVersion(onSuccess, onError);
        });
    }
};

Vlocity.prototype.getPackageVersion = function(onSuccess, onError) {
    var self = this;

    if (self.packageVersion) {
        onSuccess();
    } else {
        self.jsForceConnection.query("SELECT DurableId, Id, IsSalesforce, MajorVersion, MinorVersion, Name, NamespacePrefix FROM Publisher where NamespacePrefix = \'" + self.namespace + "\'", function(err, result) {

            self.buildToolsVersionSettings = yaml.safeLoad(fs.readFileSync(path.join(__dirname, "buildToolsVersionSettings.yaml"), 'utf8'));

            self.BuildToolSettingLatestVersion = self.buildToolsVersionSettings.latest;

            if (!result || !result.records || result.records.length == 0 || err) {
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

            onSuccess();
        });
    }
};
