var jsforce = require('jsforce');
var yaml = require('js-yaml');
var fs = require('fs-extra');
var path = require('path');
var stringify = require('fast-json-stable-stringify');
var childProcess = require('child_process');
const simpleGit = require('simple-git');
const gitP = require('simple-git/promise');
const sfdx = require('./sfdx');
const commandExistsSync = require('command-exists').sync;

var unidecode = require('unidecode'); 

const VLOCITY_NAMESPACE = '%vlocity_namespace%';

var UtilityService = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};
};

UtilityService.prototype.replaceAll = function(str, find, replace) {
    return str.replace(new RegExp(find, 'g'), replace);
};

UtilityService.prototype.setNamespaceToOrg = function(value) {
    if(this.vlocity.namespace){
        if(JSON.stringify(value).includes(VLOCITY_NAMESPACE+'__')){
            return JSON.parse(JSON.stringify(value).replace(new RegExp(VLOCITY_NAMESPACE, 'g'), this.vlocity.namespace));
        } else{
            return JSON.parse(JSON.stringify(value));
        }
    } else{
        return JSON.parse(JSON.stringify(value).replace(new RegExp(VLOCITY_NAMESPACE+'__', 'g'), ''));
    }
};

UtilityService.prototype.setNamespaceToDefault = function(value) {

    if (!value) return value;

    if(this.vlocity.namespace) {
        return JSON.parse(JSON.stringify(value).replace(new RegExp(this.vlocity.namespace, 'g'), VLOCITY_NAMESPACE));
    }
    else {
        return JSON.parse(JSON.stringify(value));
    }
};

UtilityService.prototype.buildHashMap = function(fields, records) {
    var fieldsValuesMap = {};

    for (var i = 0; i < records.length; i++) {
        for (var key in fields) {
            if (records[i].hasOwnProperty(key)) {
                var uniqueKey = key + records[i][key];
                uniqueKey = uniqueKey.toLowerCase();
                
                if (!fieldsValuesMap[uniqueKey]) {
                    fieldsValuesMap[uniqueKey] = [];
                    fieldsValuesMap[uniqueKey].field = key;
                    fieldsValuesMap[uniqueKey].value = records[i][key];
                }
                
                fieldsValuesMap[uniqueKey].push(records[i]);
            }
        }
    }

    return fieldsValuesMap;
};

UtilityService.prototype.getDataPackData = function(dataPack) {
    if (dataPack) {
        for (var key in dataPack.VlocityDataPackData) {
            if (dataPack.VlocityDataPackData[key] 
                && dataPack.VlocityDataPackData[key] instanceof Array) {
                    return dataPack.VlocityDataPackData[key][0];
                }
        }
    }

    return {};
};

UtilityService.prototype.isEmptyObject = function(obj) {
    for (var name in obj) {
        return false;
    }
    return true;
};

UtilityService.prototype.mergeMaps = function(firstMap, secondMap) {
    for (var key in secondMap) {
        firstMap[key] = secondMap[key];
    }

    return firstMap;
};

UtilityService.prototype.createCustomMetadataRecord = async function(metadata) {
    
    if (metadata && metadata.length > 0) {
        metadata = this.setNamespaceToOrg(metadata);
        var results;
         
        try {

            results = await this.vlocity.jsForceConnection.metadata.create('CustomMetadata', metadata);

            if (results) {
                VlocityUtils.verbose('Create Custom Metadata Record', results);

                if (!Array.isArray(results)) {
                    results = [ results ];
                }
                
                for (var result of results) {
                    if (results && !result.success) {
                        VlocityUtils.error('Create Failed', result.errors);
                    }
                }
    
                return results;
            }
        } catch (e) {
            VlocityUtils.error('Create Failed', results, e.message);
        }
    }
};

UtilityService.prototype.getVlocityDataPackConfigurations = async function() {
    var resultMap = {};

    try {
        var queryResult = await this.vlocity.queryservice.query('SELECT Id, DeveloperName, NamespacePrefix, %vlocity_namespace%__DefaultExportLimit__c FROM %vlocity_namespace%__VlocityDataPackConfiguration__mdt');

        if (queryResult && queryResult.records) {
            var records = this.setNamespaceToDefault(queryResult.records);

            for (var i = 0; i < records.length; i++) {
                var fieldName = records[i]['DeveloperName'];

                if (resultMap[fieldName]) {
                    if (records[i]['NamespacePrefix'] !== null) {
                        continue;
                    }
                }

                resultMap[fieldName] = records[i];
            }
        }
    } catch (e) {
        VlocityUtils.error('Query Failed', e.message);
    }

    return resultMap;
};

UtilityService.prototype.getDRMatchingKeys = async function() {
    while (this.matchingKeyQueryInProgress) {
        await new Promise(resolve => setTimeout(resolve, 5000));
    }

    if (!this.matchingKeys) {
        if (this.vlocity.namespace && (!this.vlocity.isOmniStudioInstalled || this.vlocity.isOmniStudioIndustryInstalled)) {
            try {
                this.matchingKeyQueryInProgress = true;
                var queryResult = await this.vlocity.queryservice.query('SELECT Id,Label,NamespacePrefix,%vlocity_namespace%__ObjectAPIName__c,%vlocity_namespace%__MatchingKeyFields__c FROM %vlocity_namespace%__DRMatchingKey__mdt');
                this.matchingKeys = {};
                this.matchingKeyQueryInProgress = false;
                if (queryResult && queryResult.records) {
                    var records = this.setNamespaceToDefault(queryResult.records);

                    for (var i = 0; i < records.length; i++) {
                        var fieldName = records[i]['%vlocity_namespace%__ObjectAPIName__c'];

                        if (this.matchingKeys[fieldName]) {
                            if (records[i]['NamespacePrefix'] !== null) {
                                continue;
                            }
                        }

                        this.matchingKeys[fieldName] = records[i];
                    }
                }
            } catch (e) {
                this.matchingKeys = {};
                this.matchingKeyQueryInProgress = false;
            }
        } else {
            this.matchingKeys = {};
        }
    }

    return this.matchingKeys;
};

UtilityService.prototype.getDRMatchingKeyFields = async function() {
    if (!this.matchingKeyFields) {
        var result = await this.getDRMatchingKeys();
        this.matchingKeyFields = {};
        for (var objectName in result) {
            this.matchingKeyFields[objectName] = result[objectName]['%vlocity_namespace%__MatchingKeyFields__c'].split(',');
        }
    }

    return this.matchingKeyFields;
};

UtilityService.prototype.runInputMap = async function(inputList, status) {
    try {
        while (inputList.length > 0 && !status.cancel) {
            var inputMap = inputList.shift();
            await inputMap.context[inputMap.func](inputMap.argument);
        }
    } catch (e) {
        status.cancel = true;
        status.errors.push(e);

        if (e.errorCode == "REQUEST_LIMIT_EXCEEDED") {
            throw e;
        }
    }
}

UtilityService.prototype.parallelLimit = async function(inputList, limit = 50) {
    var allLimitPromiseThreads = [];
    var status = { cancel: false, errors: [] };

    for (var i = 0; i < limit; i++) {
        allLimitPromiseThreads.push(this.runInputMap(inputList, status));
    }

    do {
        try {
            await Promise.all(allLimitPromiseThreads);
        } catch (e) {
            status.errors.push(e);
        }
    } while (inputList.length > 0 && !status.cancel) 

    if (status.errors.length > 0) {
        throw status.errors;
    }
};

UtilityService.prototype.forceFinish = async function(inFlight, errors) {
    try {
        await Promise.all(inFlight);
    } catch (e) {
        errors.push(e);
        await this.forceFinish(inFlight, errors);
    }
}

UtilityService.prototype.createSObject = async function(sObjectType, sObject) {
    return await this.vlocity.jsForceConnection.sobject(sObjectType).create(sObject);
};

