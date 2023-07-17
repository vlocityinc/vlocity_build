var vlocity = require('../vlocity');
var utilityservice = require('../utilityservice');
var puppeteer = require('puppeteer-core');
var fs = require('fs-extra');
var path = require('path');
var yaml = require('js-yaml');

var OmniScript = module.exports = function (vlocity) {
    this.vlocity = vlocity;
};

var OMNI_BULK_RECORDS_LIMIT_MIN = 1000;

// Returns an Object of label to value used in the field diff. 
OmniScript.prototype.createTitleObjects = function (input) {
    var dataPackData = input.dataPackData;
    var titleObjects = [];
    let defaultNS = '%vlocity_namespace%__';
    var osObjName = 'OmniScript__c';
    var eleObjName = 'Element__c';
    if (!dataPackData.VlocityDataPackData[`${defaultNS}OmniScript__c`]) {
        if (!dataPackData.VlocityDataPackData[osObjName]) {
            osObjName = 'OmniProcess';
            eleObjName = 'OmniProcessElement'
        }
        defaultNS = '';
    }

    if (dataPackData.VlocityDataPackData[defaultNS + osObjName][0][defaultNS + eleObjName]) {
        dataPackData.VlocityDataPackData[defaultNS + osObjName][0][defaultNS + eleObjName] = this.vlocity.datapacksexpand.sortList(dataPackData.VlocityDataPackData[defaultNS + osObjName][0][defaultNS + eleObjName], defaultNS + osObjName);
    }

    var elements = dataPackData.VlocityDataPackData[defaultNS + osObjName][0][defaultNS + eleObjName];

    var sourceKey = dataPackData.VlocityDataPackData[defaultNS + osObjName][0].VlocityRecordSourceKey;

    var omniscriptName = `${dataPackData.VlocityDataPackData[defaultNS + osObjName][0][this.osFieldMap(`${defaultNS}Type__c`, osObjName)]} ${dataPackData.VlocityDataPackData[defaultNS + osObjName][0][this.osFieldMap(`${defaultNS}SubType__c`, osObjName)]} ${dataPackData.VlocityDataPackData[defaultNS + osObjName][0][this.osFieldMap(`${defaultNS}Language__c`, osObjName)]}`;

    var relevantFields = ['Name', this.osFieldMap(`${defaultNS}Type__c`, osObjName), 'VlocityRecordSourceKey'];

    if (elements) {

        dataPackData.VlocityDataPackData[defaultNS + osObjName][0][defaultNS + eleObjName] = this.vlocity.datapacksexpand.sortList(elements, defaultNS + osObjName);

        elements = dataPackData.VlocityDataPackData[defaultNS + osObjName][0][defaultNS + eleObjName];

        var elementsInOrder = [];
        var elementsAsText = '';
        var indentations = {};
        var elementByKey = {};

        for (var element of elements) {
            var elementIndentation = 1;

            var elementInTree = {};

            for (var field of relevantFields) {
                elementInTree[field] = element[field];
            }

            elementByKey[element.VlocityRecordSourceKey] = elementInTree;

            try {
                if (element[this.eleFieldMap(`${defaultNS}ParentElementId__c`, eleObjName)] != null) {
                    var parent = elementByKey[element[this.eleFieldMap(`${defaultNS}ParentElementId__c`, eleObjName)].VlocityMatchingRecordSourceKey] || {};

                    if (!parent.childElements) {
                        parent.childElements = [];
                    }

                    elementIndentation = indentations[element[this.eleFieldMap(`${defaultNS}ParentElementId__c`, eleObjName)].VlocityMatchingRecordSourceKey] + 2;
                    parent.childElements.push(elementInTree)
                } else {
                    elementsInOrder.push(elementInTree);
                }

                indentations[element.VlocityRecordSourceKey] = elementIndentation;
                elementsAsText += `${' '.repeat(elementIndentation)}${element.Name} (${element[this.eleFieldMap(`${defaultNS}Type__c`, eleObjName)]})\n`;
            } catch (e) {
                VlocityUtils.error('Error Building OmniScript Sequence', e);
            }
        }

        titleObjects.push({ 
            field: 'Elements', 
            value: elementsAsText, 
            fieldType: 'DisplayOnly', 
            VlocityDataPackType: 'OmniScript', 
            revertHandler: true,
            VlocityRecordSourceKey: sourceKey,
            VlocitySObjectRecordLabel: `OmniScript / ${omniscriptName} / Elements`
        });
    }

    return titleObjects;
};

