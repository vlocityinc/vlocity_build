var jsforce = require('jsforce');
var datapacks = require('./datapacks');
var datapacksjob = require('./datapacksjob');
var datapacksexpand = require('./datapacksexpand');
var datapacksbuilder = require('./datapacksbuilder');
var datapacksutils = require('./datapacksutils');
var datapacksexportbuildfile = require('./datapacksexportbuildfile');

var Vlocity = module.exports = function(options) {
    options = options || {};

    this.username = options.username;
    this.password = options.password;

    this.namespace = options.vlocityNamespace;
    this.namespacePrefix = this.namespace ? this.namespace + '__' : '';
    this.verbose = !!options.verbose;

    if (this.verbose) {
        console.log('Verbose mode enabled');
    }

    this.jsForceConnection = new jsforce.Connection({
        loginUrl: options.loginUrl ? options.loginUrl : 'https://login.salesforce.com'
    });

    this.isLoggedIn = false;

    this.datapacksutils = new datapacksutils(this);
    this.datapacks = new datapacks(this);
    this.datapacksjob = new datapacksjob(this);
    this.datapacksexpand = new datapacksexpand(this);
    this.datapacksbuilder = new datapacksbuilder(this);
    this.datapacksexportbuildfile = new datapacksexportbuildfile(this);
};

Vlocity.prototype.checkLogin = function(thenRun) {
    var self = this;
    
    if (!self.isLoggedIn) {
        self.jsForceConnection.login(self.username, self.password, function(err, res) {
            if (err) { 
                console.error(err); 
                return false; 
            }
            
            self.isLoggedIn = true;
            thenRun();
        });
    } else {
        thenRun();
    }
};