UtilityService.prototype.updateSObject = async function(sObjectType, sObject) {
    if (sObject && !this.isEmptyObject(sObject)) {
        sObject = this.vlocity.utilityservice.setNamespaceToOrg(sObject);
        sObjectType = this.vlocity.utilityservice.setNamespaceToOrg(sObjectType);

        try {
            var results = await this.vlocity.jsForceConnection.sobject(sObjectType).update(sObject);
                
            if (!(results instanceof Array)) {
                results = [results];
            }
        
            for (var res of results) {
                if (!res.success) {
                    VlocityUtils.error('Update Failed', res.errors);
                }
            }
        
            return this.vlocity.utilityservice.setNamespaceToDefault(results);

        } catch (e) {
            VlocityUtils.error('Update Failed', e.message); 
        }
    }
};

UtilityService.prototype.loginFailedMessage = function(error) {
    return 'Login Failed - Username: ' + (this.vlocity.username ? (this.vlocity.username + ' ') : 'None Provided') + ' Error ' + error;
}

UtilityService.prototype.login = async function(retryCount) {
    
    try {
        var result = await this.vlocity.jsForceConnection.login(this.vlocity.username, this.vlocity.password);

        this.vlocity.organizationId = result.organizationId;
    } catch (err) {
        if (!retryCount || retryCount < 5) {
            VlocityUtils.error('Login Failed', 'Retrying', this.loginFailedMessage(err));
            await this.login(retryCount ? ++retryCount : 1);
        } else {
            throw this.loginFailedMessage(err);
        }
    }
}

UtilityService.prototype.getRefreshToken = function(token) {
    if (token && token.indexOf('force://PlatformCLI::') == 0) {
        return token.substring('force://PlatformCLI::'.length, token.indexOf('@'));
    }
}

UtilityService.prototype.sfdxLogin = async function() {
    VlocityUtils.report('Using SFDX', this.vlocity.sfdxUsername);
    let credentialsFile;
    try {
        credentialsFile = path.join(this.vlocity.credentialsFolder, this.vlocity.datapacksexpand.generateFolderOrFilename(this.vlocity.sfdxUsername, 'json'));
        
        if (fs.existsSync(credentialsFile)) {
            var stored = JSON.parse(fs.readFileSync(credentialsFile));

            stored.refreshToken = this.getRefreshToken(stored.sfdxAuthUrl);
            this.vlocity.jsForceConnection = new jsforce.Connection(stored);
            this.vlocity.jsForceConnection.version = this.vlocity.salesforceApiVersion;

            var identity = await this.vlocity.jsForceConnection.identity();
            
            if (identity.username == stored.username) {
                VlocityUtils.report(`SFDX Authenticated - ${this.vlocity.sfdxUsername} - ${identity.username}`);

                this.vlocity.organizationId = identity.organization_id;
                return stored;
            }
        } else {
            VlocityUtils.verbose('No Session found');
        }
    } catch (e) {
        VlocityUtils.verbose('Session Not Found', e);

        if (e == "NOT_FOUND: The requested resource does not exist") {
            throw this.loginFailedMessage('Using Invalid API Version');
        }
    }

    VlocityUtils.report('Refreshing SFDX Session', this.vlocity.sfdxUsername);

    try {
        var orgInfo = await this.sfdx('org:display', { targetusername: this.vlocity.sfdxUsername, verbose: true });
        VlocityUtils.report("SFDX login successful for user ", orgInfo.username);

        this.vlocity.organizationId = orgInfo.id;
        this.vlocity.jsForceConnection = new jsforce.Connection(orgInfo);
        this.vlocity.jsForceConnection.version = this.vlocity.salesforceApiVersion;
        orgInfo.vbtSfdxUsername = this.vlocity.sfdxUsername;

        try {
            fs.outputFileSync(credentialsFile, JSON.stringify(orgInfo, null, 4));
        } catch (ex) {
            VlocityUtils.error('Error Saving SFDX Credentials', ex);
        }

        return orgInfo;

    } catch (e) {
        VlocityUtils.error('SFDX Login Error', e)
        throw this.loginFailedMessage('Salesforce DX Org Info Invalid - Please Login Again', e.message);
    }
}

UtilityService.prototype.checkLogin = async function() {
    
    VlocityUtils.verbose('Check Login');
    try {
        if (this.vlocity.sessionId || this.vlocity.accessToken) {
            await this.getNamespace();
            await this.checkOmniStudioPackage();
            await this.checkRequiredVersion();
            var identity = await this.vlocity.jsForceConnection.identity();
            if (identity) {
                this.vlocity.organizationId = identity.organization_id;
            }
        } else if (this.vlocity.sfdxUsername && this.vlocity.sfdxUsername != "VLOCITY_API_LOGIN") {
            await this.sfdxLogin();
            await this.getNamespace();
            await this.checkOmniStudioPackage();
            await this.checkRequiredVersion();
        } else if (this.vlocity.username && this.vlocity.password) {
            await this.login();
            await this.getNamespace();
            await this.checkOmniStudioPackage();
            await this.checkRequiredVersion();
        } else {
            if (this.vlocity.passedInNamespace) {
                this.vlocity.namespace = this.vlocity.passedInNamespace;
            } else {
                this.vlocity.namespace = '%vlocity_namespace%';
            }

            if (this.vlocity.sfdxUsername == "VLOCITY_API_LOGIN") {
                await this.sfdxLogin();
            } 

            this.vlocity.PackageVersion = 'No Login';
            this.vlocity.BuildToolSettingVersion = 'latest';
        }

        VlocityUtils.verbose('Update Definitions');
        this.vlocity.datapacksutils.dataPacksExpandedDefinition = this.vlocity.datapacksutils.updateExpandedDefinitionNamespace(this.vlocity.datapacksutils.dataPacksExpandedDefinition);

    } catch (err) {
        VlocityUtils.verbose('Login Error: ', err);
        return err;
    }
};

UtilityService.prototype.checkOmniStudioPackage = async function() {
    try {
        let result = await this.vlocity.jsForceConnection.query(`Select count() from OmniInteractionConfig where DeveloperName = 'TheFirstInstalledOmniPackage' OR  DeveloperName = 'InstalledIndustryPackage'`);
        if (result.totalSize != 0) {
            this.vlocity.isOmniStudioInstalled = true;
        }
        
        if (result.totalSize == 2) {
            this.vlocity.isOmniStudioIndustryInstalled = true;
        }
    } catch (e) {
        this.vlocity.isOmniStudioInstalled = false;
        this.vlocity.isOmniStudioIndustryInstalled = false;
    }

    if (!this.vlocity.isOmniStudioInstalled && !this.vlocity.isOmniStudioIndustryInstalled) {
        try {
            await this.vlocity.jsForceConnection.query(`Select Id from ${this.vlocity.namespacePrefix}OmniScript__c`);
            this.vlocity.isOmniStudioInstalled = false;
            this.vlocity.isOmniStudioIndustryInstalled = true;
        } catch (e) {
            this.vlocity.isOmniStudioInstalled = true;
            this.vlocity.isOmniStudioIndustryInstalled = false;
        }
    }
    return null;
}