OmniScript.prototype.deactivateOmniScript = async function (omniscriptID, jobInfo) {
    const osAPIName = this.vlocity.namespace + '__OmniScript__c';
    const osAPIActiveFieldName = this.vlocity.namespace + '__IsActive__c';
    var toUpdate = {};
    toUpdate[osAPIActiveFieldName] = false;
    toUpdate.Id = omniscriptID;
    try {
        if (jobInfo && jobInfo.keepOSActiveWhenLWCDeploymentFails) {
            VlocityUtils.log('Skipping Deactivation of OmniScript - ' + omniscriptID + '  as keepOSActiveWhenLWCDeploymentFails = true. As per this param, Deployed OmniScript will remain active irrespective of LWC is deployed or not.');
        } else {
            var result = await this.vlocity.jsForceConnection.sobject(osAPIName).update(toUpdate);
            if (!result.success) {
                VlocityUtils.error('Deactivating OmniScript ', 'Id: ' + omniscriptID + ' Unable to deactivate OmniScript. OmniScript is still activated.');
            }
            else {
                VlocityUtils.log('Deactivating OmniScript ', omniscriptID, 'OmniScript was deactivated');
            }
        }
    } catch (error) {
        VlocityUtils.error('Deactivating OmniScript ', 'Id: ' + omniscriptID + ' Unable to deactivate OmniScript. OmniScript is still activated - ' + error);
    }
}

OmniScript.prototype.afterActivationSuccess = async function (inputMap) {
    var jobInfo = inputMap.jobInfo;
    var dataPack = inputMap.dataPack;
    var omniScriptKey = dataPack.VlocityDataPackKey;
    var defaultNS = '%vlocity_namespace%__';
    let omniScriptId = jobInfo.sourceKeyToRecordId[dataPack.VlocityDataPackData[this.osObjMap(defaultNS)][0].VlocityRecordSourceKey];

    if (dataPack.VlocityDataPackData[this.osObjMap(defaultNS)][0][this.osFieldMap('%vlocity_namespace%__IsLwcEnabled__c')]) {

        if (!jobInfo.ignoreLWCActivationOS && !jobInfo.checkLWCActivationOS) {
            var minVersions = yaml.safeLoad(fs.readFileSync(path.join(__dirname,'..', 'buildToolsMinVersionOS-LWC.yaml'), 'utf8'));
            var minVersion = minVersions[this.vlocity.namespace]
            var currentVersion = this.vlocity.PackageVersion;
            if (minVersion && currentVersion && !(currentVersion >= minVersion)) {
                jobInfo.ignoreLWCActivationOS = true;
                VlocityUtils.error('OmniScript LWC Activation', 'Unsupported Managed package Version, LWC Activation disabled');
            }
            jobInfo.checkLWCActivationOS = true;
        }

        if (jobInfo.isRetry && jobInfo.omniScriptLwcActivationSkip && jobInfo.omniScriptLwcActivationSkip[omniScriptKey]) { 
            var oldError = jobInfo.omniScriptLwcActivationSkip[omniScriptKey];
            jobInfo.hasError = true;
            jobInfo.currentStatus[omniScriptKey] = 'Error';
            jobInfo.currentErrors[omniScriptKey] = 'LWC Activation Error >> ' + omniScriptKey + ' - ' + oldError;
            jobInfo.errors.push('OmniScript LWC Activation Error >> ' + omniScriptKey + ' - ' +  oldError);
            VlocityUtils.error('OmniScript LWC Activation Error', omniScriptKey + ' - ' +  oldError);
            await this.deactivateOmniScript(omniScriptId);
            return;
        }

        if (!dataPack.VlocityDataPackData[this.osObjMap(defaultNS)][0][this.osFieldMap(defaultNS + 'IsReusable__c')] && jobInfo.resusableOSToCompile && jobInfo.resusableOSToCompile[omniScriptKey]) {
            VlocityUtils.report(omniScriptKey, 'This OmniScipt will be compiled at the end');
            return;
        }

        if (jobInfo.ignoreLWCActivationOS) {
            return;
        }

        await this.compileOmniScriptLwc(jobInfo, omniScriptId, omniScriptKey);

        if (dataPack.VlocityDataPackData[this.osObjMap(defaultNS)][0][this.osFieldMap('%vlocity_namespace%__IsReusable__c')]) {
            if (!jobInfo.resusableOSToCompile) {
                jobInfo.resusableOSToCompile = {};
            }
            let nsPrefix = this.vlocity.namespacePrefix;
            let omniScriptDataPack = dataPack.VlocityDataPackData[this.osObjMap(defaultNS)][0];
            let searchKey = `${omniScriptDataPack[this.osFieldMap('%vlocity_namespace%__Type__c')]}|${omniScriptDataPack[this.osFieldMap('%vlocity_namespace%__SubType__c')]}|${omniScriptDataPack[this.osFieldMap('%vlocity_namespace%__Language__c')]}`;
            let reusableOmnis = await this.vlocity.jsForceConnection.query(
                                    this.vlocity.omnistudio.updateQuery(`SELECT Id, 
                                                                                ${nsPrefix}OmniScriptId__c, 
                                                                                ${nsPrefix}OmniScriptId__r.${nsPrefix}Type__c, 
                                                                                ${nsPrefix}OmniScriptId__r.${nsPrefix}SubType__c, 
                                                                                ${nsPrefix}OmniScriptId__r.${nsPrefix}Language__c 
                                                                        FROM ${nsPrefix}Element__c 
                                                                        WHERE ${nsPrefix}SearchKey__c = '${searchKey}' AND ${nsPrefix}OmniScriptId__r.${nsPrefix}IsActive__c = true`
                                    )
                                );
            for (var i = 0; i < reusableOmnis.records.length; i++) {
                let obj = reusableOmnis.records[i];
                let parentOsKey = '';
                if (obj[`${nsPrefix}OmniScriptId__r`]) {
                    parentOsKey = `OmniScript/${ obj[`${nsPrefix}OmniScriptId__r`][`${nsPrefix}Type__c`]}_${obj[`${nsPrefix}OmniScriptId__r`][`${nsPrefix}SubType__c`]}_${ obj[`${nsPrefix}OmniScriptId__r`][`${nsPrefix}Language__c`]}`;
                } else {
                    parentOsKey = `OmniScript/${obj.OmniProcess.Type}_${obj.OmniProcess.SubType}_${obj.OmniProcess.Language}`;
                }
                VlocityUtils.log(`Parent OmniScript (${parentOsKey}) for Reusable OmniScript (${omniScriptKey}) will be compiled at the end`);
                jobInfo.resusableOSToCompile[parentOsKey] = obj;
            }
        }
    }
}


