var jsforce = require('jsforce');
var yaml = require('js-yaml');
var fs = require('fs-extra');
var path = require('path');
var stringify = require('fast-json-stable-stringify');
var childProcess = require('child_process');
var sfdx = require('salesforce-alm');
const simpleGit = require('simple-git');

const VLOCITY_NAMESPACE = '%vlocity_namespace%';

var UtilityService = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};
};

UtilityService.prototype.replaceAll = function(str, find, replace) {
    return str.replace(new RegExp(find, 'g'), replace);
};

UtilityService.prototype.setNamespaceToOrg = function(value) {
    return JSON.parse(JSON.stringify(value).replace(new RegExp(VLOCITY_NAMESPACE, 'g'), this.vlocity.namespace));
};

UtilityService.prototype.setNamespaceToDefault = function(value) {

    if (!value) return value;

    return JSON.parse(JSON.stringify(value).replace(new RegExp(this.vlocity.namespace, 'g'), VLOCITY_NAMESPACE));
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
    
    if (metadata && !this.vlocity.utilityservice.isEmptyObject(metadata)) {
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
        var queryResult = await this.vlocity.queryservice.query('SELECT Id,DeveloperName,NamespacePrefix FROM %vlocity_namespace%__VlocityDataPackConfiguration__mdt');

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
        if (this.vlocity.namespace) {
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

UtilityService.prototype.runInputMap = async function(inputList, status, allLimitPromiseThreads) {
    try {
        while (inputList.length > 0 && !status.cancel) {
            var inputMap = inputList.shift();
            await inputMap.context[inputMap.func](inputMap.argument);
        }
    } catch (e) {
        status.cancel = true;
        status.errors.push(e);
    }
}

UtilityService.prototype.parallelLimit = async function(inputList, limit = 50) {

    var allLimitPromiseThreads = [];
    var status = { cancel: false, errors: [] };

    for (var i = 0; i < limit; i++) {
        allLimitPromiseThreads.push(this.runInputMap(inputList, status, allLimitPromiseThreads));
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

        this.organizationId = result.organizationId;
    } catch (err) {
        if (!retryCount || retryCount < 5) {
            VlocityUtils.error('Login Failed', 'Retrying', this.loginFailedMessage(err));
            await this.login(retryCount ? ++retryCount : 1);
        } else {
            throw this.loginFailedMessage(err);
        }
    }
}

UtilityService.prototype.sfdxLogin = async function() {
    VlocityUtils.report('Using SFDX', this.vlocity.sfdxUsername);

    try {
        var stored = JSON.parse(fs.readFileSync(path.join(this.vlocity.tempFolder, 'sfdx', this.vlocity.sfdxUsername + '.json')));

        this.vlocity.jsForceConnection = new jsforce.Connection(stored);

        var identity = await this.vlocity.jsForceConnection.identity();
        
        if (identity.username == stored.username) {
            VlocityUtils.report('Using SFDX Session');

            this.vlocity.organizationId = identity.organization_id;
            return stored;
        }

    } catch (e) {
        VlocityUtils.verbose('Session Not Found');
    }

    VlocityUtils.report('Refreshing SFDX Session', this.vlocity.sfdxUsername);

    let orgInfo = await this.sfdx('org:display', { targetusername: this.vlocity.sfdxUsername });

    if (orgInfo) {
        this.vlocity.organizationId = orgInfo.id;

        this.vlocity.jsForceConnection = new jsforce.Connection(orgInfo);

        try {
            fs.outputFileSync(path.join(this.vlocity.tempFolder, 'sfdx', this.vlocity.sfdxUsername + '.json'), JSON.stringify(orgInfo,null, 4));
        } catch (e) {
            VlocityUtils.error('Error Saving SFDX Credentials', e);
        }
       
        return orgInfo;
    } else {
        throw this.loginFailedMessage('Salesforce DX Org Info Not Found');
    }   
}

UtilityService.prototype.checkLogin = async function() {
    
    VlocityUtils.verbose('Check Login');

    if (this.vlocity.sessionId || this.vlocity.accessToken) {
        await this.getNamespace();
        await this.checkRequiredVersion();
    } else if (this.vlocity.sfdxUsername) {
        await this.sfdxLogin();
        await this.getNamespace();
        await this.checkRequiredVersion();
    } else if (this.vlocity.username && this.vlocity.password) {
        await this.login();
        await this.getNamespace();
        await this.checkRequiredVersion();
    } else {
        if (this.vlocity.passedInNamespace) {
            this.vlocity.namespace = this.vlocity.passedInNamespace;
        } else {
            this.vlocity.namespace = 'NoNamespace';
        }

        VlocityUtils.verbose('Update Definitions');

        this.vlocity.datapacksutils.dataPacksExpandedDefinition = this.vlocity.datapacksutils.updateExpandedDefinitionNamespace(this.vlocity.datapacksutils.dataPacksExpandedDefinition);
        
        this.vlocity.PackageVersion = 'No Login';
        this.vlocity.BuildToolSettingVersion = 'latest';
    }
};

UtilityService.prototype.getNamespace = async function() {
    
    VlocityUtils.verbose('Get Namespace');

    if (!this.vlocity.namespace) {
        var result;
        try {
            result = await this.vlocity.jsForceConnection.query("Select Name, NamespacePrefix from ApexClass where Name = 'DRDataPackService'");
        } catch (err) {
            if (this.vlocity.passedInNamespace) {
                return;
            } else if (err.code == 'ECONNRESET') {
                await this.getNamespace();
            } else {
                throw 'Namespace Query ' + err;
            }
        }
    
        if (result && result.records && result.records.length > 0) {
            this.vlocity.namespace = result.records[0].NamespacePrefix;
        }

        if (!this.vlocity.namespace && this.vlocity.passedInNamespace) {
            this.vlocity.namespace = this.vlocity.passedInNamespace;
        }

        if (this.vlocity.namespace == null) {
            throw `Vlocity Managed Package Not Found in Org: ${this.vlocity.username}`;
        } 
        
        VlocityUtils.namespace = this.vlocity.namespace;

        this.vlocity.namespacePrefix = this.vlocity.namespace ? this.vlocity.namespace + '__' : '';

        VlocityUtils.verbose('Update Definitions');

        this.vlocity.datapacksutils.dataPacksExpandedDefinition = this.vlocity.datapacksutils.updateExpandedDefinitionNamespace(this.vlocity.datapacksutils.dataPacksExpandedDefinition);

        await this.getPackageVersion();
        
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

UtilityService.prototype.describeSObject = async function(sObjectName) {
    var self = this;
    return await new Promise(function(resolve, reject) {
        self.vlocity.jsForceConnection.sobject(self.setNamespaceToOrg(sObjectName)).describe(function(err, result) {
            if (err) {
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

UtilityService.prototype.getGitDiffsFromOrgToLocal = async function(jobInfo) {
    try {
        var vbtDeployKey = `VBTDeployKey${jobInfo.gitCheckKey ? jobInfo.gitCheckKey : ''}`;
        var hashKey = await this.getVlocitySetting(vbtDeployKey);

        var changedDataPacks = [];

        if (hashKey) {
            VlocityUtils.success('Git Hash', hashKey);

            var gitChanges = childProcess.execSync(`cd ${jobInfo.projectPath} && git diff --stat ${hashKey} --raw --no-renames`, { encoding: 'utf8' });

            VlocityUtils.success('Git Differences', gitChanges);

            var allPotentialFiles = [];

            if (gitChanges) {
                for (var line of gitChanges.split('\n')) {
                    try {
                        if (line.length > 0 && line[0] == ':') {
    
                            var changedFile = line.substring(32);
                        
                            if (changedFile) {
                                changedFile = changedFile.trim();
                                allPotentialFiles.push(changedFile);
                            }
                        }
                    } catch (e) {
                        VlocityUtils.error('Error Getting Filename', e);
                    }
                }    
            }

            var gitNewFiles = childProcess.execSync(`cd ${jobInfo.projectPath} && git ls-files --others --exclude-standard`, { encoding: 'utf8' });

            VlocityUtils.verbose('New Files', gitNewFiles);

            if (gitNewFiles) {
                for (var newfile of gitNewFiles.split('\n')) {
                    allPotentialFiles.push(newfile);
                }
            }

            for (var potentialFile of allPotentialFiles) {
                var splitFile = potentialFile.split('/');

                if (splitFile.length > 2 && splitFile[splitFile.length - 1].includes('.')) {
                    var dataPackKey = splitFile[splitFile.length - 3] + '/' + splitFile[splitFile.length - 2];

                    if (fs.existsSync(path.join(jobInfo.projectPath, jobInfo.expansionPath, dataPackKey)) && !changedDataPacks.includes(dataPackKey)) {
                        changedDataPacks.push(dataPackKey);
                    }
                }
            }

            VlocityUtils.success('Git Check', `Found Changes for ${changedDataPacks.length} DataPacks`, changedDataPacks);
            
            return changedDataPacks;
        } else {
            VlocityUtils.error('Git Hash Not Found');
        } 
    } catch (e) {
        VlocityUtils.error('Error Getting Diffs', e);
    }

    return null;
}

UtilityService.prototype.setVlocitySetting = async function(settingName, value) {
    try {    
        let result = await this.vlocity.jsForceConnection.query(`Select Id, ${this.vlocity.namespace}__Value__c from ${this.vlocity.namespace}__GeneralSettings__c where Name = '${settingName}'`);

        var settingsRecord = {};
        settingsRecord.Name = settingName;
        settingsRecord[`${this.vlocity.namespace}__Value__c`] = value;

        if (result && result.records.length != 0) {
            settingsRecord.Id = result.records[0].Id;
        }

        if (settingsRecord.Id) {
            VlocityUtils.verbose('Set Setting Update', await this.vlocity.jsForceConnection.sobject(`${this.vlocity.namespace}__GeneralSettings__c`).update([ settingsRecord ], {}));
        } else {
            VlocityUtils.verbose('Set Setting Insert', await this.vlocity.jsForceConnection.sobject(`${this.vlocity.namespace}__GeneralSettings__c`).insert([ settingsRecord ], {}));
        }
    } catch (e) {
        VlocityUtils.error('Set Settings Error', e);
    }

    return null;
}

UtilityService.prototype.getVlocitySetting = async function(settingName) {
    try {    
        let result = await this.vlocity.jsForceConnection.query(`Select ${this.vlocity.namespace}__Value__c from ${this.vlocity.namespace}__GeneralSettings__c where Name = '${settingName}'`);

        if (result && result.records.length != 0) {
            return result.records[0][`${this.vlocity.namespace}__Value__c`];
        }
    } catch (e) {
        VlocityUtils.error('Get Settings Error', e);
    }

    return null;
}

UtilityService.prototype.sfdx = async function(command, options) {

    if (!this.sfdxCommands) {

        this.sfdxCommands = {};
        
        for (var sfdxCommand of sfdx.commands) {

            if (sfdxCommand.command) {
                this.sfdxCommands[`${sfdxCommand.topic}:${sfdxCommand.command}`] = sfdxCommand.run;
            }
        }
    }

    options.quiet = VlocityUtils.quiet;
    options.loglevel = 'trace';
    return await this.sfdxCommands[command]({ flags: options });
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

    if(!jobInfo.enableFullGitSupport) {
        jobInfo.hasError = true;
        jobInfo.errors.push('Please set enableFullGitSupport to true in job file settings');
        VlocityUtils.error('Please set enableFullGitSupport to true in job file settings');
        return;
    }

    if (!jobInfo.currentBranch) {
        jobInfo.hasError = true;
        jobInfo.errors.push('branch name not entered');
        VlocityUtils.error('branch name not entered');
        return;
    }

    if (!jobInfo.localRepoPath) {
        jobInfo.localRepoPath = jobInfo.projectPath;
    }

    await simpleGit(jobInfo.localRepoPath)
        .checkoutBranch(jobInfo.currentBranch, 'master');

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

        const gitP = require('simple-git/promise');

        if (!jobInfo.localRepoPath) {
            jobInfo.localRepoPath = jobInfo.projectPath;
        }

        if (!fs.existsSync(jobInfo.localRepoPath)) {
            fs.mkdirSync(jobInfo.localRepoPath);
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

    if(!jobInfo.enableFullGitSupport) {
        jobInfo.hasError = true;
        jobInfo.errors.push('Please set enableFullGitSupport to true in job file settings');
        VlocityUtils.error('Please set enableFullGitSupport to true in job file settings');
        return;
    }

    if(!jobInfo.commitMessage) {
        jobInfo.hasError = true;
        jobInfo.errors.push('Commit Message not entered');
        VlocityUtils.error('Commit Message not entered');
        return;
    }
    
    if (!jobInfo.localRepoPath) {
        jobInfo.localRepoPath = jobInfo.projectPath;
    }

    var fileOrFolderName = jobInfo.fileName ? jobInfo.fileName : "./*";

    await self.runGitInit(jobInfo);

    await simpleGit(jobInfo.localRepoPath)
        .add(fileOrFolderName)
        .commit(jobInfo.commitMessage);
}

UtilityService.prototype.runGitPush = async function (jobInfo) {

    if(!jobInfo.enableFullGitSupport) {
        jobInfo.hasError = true;
        jobInfo.errors.push('Please set enableFullGitSupport to true in job file settings');
        VlocityUtils.error('Please set enableFullGitSupport to true in job file settings');
        return;
    }

    if (!jobInfo.localRepoPath) {
        jobInfo.localRepoPath = jobInfo.projectPath;
    }

    if (!jobInfo.targetBranch) {
        await simpleGit(jobInfo.localRepoPath)
            .addConfig('push.default', 'current');
    }

    await simpleGit(jobInfo.localRepoPath)
        .push('origin', jobInfo.targetBranch, { '-f': null });
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

    await simpleGit().clone(jobInfo.gitRemoteUrl, jobInfo.localRepoPath);

    self.createOrUpdateGitIgnoreFile(jobInfo);
}

UtilityService.prototype.matchingKeysCheckUpdate = async function(jobInfo) {
    var queriesList = await this.buildQueriesMatchingKeys();
    var duplicatesMap = await this.queryDuplicates(queriesList, jobInfo);
    await this.updateDuplicateRecords(jobInfo, duplicatesMap);
};

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
        let metaList = await this.vlocity.jsForceConnection.metadata.list([{ type: 'CustomObject', folder: null }, ], VLOCITY_BUILD_SALEFORCE_API_VERSION);
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
    var excludeObjects = [ 'User', 'PricebookEntry', 'Account', 'Attachment', 'RecordType', '%vlocity_namespace%__DRMapItem__c', '%vlocity_namespace%__Element__c' ];

    var getAllValidSObjects = await this.getAllValidSObjects();

    for (var objectName of excludeObjects) {
        if (vlocityMatchingKeys.hasOwnProperty(objectName) || getAllValidSObjects.hasOwnProperty(objectName)) {
            delete vlocityMatchingKeys[objectName];
        }
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