UtilityService.prototype.getNamespace = async function() {
    
    VlocityUtils.verbose('Get Namespace');

    try {
       
        let verNamespace = await this.vlocity.jsForceConnection.query(`Select value from OmniInteractionConfig where DeveloperName =  'InstalledIndustryPackage'`);
        if (verNamespace.records.length > 0) {
            this.vlocity.namespace = verNamespace.records[0].Value;
            this.vlocity.namespacePrefix = this.vlocity.namespace + '__';
        } else {
            let osNamespace = await this.vlocity.jsForceConnection.query(`Select value from OmniInteractionConfig where DeveloperName = 'TheFirstInstalledOmniPackage'`);
            if (osNamespace.records.length > 0) {
                this.vlocity.namespace = osNamespace.records[0].Value;
                this.vlocity.namespacePrefix = this.vlocity.namespace + '__';
            }
        }

    } catch (e) {
        this.vlocity.namespace = '';
        this.vlocity.namespacePrefix = '';
    }

    if (!this.vlocity.namespace) {
        var result;
        try {
            result = await this.vlocity.jsForceConnection.describeGlobal();

            for (let res of result.sobjects) {
                let indexOfDR = '';
                if (res.name.indexOf('_VlocityDataPack__c') !== -1) {
                    indexOfDR = res.name.indexOf('_VlocityDataPack__c');
                }

                if (res.name.indexOf('_OmniScript__c') !== -1) {
                    indexOfDR = res.name.indexOf('_OmniScript__c');
                }

                if (res.name === 'VlocityDataPack__c' || res.name === 'OmniScript__c') {
                    this.vlocity.namespace = '';
                } else if (indexOfDR) {
                    this.vlocity.namespace = res.name.substring(0, indexOfDR + 1).replace('__', '');
                }
            }
        
        } catch (err) {
            if (this.vlocity.passedInNamespace) {
                VlocityUtils.verbose('Expected Namespace Failure', err, this.vlocity.passedInNamespace );
            } else if (err.code == 'ECONNRESET') {
                await this.getNamespace();
            } else {
                VlocityUtils.verbose('Namespace Query', err);
                return;
            }
        }
    
        if (!this.vlocity.namespace && this.vlocity.passedInNamespace) {
            this.vlocity.namespace = this.vlocity.passedInNamespace;
        }
        
        VlocityUtils.namespace = this.vlocity.namespace;

        this.vlocity.namespacePrefix = this.vlocity.namespace ? this.vlocity.namespace + '__' : '';

        try {
            await this.getPackageVersion();
            await this.getOrgNamespace();
            if (!this.vlocity.namespace) {
                if (this.vlocity.orgNamespace && this.vlocity.orgNamespace !== 'No_Namespace') {
                    this.vlocity.namespace = this.vlocity.orgNamespace;
                    this.vlocity.namespacePrefix = this.vlocity.orgNamespace + '__';
                } else {
                    this.vlocity.namespace = '';
                    this.vlocity.namespacePrefix = '';
                }
            }
        } catch (e) {
            VlocityUtils.verbose('Error with Tooling Queries - Likely a Community User', e);
        }
    }
};

UtilityService.prototype.checkRequiredVersion = async function() {
    let requiredVersion = await this.getVlocitySetting('VBTRequiredVersion');

    if (requiredVersion && requiredVersion != VLOCITY_BUILD_VERSION) {
        throw `Must Use Vlocity Build Tool version: ${requiredVersion} - Use npm install -g vlocity@${requiredVersion}`;
    }
}

UtilityService.prototype.getPackageVersion = async function() {
    
    VlocityUtils.verbose('Get Package Version');

    if (!this.vlocity.PackageVersion) {
        var result = await this.vlocity.jsForceConnection.query("SELECT DurableId, Id, IsSalesforce, MajorVersion, MinorVersion, Name, NamespacePrefix FROM Publisher where NamespacePrefix = \'" + this.vlocity.namespace + "\' LIMIT 1");

        this.vlocity.buildToolsVersionSettings = yaml.safeLoad(fs.readFileSync(path.join(__dirname, "buildToolsVersionSettings.yaml"), 'utf8'));

        this.vlocity.BuildToolSettingLatestVersion = this.vlocity.buildToolsVersionSettings.latest;

        if (!result || !result.records || result.records.length == 0) {
            this.vlocity.PackageVersion = "DeveloperOrg";
            this.vlocity.BuildToolSettingVersion = "latest";
        } else {
            this.vlocity.PackageVersion = result.records[0].MajorVersion + "." + result.records[0].MinorVersion;
            this.vlocity.PackageMajorVersion = result.records[0].MajorVersion;
            this.vlocity.PackageMinorVersion = result.records[0].MinorVersion;

            if (this.vlocity.buildToolsVersionSettings[this.vlocity.namespace]) {
                for (var i = 0; i < this.vlocity.buildToolsVersionSettings[this.vlocity.namespace].length; i++) {

                    var version = this.vlocity.buildToolsVersionSettings[this.vlocity.namespace][i];

                    if (this.vlocity.PackageMajorVersion > version.PackageMajorVersion) {
                        this.vlocity.BuildToolSettingVersion = version.version;
                        break;
                    } else if (this.vlocity.PackageMajorVersion == version.PackageMajorVersion) {
                        if (this.vlocity.PackageMinorVersion >= version.PackageMinorVersion) {
                            this.vlocity.BuildToolSettingVersion = version.version;
                            break;
                        }
                    }
                }

                if (!this.vlocity.BuildToolSettingVersion) {
                    this.vlocity.BuildToolSettingVersion = "latest";
                }
            }
        }
    }
};

UtilityService.prototype.getOrgNamespace = async function() {
    
    VlocityUtils.verbose('Get Org Namespace');

    if (!this.vlocity.orgNamespace) {
        try {
            var result = await this.vlocity.jsForceConnection.query("SELECT NamespacePrefix FROM Organization LIMIT 1");

            if (result && result.records) {
                this.vlocity.orgNamespace = result.records[0].NamespacePrefix;
            }
        }
        catch (err) {
            VlocityUtils.error('NamespacePrefix Query', err);
        }
        finally {
            if (!this.vlocity.orgNamespace) {
                this.vlocity.orgNamespace = 'No_Namespace';
            }
        }
    }
};

UtilityService.prototype.describeSObject = async function(sObjectName) {
    var self = this;
    return await new Promise(function(resolve, reject) {
        self.vlocity.jsForceConnection.sobject(self.setNamespaceToOrg(sObjectName)).describe(function(err, result) {
            if (err && !self.vlocity.isOmniStudioInstalled) {
                VlocityUtils.verbose('Describe Not found', sObjectName, err.message);
            }

            resolve(self.setNamespaceToDefault(result));
        });
    });
};

UtilityService.prototype.getFieldsDefinitionsMap = function(sObjectDescribe) {
    var fieldsDefinitionMap = {};
    
    for (var field of sObjectDescribe.fields) {
        fieldsDefinitionMap[field.name] = field; 
    }

    return fieldsDefinitionMap;
};

UtilityService.prototype.getGitChangesFromCommand = async function(gitChanges, allPotentialFiles, deletedParentFiles, addedParentFiles) {
    for (var line of gitChanges.split('\n')) {
        try {
            if (line.length > 0 && line[0] == ':') {

                var statusIndex = 10000;

                [ 'A', 'M', 'D' ].forEach(validStatus => {
                    if (line.indexOf(validStatus) != -1 && line.indexOf(validStatus) < statusIndex) {
                        statusIndex = line.indexOf(validStatus);
                    }
                });

                var status = line[statusIndex];
                var changedFile = line.substring(statusIndex+1);
            
                if (changedFile) {
                    changedFile = changedFile.trim();

                    if (status == 'D' && changedFile.indexOf('_DataPack.json') != -1) {
                        deletedParentFiles.push(changedFile)
                    } else if (status == 'A' && changedFile.indexOf('_DataPack.json') != -1) {
                        addedParentFiles.push(changedFile)
                    } else {
                        allPotentialFiles.push(changedFile);
                    }
                }
            }
        } catch (e) {
            VlocityUtils.error('Error Getting Filename', e);
        }
    }        
}