OmniScript.prototype.onDeployFinish = async function (jobInfo) {
    if (jobInfo.resusableOSToCompile) {
        let omniscriptIdToKeyMap = {};
        var osKeysArray = Object.keys(jobInfo.resusableOSToCompile);
        VlocityUtils.verbose('Parent OmniScripts to Compile', osKeysArray);
        
        for(let key of osKeysArray) {
            let nsPrefix = this.vlocity.namespacePrefix,
                omniScript = jobInfo.resusableOSToCompile[key],
                query = '';

            if(omniScript[`${nsPrefix}OmniScriptId__r`]) {
                let type = omniScript[`${nsPrefix}OmniScriptId__r`][`${nsPrefix}Type__c`];
                let subType = omniScript[`${nsPrefix}OmniScriptId__r`][`${nsPrefix}SubType__c`];
                let lang = omniScript[`${nsPrefix}OmniScriptId__r`][`${nsPrefix}Language__c`];
                query = this.vlocity.omnistudio.updateQuery(`SELECT Id FROM ${nsPrefix}OmniScript__c WHERE ${nsPrefix}Type__c = '${type}' AND ${nsPrefix}SubType__c = '${subType}' AND ${nsPrefix}Language__c = '${lang}' AND ${nsPrefix}IsActive__c = true`);
            } else {
                query = this.vlocity.omnistudio.updateQuery(`SELECT Id FROM ${nsPrefix}OmniScript__c WHERE ${nsPrefix}Type__c = '${omniScript.OmniProcess.Type}' AND ${nsPrefix}SubType__c = '${omniScript.OmniProcess.SubType}' AND ${nsPrefix}Language__c = '${omniScript.OmniProcess.Language}' AND ${nsPrefix}IsActive__c = true`);
            }

            let parentOmniScript = await this.vlocity.jsForceConnection.query(query);
            omniscriptIdToKeyMap[parentOmniScript.records[0].Id] = key;
        }

        jobInfo.resusableOSToCompile = Object.assign({},omniscriptIdToKeyMap);
        
        let idsArray = Object.keys(jobInfo.resusableOSToCompile);
        
        // To handle the Retry in the case of only manifest error as that prints unwanted json
        if (idsArray.length < 1) {
            return;
        }
        VlocityUtils.report('Starting Parent OmniScript LWC Activation', 'Number of OmniScript to Activate: ' + idsArray.length);
        for (let i = 0; i < idsArray.length; i++) {
            var omniScriptId = idsArray[i];
            var omniScriptKey = jobInfo.resusableOSToCompile[omniScriptId];

            if (omniScriptId) {
                await this.compileOmniScriptLwc(jobInfo, omniScriptId, omniScriptKey);
            }
        }
    }
    jobInfo.resusableOSToCompile = {};
}

