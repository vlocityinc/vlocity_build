var jsforce = require('jsforce');
var datapacks = require('./datapacks');
var datapacksjob = require('./datapacksjob');
var datapacksexpand = require('./datapacksexpand');
var datapacksbuilder = require('./datapacksbuilder');
var datapacksutils = require('./datapacksutils');
var datapacksexportbuildfile = require('./datapacksexportbuildfile');
var vlocityutils = require('./vlocityutils.js');

var nopt = require('nopt');

var Vlocity = module.exports = function(options) {
    options = options || {};

    this.username = options.username;
    this.password = options.password;

    this.verbose = !!options.verbose;
    this.sessionId = options.sessionId;
    this.instanceUrl = options.instanceUrl;
    this.accessToken = options.accessToken;

    this.tempFolder = './vlocity-temp';

    if (this.verbose) {
        VlocityUtils.log('Verbose mode enabled');
    }

    if (this.username) {
        VlocityUtils.log('Org:', this.username);
    }

    this.jsForceConnection = new jsforce.Connection({
        loginUrl: options.loginUrl ? options.loginUrl : 'https://login.salesforce.com',
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

Vlocity.prototype.loginFailedMessage = function(error) {
    return 'Login Failed ' + (this.username ? (this.username + ' ') : '') + error;
}

Vlocity.prototype.checkLogin = function(onSuccess, onError) {
    var self = this;

    if (self.isLoggedIn || self.sessionId || self.accessToken) {    
        self.getNamespace(function(err, res) {
            onSuccess();
        }, onError); 
    } else {
        self.jsForceConnection.login(self.username, self.password, function(err, res) {
            if (err) { 
                return onError(self.loginFailedMessage(err));
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
            if (err) {
                return onError(self.loginFailedMessage(err)); 
            }

            self.namespace = result.records[0].NamespacePrefix;
            VlocityUtils.namespace = self.namespace;
            
            self.namespacePrefix = self.namespace ? self.namespace + '__' : '';

            if (self.namespace) {
                self.datapacksutils.dataPacksExpandedDefinition = self.datapacksutils.updateExpandedDefinitionNamespace(self.datapacksutils.dataPacksExpandedDefinition);
            }
          
            onSuccess();
        });
    }
};