UtilityService.prototype.getGitDiffsFromOrgToLocal = async function(jobInfo) {
    try {
        var vbtDeployKey = `VBTDeployKey${jobInfo.gitCheckKey ? jobInfo.gitCheckKey : ''}`;
        let hashKey;
        if (jobInfo.overrideOrgCommit){
             hashKey = jobInfo.overrideOrgCommit;    
        } else {
             hashKey = await this.getVlocitySetting(vbtDeployKey);
        }

        var changedDataPacks = [];

        if (hashKey) {
            if (jobInfo.overrideOrgCommit){
                VlocityUtils.verbose('Override Git Hash', hashKey);
            }
            else{
               VlocityUtils.verbose('Git Hash', hashKey);
           }

            if (jobInfo.expansionPath) {
                var gitChanges = childProcess.execSync(`cd ${jobInfo.projectPath} && git diff --stat ${hashKey} --raw --no-renames -- ${jobInfo.expansionPath}`, { encoding: 'utf8',  maxBuffer: 1024*1024*20  });
            } else {
                var gitChanges = childProcess.execSync(`cd ${jobInfo.projectPath}/../ && git diff --stat ${hashKey} --raw --no-renames -- ${jobInfo.projectPath}`, { encoding: 'utf8',  maxBuffer: 1024*1024*20  });
            }

            if (!jobInfo.isRetry) {
                VlocityUtils.verbose('Git Differences', gitChanges);
            }

            var allPotentialFiles = [];
            var deletedParentFiles = [];
            var addedParentFiles = [];

            if (gitChanges) {
                this.getGitChangesFromCommand(gitChanges, allPotentialFiles, deletedParentFiles, addedParentFiles);
            }

            var gitNewFiles = childProcess.execSync(`cd ${jobInfo.projectPath} && git ls-files --others --exclude-standard`, { encoding: 'utf8' });

            if (!jobInfo.isRetry) {
                VlocityUtils.verbose('New Files', gitNewFiles);
            }

            if (gitNewFiles) {
                for (var newfile of gitNewFiles.split('\n')) {
                    allPotentialFiles.push(newfile);
                }
            }

            var sfdxProjectFolder;
            try {
                if (jobInfo.includeSalesforceMetadata) {
                    sfdxProjectFolder = this.vlocity.datapacksutils.getSFDXProject(jobInfo).sfdxProject.packageDirectories[0].path;
                }
            } catch(e) {
                VlocityUtils.error('Error Including Salesforce Metadata', e);
            }
            
            for (var potentialFile of allPotentialFiles) {
                var dataPackKey = this.getDataPackKeyFromFilename(potentialFile, jobInfo, sfdxProjectFolder);
                if (dataPackKey && !changedDataPacks.includes(dataPackKey)) {
                    changedDataPacks.push(dataPackKey);
                }
            }

            for (var deletedFile of deletedParentFiles) {
                var dataPackKey = this.getDataPackKeyFromFilename(deletedFile, jobInfo, sfdxProjectFolder);
                if (dataPackKey && changedDataPacks.includes(dataPackKey)) {
                    VlocityUtils.log('Removing Deleted DataPack From Deploy', dataPackKey);
                    changedDataPacks.splice(changedDataPacks.indexOf(dataPackKey), 1);
                }
            }

            for (var addedParent of addedParentFiles) {
                var dataPackKey = this.getDataPackKeyFromFilename(addedParent, jobInfo, sfdxProjectFolder);
                if (dataPackKey && !changedDataPacks.includes(dataPackKey)) {
                    changedDataPacks.push(dataPackKey);
                }
            }

            if (!jobInfo.isRetry) {
                VlocityUtils.verbose('Git Check', `Found Changes for ${changedDataPacks.length} DataPacks`, changedDataPacks);
            }
            
            return changedDataPacks;
        } else {
            VlocityUtils.error('Git Hash Not Found');
        } 
    } catch (e) {
        VlocityUtils.error('Error Getting Diffs', e);
    }

    return null;
}

UtilityService.prototype.getDataPackKeyFromFilename = function(filename, jobInfo, sfdxProjectFolder) {
       
    var splitFile = filename.split('/');

    if (splitFile.length > 2 && splitFile[splitFile.length - 1].includes('.')) {
        var dataPackKey = splitFile[splitFile.length - 3] + '/' + splitFile[splitFile.length - 2];

        if (fs.existsSync(path.join(jobInfo.projectPath, jobInfo.expansionPath, dataPackKey))) {
            return dataPackKey;
        }
    }

    if (sfdxProjectFolder) {
        if (filename.indexOf('default/') != -1) {
            
            var potentialSfdxFile = filename.substring(filename.indexOf('default/') + 8);
            var potentialSfdxFileSplit = potentialSfdxFile.split('/');

            var dataPackKey;

            if (potentialSfdxFileSplit[0] == 'objects' && potentialSfdxFileSplit.length == 4) {
                dataPackKey = potentialSfdxFileSplit[0] + '/' + potentialSfdxFileSplit[1] + '/' + potentialSfdxFileSplit[2] + '/' + potentialSfdxFileSplit[3];
            } else {
                dataPackKey = potentialSfdxFileSplit[0] + '/' + potentialSfdxFileSplit[1];
            }

            if (fs.existsSync(path.join(jobInfo.projectPath, sfdxProjectFolder, 'main', 'default', dataPackKey))) {
                return dataPackKey;
            }
        }
    }

    return null;
}

UtilityService.prototype.setVlocitySetting = async function(settingName, value) {
    try {    
        let result = "";
        if (this.vlocity.isOmniStudioInstalled) {
            result = await this.vlocity.jsForceConnection.query(`Select Value, id from OmniInteractionConfig where DeveloperName = '${settingName}'`);
        } else {
            result = await this.vlocity.jsForceConnection.query(`Select id,${this.vlocity.namespacePrefix}Value__c from ${this.vlocity.namespacePrefix}GeneralSettings__c where Name = '${settingName}'`);
        }

        var settingsRecord = {};
        

        if (this.vlocity.isOmniStudioInstalled) {
            settingsRecord['Value'] = value;
            settingsRecord.DeveloperName = settingName;
            settingsRecord.MasterLabel = settingName;
        } else {
            settingsRecord[`${this.vlocity.namespacePrefix}Value__c`] = value;
            settingsRecord.Name = settingName;
        }

        if (result && result.records.length != 0) {
            settingsRecord.Id = result.records[0].Id;
        }

        if (settingsRecord.Id) {
            if (this.vlocity.isOmniStudioInstalled) {
                VlocityUtils.verbose('Set Setting Update', await this.vlocity.jsForceConnection.sobject('OmniInteractionConfig').update([ settingsRecord ], {}));
            } else {
                VlocityUtils.verbose('Set Setting Update', await this.vlocity.jsForceConnection.sobject(`${this.vlocity.namespacePrefix}GeneralSettings__c`).update([ settingsRecord ], {}));
            }
        } else {
            if (this.vlocity.isOmniStudioInstalled) {
                VlocityUtils.verbose('Set Setting Insert', await this.vlocity.jsForceConnection.sobject('OmniInteractionConfig').insert([ settingsRecord ], {}));
            } else {
                VlocityUtils.verbose('Set Setting Insert', await this.vlocity.jsForceConnection.sobject(`${this.vlocity.namespacePrefix}GeneralSettings__c`).insert([ settingsRecord ], {}));
            }
        }

    
    } catch (e) {
        VlocityUtils.error('Set Settings Error', e);
    }

    return null;
}

UtilityService.prototype.getVlocitySetting = async function(settingName) {
    try {    
        let result = "";
        if (this.vlocity.isOmniStudioInstalled) {
            result = await this.vlocity.jsForceConnection.query(`Select Value from OmniInteractionConfig where DeveloperName = '${settingName}'`);
        } else {
            result = await this.vlocity.jsForceConnection.query(`Select ${this.vlocity.namespacePrefix}Value__c from ${this.vlocity.namespacePrefix}GeneralSettings__c where Name = '${settingName}'`);
        }

        if (result && result.records.length != 0) {
            if (this.vlocity.isOmniStudioInstalled) {
                return result.records[0]['Value'];
            } else {
                return result.records[0][`${this.vlocity.namespacePrefix}Value__c`];
            }
        }
    } catch (e) {
        VlocityUtils.error('Get Settings Error', e);
    }

    return null;
}

UtilityService.prototype.getSfdxCommandRunner = function(jobInfo) {
    if((jobInfo.useSfdxCli === true && commandExistsSync('sfdx')) || (jobInfo.useSfCli === true && commandExistsSync('sf'))) {
        VlocityUtils.log(`Using ${useSfdxCli ? 'sfdc' : 'sf'} cli`);
        return sfdx.run;
    } else {
        VlocityUtils.log('Using salesforce-alm');
        return this.sfdx;
    }
}