OmniScript.prototype.compileOmniScriptLwc = async function (jobInfo, omniScriptId, omniScriptKey) {

    try {

        // Make sure we load the package version
        await this.vlocity.utilityservice.getPackageVersion();

        const compilerName = 'omniscript-lwc-compiler';
        const namespace = this.vlocity.namespace;
        const packageVersion = this.vlocity.PackageVersion;
        const instanceUrl = this.vlocity.jsForceConnection.instanceUrl;
        const accessToken = this.vlocity.jsForceConnection.accessToken;
        const isDeveloperOrg = packageVersion === 'DeveloperOrg';

        // Load the compiler
        var omniscriptCompiler;
        if (this.vlocity.omniscriptCompiler) {
            omniscriptCompiler = this.vlocity.omniscriptCompiler;
        } else if (!jobInfo.ignoreLWCActivationOSLocalCompiler){
            omniscriptCompiler = await VlocityUtils.loadCompiler(compilerName, jobInfo, packageVersion, namespace);
            this.vlocity.omniscriptCompiler = omniscriptCompiler;
        } 

        // If we were unable to load the compiler package, use the legacy method
        if (!omniscriptCompiler) {
            jobInfo.ignoreLWCActivationOSLocalCompiler = true;
            VlocityUtils.report('Deploying OmniScript using legacy method... Local compiler disabled');
            await this.compileOSLWC(jobInfo, omniScriptId, omniScriptKey);
            return;
        }

        const compiler = new omniscriptCompiler(namespace, accessToken, instanceUrl, {
            isInsidePackage: !isDeveloperOrg,
            loggingFn: m => VlocityUtils.report(m)
        });

        const omniScriptLogId = omniScriptKey + ' (' + omniScriptId + ')';
        VlocityUtils.report('Starting OmniScript LWC Compilation', omniScriptLogId);

        if (jobInfo.deployIndividualOmniscriptLwcs) {
            await compiler.deployWithId(omniScriptId);
        } else {
            let tempSfdxFolder = path.join(jobInfo.tempFolder, 'tempDeployLWC', 'salesforce_sfdx');
            await compiler.compileWithId(omniScriptId, tempSfdxFolder);

            jobInfo.deployGeneratedLwc = true;
        }
    }
    catch (e) {
        VlocityUtils.error(e);
    }
}

OmniScript.prototype.compileOSLWC = async function (jobInfo, omniScriptId, omniScriptKey) {
    try {

        let puppeteerOptions = await utilityservice.prototype.getPuppeteerOptions(jobInfo);

        VlocityUtils.verbose('Deployed OmniScript ID', omniScriptKey + ' (' + omniScriptId + ')');

        if (!puppeteerOptions.executablePath && !jobInfo.puppeteerInstalled) {
            VlocityUtils.error('Chromium not installed. LWC activation disabled. Run "npm install puppeteer -g" or set puppeteerExecutablePath in your Job File');
            jobInfo.ignoreLWCActivationOS = true;
            jobInfo.ignoreLWCActivationCards = true;
        } else {
            var package = this.vlocity.namespacePrefix;
        
            var siteUrl = this.vlocity.jsForceConnection.instanceUrl;
            var sessionToken = this.vlocity.jsForceConnection.accessToken;
            var loginURl = siteUrl + '/secur/frontdoor.jsp?sid=' + sessionToken;
            VlocityUtils.verbose('LWC Activation Login URL', loginURl);
            var browser;
            
            try {
                browser = await puppeteer.launch(puppeteerOptions);
            } catch (error) {
                VlocityUtils.error('Puppeteer initialization Failed, LWC Activation disabled - ' + error);
                jobInfo.ignoreLWCActivationOS = true;
                return;
            }
            
            const page = await browser.newPage();
            const loginTimeout = jobInfo.loginTimeoutForLoginLWC;

            await Promise.all([
                page.waitForNavigation({ timeout: loginTimeout, waitUntil: 'load' }),
                page.waitForNavigation({ timeout: loginTimeout, waitUntil: 'networkidle2'}),
                page.goto(loginURl, {timeout: loginTimeout})
            ]);
        
            var omniScriptDisignerpageLink = siteUrl + '/apex/' + package + 'OmniLwcCompile?id=' + omniScriptId + '&activate=true';
            var omniScriptLogId = omniScriptKey + ' (' + omniScriptId + ')';

            VlocityUtils.report('Starting OmniScript LWC Activation', omniScriptLogId);
            VlocityUtils.verbose('LWC Activation URL', omniScriptDisignerpageLink);
           
            await page.goto(omniScriptDisignerpageLink);
            await page.waitForTimeout(5000);

           
            let tries = 0;
            var errorMessage;
            var maxNumOfTries = Math.ceil((60/jobInfo.defaultLWCPullTimeInSeconds)*jobInfo.defaultMinToWaitForLWCOmniScript);
            while (tries < maxNumOfTries && !jobInfo.ignoreLWCActivationOS) {
                try {
                    let message;
                    try {
                        message = await page.waitForSelector('#compiler-message');
                    } catch (messageTimeout) {
                        VlocityUtils.verbose('Error', messageTimeout);
                        VlocityUtils.log(omniScriptKey, 'Loading Page taking too long - Retrying - Tries: ' + tries + ' of ' + maxNumOfTries);
                    }
                    
                    if (message) { 
                        let currentStatus = await message.evaluate(node => node.innerText);
                        VlocityUtils.report('Activating LWC for OmniScript', omniScriptLogId, currentStatus);
                        jobInfo.elapsedTime = VlocityUtils.getTime();
                        VlocityUtils.report('Elapsed Time', jobInfo.elapsedTime);
                        if (currentStatus === 'DONE') {
                            VlocityUtils.success('LWC Activated', omniScriptLogId);
                            break;
                        } else if (/^ERROR: No MODULE named markup/.test(currentStatus)) {
                            var missingLWCTrimedError = currentStatus.substring('ERROR: '.length, currentStatus.indexOf(' found :'));
                            errorMessage = ' Missing Custom LWC - ' + missingLWCTrimedError;
                            break;
                        } else if (/^ERROR/.test(currentStatus)) {
                            errorMessage = ' Error Activating LWC - ' + currentStatus;
                            break;
                        }
                    }
                } catch (e) {
                    VlocityUtils.error('Error Activating LWC', omniScriptLogId, e);
                    errorMessage = ' Error: ' + e;
                }
                tries++;
                await page.waitForTimeout(jobInfo.defaultLWCPullTimeInSeconds*1000);
            }

            if (tries == maxNumOfTries) {
                errorMessage = 'Activation took longer than ' + jobInfo.defaultMinToWaitForLWCOmniScript + ' minutes - Aborting';
            }

            if (errorMessage) {
                if (!jobInfo.omniScriptLwcActivationSkip) {
                    jobInfo.omniScriptLwcActivationSkip = {};
                }
                jobInfo.omniScriptLwcActivationSkip[omniScriptKey] = errorMessage;
                jobInfo.hasError = true;
                jobInfo.currentStatus[omniScriptKey] = 'Error';
                jobInfo.currentErrors[omniScriptKey] = 'LWC Activation Error >> ' + omniScriptKey + ' - ' + errorMessage;
                jobInfo.errors.push('LWC Activation Error >> ' + omniScriptKey + ' - ' + errorMessage);
                VlocityUtils.error('LWC Activation Error', omniScriptKey + ' - ' + errorMessage);
                await this.deactivateOmniScript(omniScriptId);
            }
            browser.close();
        }
    } catch (e) {
        VlocityUtils.error(e);
        
        if (!jobInfo.omniScriptLwcActivationSkip) {
            jobInfo.omniScriptLwcActivationSkip = {};
        }
        jobInfo.omniScriptLwcActivationSkip[omniScriptKey] = errorMessage;
        jobInfo.hasError = true;
        jobInfo.currentStatus[omniScriptKey] = 'Error';
        jobInfo.currentErrors[omniScriptKey] = 'LWC Activation Error >> ' + omniScriptKey + ' - ' + e;
        jobInfo.errors.push('LWC Activation Error >> ' + omniScriptKey + ' - ' + e);
        VlocityUtils.error('LWC Activation Error', omniScriptKey + ' - ' + e);
        await this.deactivateOmniScript(omniScriptId, jobInfo);

        try {
            browser.close();
        } catch (e2) {}
    }
}

OmniScript.prototype.onActivateError = async function (dataPackData) {
    var onActivateErrorResult = {},
        defaultNS = '%vlocity_namespace%__';
    if (!dataPackData.dataPacks[0].VlocityDataPackData[`${defaultNS}OmniScript__c`]) {
        defaultNS = '';
    }
    var omniScriptDataPack = dataPackData.dataPacks[0].VlocityDataPackData[this.osObjMap(defaultNS)][0];
    var currentOmniScriptId = dataPackData.dataPacks[0].VlocityDataPackRecords[0].VlocityRecordSalesforceId;

    if (currentOmniScriptId && omniScriptDataPack[this.osFieldMap(`${defaultNS}IsReusable__c`)]) {
        var searchKey = `${omniScriptDataPack[this.osFieldMap(`${defaultNS}Type__c`)]}|${omniScriptDataPack[this.osFieldMap(`${defaultNS}SubType__c`)]}|${omniScriptDataPack[this.osFieldMap(`${defaultNS}Language__c`)]}`;

        VlocityUtils.verbose('Handling Reusable OmniScript Activation Directly', searchKey)
        
        var resultOfActivate = await this.vlocity.datapacksutils.activateOmniScript(currentOmniScriptId);

        try {
            if (typeof resultOfActivate == "string") {
                resultOfActivate = JSON.parse(resultOfActivate);
            }
        } catch (e) {
            throw resultOfActivate;
        }

        if (resultOfActivate.errorCode != "INVOKE-200") {
            VlocityUtils.error('Error Activating OmniScript', resultOfActivate.error);

            onActivateErrorResult.ActivationStatus = 'Error';
            onActivateErrorResult.message = resultOfActivate.error;

            return onActivateErrorResult;
        }

        let reusableOmnis = await this.vlocity.jsForceConnection.query(this.vlocity.omnistudio.updateQuery(`SELECT Id, ${this.vlocity.namespacePrefix}OmniScriptId__c FROM ${this.vlocity.namespacePrefix}Element__c WHERE ${this.vlocity.namespacePrefix}SearchKey__c = '${searchKey}' AND ${this.vlocity.namespacePrefix}OmniScriptId__r.${this.vlocity.namespacePrefix}IsActive__c = true`));
        
        for (var i = 0; i < reusableOmnis.records.length; i++) {
            
            var activationResult = await this.vlocity.datapacksutils.activateOmniScript(reusableOmnis.records[i][this.osFieldMap(`${this.vlocity.namespacePrefix}OmniScriptId__c`)]);

            try {
                if (typeof activationResult == "string") {
                    activationResult = JSON.parse(activationResult);
                }
            } catch (e) {
                throw activationResult;
            }

            if (activationResult.errorCode == "INVOKE-200") {
                onActivateErrorResult.ActivationStatus = 'Success';
            } else {
                onActivateErrorResult.ActivationStatus = 'Error';
                onActivateErrorResult.message = activationResult.error;
                break;
            }
        }

        return onActivateErrorResult;
       
    }

    return null;
};