UtilityService.prototype.sfdx = async function(command, options) {
    var org = {
        getUsername: function() {
            if(options.sessionId && options.instanceUrl){
                return options.sessionId;
            }
            return options.targetusername;
        }
    };

    var flags = options;
    let sfdxCommand;

    flags.quiet = VlocityUtils.quiet;
    flags.json = VlocityUtils.quiet || !VlocityUtils.showLoggingStatements;

    let allCacheKeys = Object.keys(require.cache);

    for (let key of allCacheKeys) {
        if (key.includes('salesforce-alm')) {
            delete require.cache[key];
        }
    }

    if(options.sessionId && options.instanceUrl){
        VlocityUtils.milestone('Setting Auth Information before running SFDX Command');
        var ConfigSetCommand = require("salesforce-alm/dist/commands/force/config/set");
        let sfdxCommandSet = new ConfigSetCommand.ConfigSetCommand();
        sfdxCommandSet.varargs = {instanceUrl: options.instanceUrl};
        sfdxCommandSet.flags = flags;
        await sfdxCommandSet.run();
    }

    try {
        if (command == 'org:display') {
            var OrgDisplayCommand = require("salesforce-alm/dist/commands/force/org/display");
            flags.quiet = true;
            sfdxCommand = new OrgDisplayCommand.OrgDisplayCommand();
        } else if (command == 'source:retrieve') {
            var SourceRetrieveCommand = require("salesforce-alm/dist/commands/force/source/retrieve");
            sfdxCommand = new SourceRetrieveCommand.SourceRetrieveCommand();
        } else if (command == 'source:deploy') {
            var SourceDeployCommand = require("salesforce-alm/dist/commands/force/source/deploy");
            sfdxCommand = new SourceDeployCommand.SourceDeployCommand();
            sfdxCommand.ux = await require("@salesforce/command").UX.create();
        } else if (command == 'source:delete') {
            var SourceDeleteCommand = require("salesforce-alm/dist/commands/force/source/delete");
            sfdxCommand = new SourceDeleteCommand.SourceDeleteCommand();
            sfdxCommand.ux = await require("@salesforce/command").UX.create();
        } else if (command == 'mdapi:listmetadata') {
            var MdapiListmetadataCommand = require("salesforce-alm/dist/commands/force/mdapi/listmetadata");
            sfdxCommand = new MdapiListmetadataCommand.MdapiListmetadataCommand();
        } else if (command == 'source:convert') {
            var SourceConvertCommand = require("salesforce-alm/dist/commands/force/source/convert");
            sfdxCommand = new SourceConvertCommand.SourceConvertCommand();
            sfdxCommand.ux = await require("@salesforce/command").UX.create();
        } else if (command == 'mdapi:deploy') {
            var MdapiDeployCommand = require("salesforce-alm/dist/commands/force/mdapi/deploy");
            sfdxCommand = new MdapiDeployCommand.MdapiDeployCommand();
            sfdxCommand.ux = await require("@salesforce/command").UX.create();
        }

        sfdxCommand.flags = flags;
        sfdxCommand.org = org;
        return await sfdxCommand.run();
    } catch (e) {
        VlocityUtils.error(JSON.stringify(e, null, 4));

        if (command == 'source:deploy' && e.data) {
            throw e.data;
        }

        throw e; 
    }
}

UtilityService.prototype.updateCustomObject = async function(metadata) {
    return await this.updateMetadata('CustomObject', metadata);
};

UtilityService.prototype.retrieveCustomObject = async function(sObjectAPIName) {
    return await this.retrieveMetadata('CustomObject', sObjectAPIName);
};

UtilityService.prototype.updateGlobalValueSet = async function(metadata) {
    return await this.updateMetadata('GlobalValueSet', metadata);
};

UtilityService.prototype.retrieveGlobalValueSet = async function(sObjectAPIName) {
    return await this.retrieveMetadata('GlobalValueSet', sObjectAPIName);
};

UtilityService.prototype.retrieveMetadata = async function(type, component) {
    if (type && component) {
        component = this.vlocity.utilityservice.setNamespaceToOrg(component);

        try {
            var result = await this.vlocity.jsForceConnection.metadata.read(type, component);
            return this.vlocity.utilityservice.setNamespaceToDefault(result);
        } catch (e) {
            VlocityUtils.error('Retrieve Failed', e.message);
        }
    }
};

UtilityService.prototype.updateMetadata = async function(type, metadata) { 
    if (metadata && !this.isEmptyObject(metadata)) {
        metadata = this.vlocity.utilityservice.setNamespaceToOrg(metadata);
      
        try {
            var result = await this.vlocity.jsForceConnection.metadata.update(type, metadata);
        
            if (!(result instanceof Array)) {
                result = [result];
            }
    
            for (var res of result) {
                if (!res.success) {
                    VlocityUtils.error('Error Update Metadata', res.errors);
                }
            }
            
            return this.vlocity.utilityservice.setNamespaceToDefault(result);
        } catch (err) {
            VlocityUtils.error('Error Update Metadata', err);
        }        
    }
}

UtilityService.prototype.createOrUpdateGitIgnoreFile = async function (jobInfo) {

    var gitIgnorePath = path.join(jobInfo.localRepoPath, '.gitignore');

    if (fs.existsSync(gitIgnorePath)) {
        return;
    }

    var ignoreFile = fs.openSync(gitIgnorePath, 'w');
    fs.writeSync(ignoreFile, "\nVlocityBuild*\nvlocity-temp/\n");
    fs.closeSync(ignoreFile);
}

UtilityService.prototype.runGitCheckoutBranch = async function (jobInfo) {

    if (!jobInfo.enableFullGitSupport) {
        jobInfo.hasError = true;
        jobInfo.errors.push('Please set enableFullGitSupport to true in job file settings');
        VlocityUtils.error('Please set enableFullGitSupport to true in job file settings');
        return;
    }

    if (!jobInfo.branchName) {
        jobInfo.hasError = true;
        jobInfo.errors.push('branch name not entered');
        VlocityUtils.error('branch name not entered');
        return;
    }

    if (!jobInfo.localRepoPath) {
        jobInfo.localRepoPath = jobInfo.projectPath;
    }

    try {
        if (jobInfo.createNewBranch) {
            if (jobInfo.branchStartPoint) {
                let result = await gitP(jobInfo.localRepoPath).checkoutBranch(jobInfo.branchName, jobInfo.branchStartPoint);
            }
            else {
                let result = await gitP(jobInfo.localRepoPath).checkoutBranch(jobInfo.branchName, 'master');
            }
        }
        else {
            let branchNameNew = jobInfo.branchName;
            
            if (branchNameNew.indexOf('remotes/origin/') == 0) {
                branchNameNew = branchNameNew.substring('remotes/origin/'.length);
            }

            let result = await gitP(jobInfo.localRepoPath).checkout([branchNameNew]);
        }
    }
    catch (err) {
        VlocityUtils.error('Git Checkout Error', err);
        jobInfo.hasError = true;
        jobInfo.errors.push(err);
    }

}

UtilityService.prototype.runGitCurrentBranch = async function (jobInfo) {

    if (!jobInfo.enableFullGitSupport) {
        jobInfo.hasError = true;
        jobInfo.errors.push('Please set enableFullGitSupport to true in job file settings');
        VlocityUtils.error('Please set enableFullGitSupport to true in job file settings');
        return;
    }

    if (!jobInfo.localRepoPath) {
        jobInfo.localRepoPath = jobInfo.projectPath;
    }

    try {
        let result = await gitP(jobInfo.localRepoPath).raw(['rev-parse', '--abbrev-ref', 'HEAD']);
        if (result) {
            jobInfo.data = result;
        }
    }
    catch (err) {
        jobInfo.hasError = true;
        jobInfo.errors.push(err);
    }

    return jobInfo.data;
}

UtilityService.prototype.initialiseRepo = async function (jobInfo, git) {
    var self = this;

    await git.init();
    
    if(jobInfo.gitRemoteUrl) {
        git.addRemote('origin', jobInfo.gitRemoteUrl);
    }

    self.createOrUpdateGitIgnoreFile(jobInfo);
}

UtilityService.prototype.runGitInit = async function (jobInfo) {

        var self = this;

        if (!jobInfo.enableFullGitSupport) {
            jobInfo.hasError = true;
            jobInfo.errors.push('Please set enableFullGitSupport to true in job file settings');
            VlocityUtils.error('Please set enableFullGitSupport to true in job file settings');
            return;
        }

        if (!jobInfo.localRepoPath) {
            jobInfo.localRepoPath = jobInfo.projectPath;
        }

        if (!fs.existsSync(jobInfo.localRepoPath)) {
            fs.ensureDirSync(jobInfo.localRepoPath);
        }

        var git = gitP(jobInfo.localRepoPath);

        var isRepo = await git.checkIsRepo()
        
        if(!isRepo) { 
            await self.initialiseRepo(jobInfo, git);
        }
            
        git.fetch();
}