OmniScript.prototype.extractAllBulkRecords = function (input) {
    var OmniScriptRecords = [];
    var datapack = input.dataPackData;
    var self = this;

    if (datapack.recordsCount < OMNI_BULK_RECORDS_LIMIT_MIN) {
        return null;
    }

    Object.keys(datapack.VlocityDataPackData).forEach(function (key) {
        if (Array.isArray(datapack.VlocityDataPackData[key])) {
            for (var OmniScriptVersion of datapack.VlocityDataPackData[key]) {
                if (typeof OmniScriptVersion === 'object') {
                    Object.keys(OmniScriptVersion).forEach(function (omniKey) {
                        if (Array.isArray(OmniScriptVersion[omniKey])) {
                            for (var OmniScriptData of OmniScriptVersion[omniKey]) {
                                var tempData = {},
                                    defaultNS = '%vlocity_namespace%__';
                                if (!OmniScriptData[`${defaultNS}Type__c`]) {
                                    defaultNS = '';
                                }
                                Object.keys(OmniScriptData).forEach(function (omniData) {
                                    if (omniData === `${defaultNS}ParentElementId__c`) {
                                        tempData[self.eleFieldMap(`${defaultNS}ParentElementId__c`)] = OmniScriptData[`${defaultNS}ParentElementId__c`]['VlocityMatchingRecordSourceKey'];
                                        //Add entry to parent-child relation map
                                        self.vlocity.relationMap[OmniScriptData['VlocityRecordSourceKey']] = tempData[self.eleFieldMap(`${defaultNS}ParentElementId__c`)];
                                    } else if (omniData === self.eleFieldMap(`${defaultNS}ParentElementId__c`)) {
                                        tempData[self.eleFieldMap(`${defaultNS}ParentElementId__c`)] = OmniScriptData[self.eleFieldMap(`${defaultNS}ParentElementId__c`)]['VlocityMatchingRecordSourceKey'];
                                        //Add entry to parent-child relation map
                                        self.vlocity.relationMap[OmniScriptData['VlocityRecordSourceKey']] = tempData[self.eleFieldMap(`${defaultNS}ParentElementId__c`)];
                                    } else if ((omniData.endsWith('__c') || self.vlocity.omnistudio.elementNewFieldNames.includes(omniData) || omniData === 'Name' || omniData === 'VlocityRecordSourceKey') && (omniData !== `${defaultNS}ReusableOmniScript__c` && omniData !== self.eleFieldMap(`${defaultNS}ReusableOmniScript__c`))) {
                                        if (omniData === 'VlocityRecordSourceKey') {
                                            tempData[omniData] = OmniScriptData[omniData];
                                            if (self.vlocity.isOmniStudioInstalled) {
                                                tempData[omniData] = tempData[omniData].replace(new RegExp(`${defaultNS}Element__c`, 'g'), 'OmniProcessElement')
                                                                                        .replace(new RegExp(`${defaultNS}OmniScript__c`, 'g'), 'OmniProcess');
                                            }
                                        } else {
                                            if (omniData.endsWith('__c')) {
                                                tempData[self.eleFieldMap(omniData)] = OmniScriptData[omniData];
                                            } else if (self.vlocity.omnistudio.elementNewFieldNames.includes(omniData)) {
                                                tempData[omniData] = OmniScriptData[omniData];
                                            }
                                        }
                                    }

                                    if (self.eleFieldMap(omniData) === 'ParentElementId') {
                                        tempData['ParentElementId'] = tempData['ParentElementId'].replace(new RegExp(`${defaultNS}Element__c`, 'g'), 'OmniProcessElement')
                                                                                                    .replace(new RegExp(`${defaultNS}OmniScript__c`, 'g'), 'OmniProcess');
                                    }
                                });
                                OmniScriptRecords.push(tempData);
                            }
                            OmniScriptVersion[omniKey] = '';
                        }
                    });
                }
            }
        }
    });
    return OmniScriptRecords;
}

OmniScript.prototype.getUpdatedParentList = async function () {
    var self = this;
    var elementObjList = [];
    for (var key in self.vlocity.nameToSfIdMap) {
        if (key in self.vlocity.relationMap) {
            var elementObj = { Id: self.vlocity.nameToSfIdMap[key] };
            elementObj[self.vlocity.omnistudio.getNewFieldName('OmniScript', '%vlocity_namespace%__Element__c', self.vlocity.namespacePrefix + "ParentElementId__c")] = self.vlocity.nameToSfIdMap[self.vlocity.relationMap[key]];
            elementObjList.push(elementObj);
            delete self.vlocity.relationMap[key];
        }
    }
    return elementObjList;
}

OmniScript.incrementElements = function (elements, orderToIncrementAfter) {
    elements.forEach(element => {
        let defaultNS = element['%vlocity_namespace%__Order__c'] ? '%vlocity_namespace%__' : ''
        if (element[this.eleFieldMap(defaultNS + 'Order__c')] >= orderToIncrementAfter) {
            element[this.eleFieldMap(defaultNS + 'Order__c')] = element[this.eleFieldMap(defaultNS + 'Order__c')] + 1;
        }
    })
}

OmniScript.prototype.discardSObject = function (input) {
    var deletedObject = input.deletedObject;
    var parentObject = input.parentObject;
    var defaultNS = parentObject['%vlocity_namespace%__Element__c'] ? '%vlocity_namespace%__' : '';
    OmniScript.incrementElements(parentObject[this.eleObjMap(defaultNS)], deletedObject[this.eleFieldMap(defaultNS + 'Order__c')]);
    parentObject[this.eleObjMap(defaultNS)].push(deletedObject);

    return true;
}

OmniScript.staticHandleRevert = async function (input) {

    VlocityUtils.error('staticHandleRevert');

    var comparisonFileSource = input.comparisonFileSource;
    var comparisonFileTarget = input.comparisonFileTarget;
    var revertRecord = input.revertRecord;
    var dataPackKey = revertRecord.VlocityDataPackKey;

    var diffString = revertRecord.gitDiff;
    var diffStringSplit = diffString.split('\n');

    var readdElements = [];
    var removeElements = [];

    var sourceDataPack = comparisonFileSource.dataPacks.find(dataPack => {
        return dataPack.VlocityDataPackKey == dataPackKey;
    });

    var targetDataPack = comparisonFileTarget.dataPacks.find(dataPack => {
        return dataPack.VlocityDataPackKey == dataPackKey;
    });
    
    var defaultNS = sourceDataPack.VlocityDataPackData['%vlocity_namespace%__OmniScript__c'] ? '%vlocity_namespace%__' : '';

    var sourceElements = '',
        targetElements = '';

    
    sourceElements = sourceDataPack.VlocityDataPackData[this.osObjMap(defaultNS)][0][this.eleObjMap(defaultNS)];
    
    
    targetElements = targetDataPack.VlocityDataPackData[this.osObjMap(defaultNS)][0][this.eleObjMap(defaultNS)];

    for (var i = 2; i < diffStringSplit.length; i++) {

        var elementLine = diffStringSplit[i];

        if (elementLine) {
            var elementName = elementLine.substr(1, elementLine.indexOf('(') - 1).trim();

            if (elementLine[0] == '-') {
                readdElements.push(elementName);
            } else if (elementLine[0] == '+') {
                removeElements.push(elementName);
            }
        }
    }

    removeElements = removeElements.filter(elementName => {
        return readdElements.indexOf(elementName) == -1;
    });

    for (var i = 0; i < readdElements.length; i++) {
        
        var sourceElementIndex = sourceElements.findIndex(ele => {
            return ele.Name == readdElements[i];
        });

        var targetElementIndex = targetElements.findIndex(ele => {
            return ele.Name == readdElements[i];
        });

        //
        OmniScript.incrementElements(sourceElements, targetElements[targetElementIndex][this.eleFieldMap(defaultNS + 'Order__c')]);

        if (sourceElementIndex != -1) {

            //VlocityUtils.error('CHANGING' , readdElements[i], targetElements[targetElementIndex][defaultNS + 'Order__c'], sourceElements[sourceElementIndex][defaultNS + 'Order__c'])

            sourceElements[sourceElementIndex][this.eleFieldMap(`${defaultNS}Order__c`)] = targetElements[targetElementIndex][this.eleFieldMap(`${defaultNS}Order__c`)];
            sourceElements[sourceElementIndex][this.eleFieldMap(`${defaultNS}ParentElementId__c`)] = targetElements[targetElementIndex][this.eleFieldMap(`${defaultNS}ParentElementId__c`)];
            sourceElements[sourceElementIndex][this.eleFieldMap(`${defaultNS}ParentElementName__c`)] = targetElements[targetElementIndex][this.eleFieldMap(`${defaultNS}ParentElementName__c`)];
            sourceElements[sourceElementIndex][this.eleFieldMap(`${defaultNS}ParentElementType__c`)] = targetElements[targetElementIndex][this.eleFieldMap(`${defaultNS}ParentElementType__c`)];
        } else {
            sourceElements.push(targetElements[targetElementIndex]);
        }
    }

    for (var i = 0; i < removeElements.length; i++) {
        var sourceElementIndex = sourceElements.findIndex(ele => {
            return ele.Name == removeElements[i];
        });

        var targetElementIndex = targetElements.findIndex(ele => {
            return ele.Name == removeElements[i];
        });

        if (targetElementIndex > -1) {
            sourceElements[sourceElementIndex][this.eleFieldMap(`${defaultNS}Order__c`)] = targetElements[targetElementIndex][this.eleFieldMap(`${defaultNS}Order__c`)];
            sourceElements[sourceElementIndex][this.eleFieldMap(`${defaultNS}ParentElementId__c`)] = targetElements[targetElementIndex][this.eleFieldMap(`${defaultNS}ParentElementId__c`)];
            sourceElements[sourceElementIndex][this.eleFieldMap(`${defaultNS}ParentElementName__c`)] = targetElements[targetElementIndex][this.eleFieldMap(`${defaultNS}ParentElementName__c`)];
            sourceElements[sourceElementIndex][this.eleFieldMap(`${defaultNS}ParentElementType__c`)] = targetElements[targetElementIndex][this.eleFieldMap(`${defaultNS}ParentElementType__c`)];
        } else if (sourceElementIndex > -1) {
            sourceElements[sourceElementIndex].VlocityDataPackIsIncluded = false;
        }
    }

    if (removeElements.length > 0) {
        sourceDataPack.VlocityDataPackData[this.osObjMap(defaultNS)][0][this.eleObjMap(defaultNS)] = sourceDataPack.VlocityDataPackData[this.osObjMap(defaultNS)][0][this.eleObjMap(defaultNS)].filter(element => {
            return element.VlocityDataPackIsIncluded !== false;
        })
    }

    return true;
}