UtilityService.prototype.runGitCommit = async function (jobInfo) {

    var self = this;
    if (jobInfo.sourceExpansionPath === '.vlocity') {
        jobInfo.expansionPath = '.vlocity';
    }
    var commitPath = path.join(jobInfo.projectPath, jobInfo.expansionPath);
    var results = [];

    if (!jobInfo.enableFullGitSupport) {
        jobInfo.hasError = true;
        jobInfo.errors.push('Please set enableFullGitSupport to true in job file settings');
        VlocityUtils.error('Please set enableFullGitSupport to true in job file settings');
        return;
    }

    if (!jobInfo.commitMessage) {
        jobInfo.hasError = true;
        jobInfo.errors.push('Commit Message not entered');
        VlocityUtils.error('Commit Message not entered');
        return;
    }

    if (!jobInfo.localRepoPath) {
        jobInfo.localRepoPath = jobInfo.projectPath;
    }

    await self.runGitInit(jobInfo);

    this.ignoreTerminalPrompt(jobInfo.appPath);
    jobInfo.data = jobInfo.manifest;
    
    if (Array.isArray(jobInfo.manifest)) {

        var sfdxProject = this.vlocity.datapacksutils.getSFDXProject(jobInfo);

        var sfdxFolder;

        if (sfdxProject) {
            sfdxFolder = sfdxProject.sfdxProject.packageDirectories[0].path;
        }
       
        for (var fileOrFolderName of jobInfo.manifest) {

            let replacedFileOrFolderName;

            if (jobInfo.vdxnamespace) {
                replacedFileOrFolderName = fileOrFolderName.replace(/%vlocity_namespace%/g, jobInfo.vdxnamespace);
            }

            if (sfdxFolder && fileOrFolderName.endsWith('.resource')) {

                let staticResourceName = fileOrFolderName.substring(0, fileOrFolderName.indexOf('.resource'));

                if (fs.existsSync(path.join(sfdxProject.sfdxPath, sfdxFolder, 'main', 'default', staticResourceName))) {
                    await simpleGit(jobInfo.localRepoPath).add(path.join(sfdxProject.sfdxPath, sfdxFolder, 'main', 'default', staticResourceName, '*'));
                } else if (fs.existsSync(path.join(sfdxProject.sfdxPath, sfdxFolder, 'main', 'default', staticResourceName + '.resource-meta.xml'))) {
                    await simpleGit(jobInfo.localRepoPath).add(path.join(sfdxProject.sfdxPath, sfdxFolder, 'main', 'default', staticResourceName + '.*'));
                }
            } else if (sfdxFolder && fs.existsSync(path.join(sfdxProject.sfdxPath, sfdxFolder, 'main', 'default', fileOrFolderName))) {
                    await simpleGit(jobInfo.localRepoPath).add(path.join(sfdxProject.sfdxPath, sfdxFolder, 'main', 'default', fileOrFolderName));
            } else if (sfdxFolder && replacedFileOrFolderName && fs.existsSync(path.join(sfdxProject.sfdxPath, sfdxFolder, 'main', 'default', replacedFileOrFolderName))) {
                    await simpleGit(jobInfo.localRepoPath).add(path.join(sfdxProject.sfdxPath, sfdxFolder, 'main', 'default', replacedFileOrFolderName));
            } else {
                var fileOrFolderPath = path.join(commitPath, fileOrFolderName);
                var sanitizedFileOrFolderName;
                var sanitizedFileOrFolderPath;
                
                if (jobInfo.expansionPath !== '.vlocity') {
                    sanitizedFileOrFolderName = unidecode(fileOrFolderName)
                    .replace("\\", "-")
                    .replace(/[^A-Za-z0-9/_\-]+/g, "-")
                    .replace(/[-]+/g, "-")
                    .replace(/[-_]+_/g, "_")
                    .replace(/[-]+\/[-]+/g, "/")
                    .replace(/^[-_\\/]+/, "")
                    .replace(/[-_\\/]+$/, "");

                    sanitizedFileOrFolderPath = path.join(commitPath, sanitizedFileOrFolderName);
                }

                try {
                    if (fs.existsSync(fileOrFolderPath)) {
                        if (fs.lstatSync(fileOrFolderPath).isDirectory()) {
                            VlocityUtils.log('Committing', path.join(fileOrFolderPath, '*'));
                            await simpleGit(jobInfo.localRepoPath).add(path.join(fileOrFolderPath, '*'));
                        } else {
                            VlocityUtils.verbose('Committing', fileOrFolderPath);
                            await simpleGit(jobInfo.localRepoPath).add(path.join(fileOrFolderPath, ''));
                        }
                        
                        results.push(jobInfo.manifest[fileOrFolderName]);
                    } else if (sanitizedFileOrFolderPath && fs.existsSync(sanitizedFileOrFolderPath)) {
                        if (fs.lstatSync(sanitizedFileOrFolderPath).isDirectory()) {
                            VlocityUtils.log('Committing', path.join(sanitizedFileOrFolderPath, '*'));
                            await simpleGit(jobInfo.localRepoPath).add(path.join(sanitizedFileOrFolderPath, '*'));
                        } else {
                            VlocityUtils.verbose('Committing', sanitizedFileOrFolderPath);
                            await simpleGit(jobInfo.localRepoPath).add(sanitizedFileOrFolderPath);
                        }
                        
                        results.push(jobInfo.manifest[fileOrFolderName]);
                    }
                } catch (err) {
                    VlocityUtils.error('Error during Commit', err);
                    jobInfo.hasError = true;
                }
            }
        }
    }

    try {
        let result = await gitP(jobInfo.localRepoPath).commit(jobInfo.commitMessage);
       
        if (!result.commit) {
            jobInfo.hasError = true;
            if (result.summary.changes == 0 && result.summary.insertions == 0 && result.summary.deletions == 0) {
                jobInfo.errors.push('Nothing to Commit. Please Refresh Target.');
            } else {
                jobInfo.errors.push('Not Committed');
            }
        } else {
            jobInfo.message = 'Committed';
        }
    } catch (err) {
        jobInfo.hasError = true;
        jobInfo.errors.push(err);
    }

}

UtilityService.prototype.runGitPush = async function (jobInfo) {

    if (!jobInfo.enableFullGitSupport) {
        jobInfo.hasError = true;
        jobInfo.errors.push('Please set enableFullGitSupport to true in job file settings');
        VlocityUtils.error('Please set enableFullGitSupport to true in job file settings');
        return;
    }

    if (!jobInfo.localRepoPath) {
        jobInfo.localRepoPath = jobInfo.projectPath;
    }

    if (!jobInfo.targetBranch) {
        await simpleGit(jobInfo.localRepoPath).addConfig('push.default', 'current');
    }

    this.ignoreTerminalPrompt(jobInfo.appPath);

    try {
        await gitP(jobInfo.localRepoPath).listRemote();
        let result = await gitP(jobInfo.localRepoPath).push('origin', jobInfo.targetBranch, { '-f': null });
    }
    catch (err) {
        jobInfo.hasError = true;
        jobInfo.errors.push(err);
    }
}

UtilityService.prototype.runGitClone = async function (jobInfo) {

    var self = this;
    if(!jobInfo.enableFullGitSupport) {
        jobInfo.hasError = true;
        jobInfo.errors.push('Please set enableFullGitSupport to true in job file settings');
        VlocityUtils.error('Please set enableFullGitSupport to true in job file settings');
        return;
    }

    if (!jobInfo.gitRemoteUrl) {
        jobInfo.hasError = true;
        jobInfo.errors.push('Remote URL not entered');
        VlocityUtils.error('Remote URL not entered');
        return;
    }

    if (!jobInfo.localRepoPath) {
        jobInfo.localRepoPath = jobInfo.projectPath;
    }

    this.ignoreTerminalPrompt(jobInfo.appPath);

    try {
        await gitP().clone(jobInfo.gitRemoteUrl, jobInfo.localRepoPath);
    }
    catch (err) {
        jobInfo.hasError = true;
        jobInfo.errors.push(err);
    }

    self.createOrUpdateGitIgnoreFile(jobInfo);

}