OmniScript.prototype.hashSObjectData = async function (input) {

    var sobject = input.sobject,
        defaultNS = sobject['%vlocity_namespace%__PropertySet__c'] ? '%vlocity_namespace%__' : '',
        propertySetFieldName = 'PropertySet__c';
    if (defaultNS === '' && sobject['PropertySetConfig']) {
        propertySetFieldName = 'PropertySetConfig';
    }

    if (sobject && sobject[defaultNS + propertySetFieldName]) {
        sobject[defaultNS + propertySetFieldName] = sobject[defaultNS + propertySetFieldName].replace(/id=01.+?&/g, 'id=<SalesforceId>').replace(/oid=00.+?\\/g, 'oid=<SalesforceId>\\').replace(/oid=00.+?"/g, 'oid=<SalesforceId>"').replace(/file=015.+?&/g, 'file=<SalesforceId>&');
    }
};

OmniScript.prototype.getBulkJobObjectName = function () {
    return this.eleObjMap(this.vlocity.namespacePrefix);
}

OmniScript.prototype.getBulkJobObjectKey = function () {
    return this.eleFieldMap(this.vlocity.namespacePrefix + "OmniScriptId__c");
}

OmniScript.prototype.osObjMap = function (ns) {
    return (this.vlocity.omnistudio.getNewObjectName('OmniScript', "%vlocity_namespace%__OmniScript__c")).replace('%vlocity_namespace%__', ns);
}

OmniScript.prototype.eleObjMap = function (ns) {
    return (this.vlocity.omnistudio.getNewObjectName('OmniScript', "%vlocity_namespace%__Element__c")).replace('%vlocity_namespace%__', ns);
}

OmniScript.prototype.osFieldMap = function (fieldName, objName) {
    return this.vlocity.omnistudio.getNewFieldName('OmniScript', '%vlocity_namespace%__OmniScript__c', fieldName, objName === 'OmniProcess');
}

OmniScript.prototype.eleFieldMap = function (fieldName, objName) {
    return this.vlocity.omnistudio.getNewFieldName('OmniScript', '%vlocity_namespace%__Element__c', fieldName, objName === 'OmniProcessElement');
}

OmniScript.prototype.getBulkJobObjectKey =  function () {
    return this.vlocity.namespacePrefix + "OmniScriptId__c";
}