UtilityService.prototype.runGitPull = async function (jobInfo) {

    if (!jobInfo.enableFullGitSupport) {
        jobInfo.hasError = true;
        jobInfo.errors.push('Please set enableFullGitSupport to true in job file settings');
        VlocityUtils.error('Please set enableFullGitSupport to true in job file settings');
        return;
    }

    if (!jobInfo.branchName) {
        jobInfo.branchName = await this.runGitCurrentBranch(jobInfo);
    }

    this.ignoreTerminalPrompt(jobInfo.appPath);

    try {
        let mergeResult = await gitP(jobInfo.localRepoPath).pull('origin', jobInfo.branchName);
        VlocityUtils.verbose('Merge summary', mergeResult);
    }
    catch (err) {
        jobInfo.hasError = true;
        jobInfo.errors.push(err);
    }
}

UtilityService.prototype.runGitBranch = async function (jobInfo) {

    if (!jobInfo.enableFullGitSupport) {
        jobInfo.hasError = true;
        jobInfo.errors.push('Please set enableFullGitSupport to true in job file settings');
        VlocityUtils.error('Please set enableFullGitSupport to true in job file settings');
        return;
    }

    if (!jobInfo.localRepoPath) {
        jobInfo.localRepoPath = jobInfo.projectPath;
    }

    try {
        VlocityUtils.verbose('Fetch', await gitP(jobInfo.localRepoPath).fetch());
        let result = await gitP(jobInfo.localRepoPath).branch(['-a']);
        VlocityUtils.verbose('List Branches', result);
        jobInfo.data = result.all;
    }
    catch (err) {
        jobInfo.hasError = true;
        jobInfo.errors.push(err);
    }

    return jobInfo.data;
}

UtilityService.prototype.runGitCheckRepo = async function (jobInfo) {

    if (!jobInfo.enableFullGitSupport) {
        jobInfo.hasError = true;
        jobInfo.errors.push('Please set enableFullGitSupport to true in job file settings');
        VlocityUtils.error('Please set enableFullGitSupport to true in job file settings');
        return;
    }

    if (!jobInfo.localRepoPath) {
        jobInfo.localRepoPath = jobInfo.projectPath;
    }

    var git = gitP(jobInfo.localRepoPath);

    jobInfo.data = await git.checkIsRepo();
}

UtilityService.prototype.matchingKeysCheckUpdate = async function(jobInfo) {
    var queriesList = await this.buildQueriesMatchingKeys();
    var duplicatesMap = await this.queryDuplicates(queriesList, jobInfo);
    await this.updateDuplicateRecords(jobInfo, duplicatesMap);
};

UtilityService.prototype.runGitStatus = async function (jobInfo) {

    if (!jobInfo.enableFullGitSupport) {
        jobInfo.hasError = true;
        jobInfo.errors.push('Please set enableFullGitSupport to true in job file settings');
        VlocityUtils.error('Please set enableFullGitSupport to true in job file settings');
        return;
    }

    if (!jobInfo.localRepoPath) {
        jobInfo.localRepoPath = jobInfo.projectPath;
    }

    try {
        let result = await gitP(jobInfo.localRepoPath).raw(['status']);
        jobInfo.data = JSON.stringify(result);
    }
    catch (err) {
        jobInfo.hasError = true;
        jobInfo.errors.push(err);
    }
}

UtilityService.prototype.checkDuplicates = async function(inputMap) {
    var queryResult;
    var jobInfo = inputMap.jobInfo;
    var duplicatesMap = inputMap.duplicatesMap;

    try {
        queryResult = await this.vlocity.queryservice.query(inputMap.query);

        if (queryResult && queryResult.records.length > 0) {
            var uniqueKeys = {};
    
            for (var i = 0; i < queryResult.records.length; i++) {
                var lastModifiedDate = queryResult.records[i]['LastModifiedDate'];
                
                var skipFields = ['Id'];
                var deleteFields = ['LastModifiedDate', 'attributes'];
                var matchingKeyValue = '';
    
                for (var field in queryResult.records[i]) {
                    if (deleteFields.includes(field)) {
                        delete queryResult.records[i][field];
                        continue;
                    } else if (skipFields.includes(field)) {
                        continue;
                    }
    
                    if (queryResult.records[i][field] === null
                        && field === '%vlocity_namespace%__GlobalKey__c') {
                        if (!duplicatesMap[inputMap.sObjectType]) {
                            duplicatesMap[inputMap.sObjectType] = {};
                        }
    
                        var globalKey = this.vlocity.datapacksutils.guid();
                        queryResult.records[i][field] = globalKey;
                        duplicatesMap[inputMap.sObjectType][globalKey] = queryResult.records[i];
    
                        VlocityUtils.report('Adding GlobalKey', 'Record: ' + queryResult.records[i]['Id']);
                        jobInfo.report.push('Adding GlobalKey >> ' + 'Record: ' + queryResult.records[i]['Id']);
                    }
    
                    matchingKeyValue += `Field: ${field} Value: ${queryResult.records[i][field]} `;
                }
    
                if (uniqueKeys.hasOwnProperty(matchingKeyValue)) {
                    if (uniqueKeys[matchingKeyValue]['LastModifiedDate'] < lastModifiedDate) {
                        uniqueKeys[matchingKeyValue]['LastModifiedDate'] = lastModifiedDate;
                    }
    
                    if (!duplicatesMap[inputMap.sObjectType]) {
                        duplicatesMap[inputMap.sObjectType] = {};
                    }
                    
                    duplicatesMap[inputMap.sObjectType][matchingKeyValue] = uniqueKeys[matchingKeyValue];

                    var message = `SObjectType: ${inputMap.sObjectType} - Record Ids: ${uniqueKeys[matchingKeyValue]['Id']},${queryResult.records[i].Id} - Matching Info: ${matchingKeyValue}`;
                    VlocityUtils.report('Duplicate Found', message);
                    jobInfo.report.push(`Duplicate - ${message}`);
                } else {
                    uniqueKeys[matchingKeyValue] = queryResult.records[i];
                }
            }
        }
    } catch (e) {
        VlocityUtils.error('Query Failed', e.message);
    }
};

UtilityService.prototype.queryDuplicates = async function(queriesList, jobInfo) {
    var duplicatesMap = {};
    var queryPromises = [];

    for (var query of queriesList) {
        queryPromises.push({ context: this, argument: { sObjectType: query.sObjectType, query: query.fullQuery, duplicatesMap: duplicatesMap, jobInfo: jobInfo }, func: 'checkDuplicates' });
    }

    await this.parallelLimit(queryPromises);
    return duplicatesMap;
};

UtilityService.prototype.getAllValidSObjects = async function() {

    if (!this.getAllValidSObjectsValues) {
        let metaList = await this.vlocity.jsForceConnection.metadata.list([{ type: 'CustomObject', folder: null }, ], VLOCITY_BUILD_SALESFORCE_API_VERSION);
        this.getAllValidSObjectsValues = {};

        for (var meta of metaList) {
            this.getAllValidSObjectsValues[meta.fullName.replace(this.vlocity.namespace, '%vlocity_namespace%')] = meta;
        }
    }

    return this.getAllValidSObjectsValues;
}

UtilityService.prototype.buildQueriesMatchingKeys = async function() {
    var vlocityMatchingKeys = await this.getDRMatchingKeyFields();
    var queriesList = [];
    var excludeObjects = [ 'User', 'PricebookEntry', 'Account', 'Attachment', 'RecordType', '%vlocity_namespace%__DRMapItem__c', '%vlocity_namespace%__Element__c', 'ContentVersion' ];

    var getAllValidSObjects = await this.getAllValidSObjects();

    for (var objectName of excludeObjects) {
        if (vlocityMatchingKeys.hasOwnProperty(objectName) || getAllValidSObjects.hasOwnProperty(objectName)) {
            delete vlocityMatchingKeys[objectName];
        }
    }

    var forceTypesToMatchOnGlobalKey = ['%vlocity_namespace__ContextMapping__c', '%vlocity_namespace__ObjectFacet__c', '%vlocity_namespace__ObjectSection__c', '%vlocity_namespace__ObjectElement__c'];

    for (var forceType of forceTypesToMatchOnGlobalKey) {
        vlocityMatchingKeys[forceType] = ['%vlocity_namespace__GlobalKey__c'];
    }
   
    for (var sObjectType in vlocityMatchingKeys) {

        if (sObjectType.indexOf('__c') != -1 && !getAllValidSObjects.hasOwnProperty(sObjectType)) {
            continue;
        }

        var fields = vlocityMatchingKeys[sObjectType];
        var queryBase = 'Id,LastModifiedDate,';

        if (fields) {
            queryBase += fields;
            var queryString = this.vlocity.queryservice.buildSOQL(queryBase, sObjectType);      
            var queryObject = { sObjectType : sObjectType, fullQuery: queryString };
            
            queriesList.push(queryObject);
        }
    }

    return queriesList;
};

UtilityService.prototype.updateDuplicateRecords = async function(jobInfo, duplicatesMap) {
    if (!this.isEmptyObject(duplicatesMap)) {
        for (var sObjectType in duplicatesMap) {
            var updateSObjects = [];

            for (var uniqueKey in duplicatesMap[sObjectType]) {
                if (!duplicatesMap[sObjectType][uniqueKey].hasOwnProperty('%vlocity_namespace%__GlobalKey__c') 
                    || Object.keys(duplicatesMap[sObjectType][uniqueKey]).length !== 2) {
                    break;
                }

                var newValue = this.vlocity.datapacksutils.guid();

                duplicatesMap[sObjectType][uniqueKey]['%vlocity_namespace%__GlobalKey__c'] = newValue;
                updateSObjects.push(duplicatesMap[sObjectType][uniqueKey]);

                var message = 'Record: ' + duplicatesMap[sObjectType][uniqueKey]['Id'] + ' with GlobalKey__c updated with value: ' + newValue;
                VlocityUtils.success('GlobalKey Fixed', message);
                jobInfo.report.push('GlobalKey Fixed >> ' + message);
            }

            if (!this.isEmptyObject(updateSObjects)) {
                await this.updateSObjectsBulk(sObjectType, updateSObjects);
            }
        }
    }
};

UtilityService.prototype.updateBulk = async function(inputMap) {
    await this.updateSObject(inputMap.sObjectType, inputMap.sObject);
};

UtilityService.prototype.updateSObjectsBulk = async function(sObjectType, updateSObjects) {
    var queryPromises = [];

    for (var sObject of updateSObjects) {
        queryPromises.push({ context: this, argument: { sObjectType: sObjectType, sObject: sObject }, func: 'updateBulk' });
    }

    await this.parallelLimit(queryPromises, 5);
};

UtilityService.prototype.ignoreTerminalPrompt = function (dirname) {   
    process.env.GIT_TERMINAL_PROMPT = 0;
}

UtilityService.prototype.getVisualForcePageUrl = function (dataPackType, dataPackObj, dataPackId) {
    let designerPath = '';
    let urlType = 'DefaultVisualforcePage';

    if (dataPackType === 'OmniScript' && (dataPackObj['%vlocity_namespace%__IsLwcEnabled__c'] || dataPackObj.IsWebCompEnabled)) {
        urlType = 'LwcEnabledPage';
    }

    if (!dataPackId) {
        dataPackId = dataPackObj.Id;
    }

    let urlTemplate = this.vlocity.datapacksutils.getVisualForcePagetemplate(dataPackType, urlType);

    if (urlTemplate) {
        designerPath = urlTemplate.replace(/%vlocity_namespace%__/g, this.vlocity.namespacePrefix).replace('%Id%', dataPackId);
    } else {
        designerPath = '/' + dataPackId;
    }
    return designerPath;
}

UtilityService.prototype.fetchAllRecords =  async function(query, Offset = 0){
    try {
        var fetchedRecords = [];
        if (Offset !== 0) {
            query += ' OFFSET ' + Offset;
        }
        var result = await this.vlocity.jsForceConnection.tooling.query(query);
        fetchedRecords = fetchedRecords.concat(result.records);
        if (result.records.length === 2000) {
            fetchedRecords = fetchedRecords.concat(await this.fetchAllRecords(query, Offset + 2000));
        }
        return fetchedRecords;
    } catch (err) {
        VlocityUtils.error('Query Failed', err);
    }
}

UtilityService.prototype.moveFolders = async function (source, target) {
    await fs.copy(source, target);
    await fs.removeSync(source);
}

UtilityService.prototype.getPuppeteerOptions = async function (jobInfo) {
    let puppeteerOptions = { 
        headless: jobInfo.puppeteerHeadless,
        args: [
            '--no-sandbox',
            `--proxy-server=${jobInfo.httpProxy ? jobInfo.httpProxy : ''}`
        ]
    };
    if (jobInfo.puppeteerHttpProxy) {
        puppeteerOptions.args.push('--proxy-server=' + jobInfo.puppeteerHttpProxy);
    }

    let macChrome = path.join('/', 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome');
    let winChrome = path.join('/', 'Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
    let winChrome86 = path.join('/', 'Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe');
    let linux = path.join('/','opt','google','chrome','chrome');
    let linux2 = path.join('/','opt','google','chrome','google-chrome');
    let linux3 = path.join('/','usr','bin','chromium-browser');    

    if (jobInfo.puppeteerExecutablePath) {
        puppeteerOptions.executablePath = jobInfo.puppeteerExecutablePath;
    } else if (fs.existsSync(macChrome)) {
        puppeteerOptions.executablePath = macChrome;
    } else if (fs.existsSync(winChrome)) {
        puppeteerOptions.executablePath = winChrome;
    } else if (fs.existsSync(winChrome86)) {
        puppeteerOptions.executablePath = winChrome86;
    } else if (fs.existsSync(linux)) {
        puppeteerOptions.executablePath = linux;
    } else if (fs.existsSync(linux2)) {
        puppeteerOptions.executablePath = linux2;
    } else if (fs.existsSync(linux3)) {
        puppeteerOptions.executablePath = linux3;        
    } else {
        let chromiumDirLocal = path.join('.', 'node_modules', 'puppeteer', '.local-chromium');
        if (fs.existsSync(chromiumDirLocal)) {
            fs.readdirSync(chromiumDirLocal).forEach((file) => {
                let macApp = path.join(chromiumDirLocal, file, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
                let linuxApp =  path.join(chromiumDirLocal, file, 'chrome-linux', 'chrome');
                let winApp =  path.join(chromiumDirLocal, file, 'chrome-win', 'chrome.exe');

                if (fs.existsSync(macApp)) {
                    puppeteerOptions.executablePath = macApp;
                } else if (fs.existsSync(linuxApp)) {
                    puppeteerOptions.executablePath = linuxApp;
                } else if (fs.existsSync(winApp)) {
                    puppeteerOptions.executablePath = winApp;
                }
            });
        }
        if (!puppeteerOptions.executablePath) {
            let pathToPuppeteer = require("global-modules-path").getPath("puppeteer", "puppeteer");
            if (pathToPuppeteer) {
                let chromiumDirGlobal = path.join(pathToPuppeteer, '.local-chromium');
                if (fs.existsSync(chromiumDirGlobal)) {
                    fs.readdirSync(chromiumDirGlobal).forEach((file) => {
                        let macApp = path.join(chromiumDirGlobal, file, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
                        let linuxApp =  path.join(chromiumDirGlobal, file, 'chrome-linux', 'chrome');
                        let winApp =  path.join(chromiumDirGlobal, file, 'chrome-win', 'chrome.exe');

                        if (fs.existsSync(macApp)) {
                            puppeteerOptions.executablePath = macApp;
                        } else if (fs.existsSync(linuxApp)) {
                            puppeteerOptions.executablePath = linuxApp;
                        } else if (fs.existsSync(winApp)) {
                            puppeteerOptions.executablePath = winApp;
                        }
                    });
                }   
            }
        }
    }

    if (puppeteerOptions.executablePath) {
        jobInfo.puppeteerExecutablePath = puppeteerOptions.executablePath;
    }
    //console.log(puppeteerOptions);
    return puppeteerOptions;
}
