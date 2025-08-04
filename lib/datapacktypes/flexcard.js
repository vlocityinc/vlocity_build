const vlocity = require('../vlocity');
const utilityservice = require('../utilityservice');
const VlocityUILayout = require('./vlocityuilayout');
const puppeteer = require('puppeteer-core');
const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');

let FlexCard = module.exports = function(vlocity) {
    this.vlocity = vlocity;
};

 
FlexCard.prototype.flexCardDeployWithPuppeteer = async function(jobInfo){
    VlocityUtils.report("Legacy fall back flow for compiling Flexcards with Puppeteer ");

    let puppeteerOptions = await utilityservice.prototype.getPuppeteerOptions(jobInfo);
 
    if (!puppeteerOptions.executablePath && !jobInfo.puppeteerInstalled) {
        VlocityUtils.error('Chromium not installed. LWC activation disabled. Run "npm install puppeteer -g" or set puppeteerExecutablePath in your Job File');
        jobInfo.ignoreLWCActivationCards = true;
        jobInfo.ignoreLWCActivationOS = true;
    } else {
        let package = this.vlocity.namespacePrefix;
    
        let siteUrl = this.vlocity.jsForceConnection.instanceUrl;
        let sessionToken = this.vlocity.jsForceConnection.accessToken;
        let loginURl = siteUrl + '/secur/frontdoor.jsp?sid=' + sessionToken;
        let browser;
        try {
            browser = await puppeteer.launch(puppeteerOptions);
        } catch (error) {
            VlocityUtils.error('Puppeteer initialization Failed, LWC Activation disabled - ' + error);
            jobInfo.ignoreLWCActivationCards = true;
            return;
        }
        
        const page = await browser.newPage();
        const loginTimeout = 300000;

        await Promise.all([
            page.waitForNavigation({ timeout: loginTimeout, waitUntil: 'load' }),
            page.waitForNavigation({ timeout: loginTimeout, waitUntil: 'networkidle2'}),
            page.goto(loginURl, {timeout: loginTimeout})
        ]);
    
        let idsArrayString = '';
        let idsArray = Object.keys(jobInfo.flexCardsToCompile);
        for (let i = 0; i < idsArray.length; i++) {
            let cardId = idsArray[i];
            idsArrayString = idsArrayString + cardId + ','
        }
        idsArrayString = idsArrayString.substring(0, idsArrayString.length - 1);


        let flexCardCompilePage = siteUrl + '/apex/' + package + 'FlexCardCompilePage?id=' + idsArrayString;

        VlocityUtils.report('Starting LWC Activation For all Flex Cards', ' Number of FlexCards to compile: ' +  idsArray.length);

        VlocityUtils.verbose('LWC FlexCards Activation URL', flexCardCompilePage);

        let errorMessage;
        
        await page.goto(flexCardCompilePage, {timeout: loginTimeout});

        await page.waitForTimeout(5000);
        
        let tries = 0;
        let jsonError;
        
        let maxNumOfTries = Math.ceil((60/jobInfo.defaultLWCPullTimeInSeconds)*jobInfo.defaultMinToWaitForLWCFlexCards)*idsArray.length;
        while (tries < maxNumOfTries && !jobInfo.ignoreLWCActivationCards) {
            try {
                let message;
                try {
                    message = await page.waitForSelector('#compileMessage-0');
                } catch (messageTimeout) {
                    VlocityUtils.verbose('Error', messageTimeout);
                    VlocityUtils.log('FlexCards LWC Activation', 'Loading Page taking too long - Retrying - Tries: ' + tries + ' of ' + maxNumOfTries);
                }
                
                if (message) { 
                    let currentStatus = await message.asElement().evaluate(node => node.innerText);
                    VlocityUtils.report('Activating LWC for All FlexCards', currentStatus);
                    jobInfo.elapsedTime = VlocityUtils.getTime();
                    VlocityUtils.report('Elapsed Time', jobInfo.elapsedTime);
                    if (currentStatus === 'DONE SUCCESSFULLY') {
                        VlocityUtils.success('LWC Activated','All LWC for FlexCards Activated');
                        break;
                    } else if (currentStatus === 'DONE WITH ERRORS') {
                        let jsonResulNode  = await page.waitForSelector('#resultJSON-0');
                        jsonError = await jsonResulNode.asElement().evaluate(node => node.innerText);
                        VlocityUtils.verbose('LWC FlexCards Compilation Error Result', jsonError);
                        break;
                    } 
                }
            } catch (e) {
                VlocityUtils.error('Error Activating LWC',e);
            }
            tries++;
            await page.waitForTimeout(jobInfo.defaultLWCPullTimeInSeconds*1000);
        }

        if (tries == maxNumOfTries) {
            errorMessage = 'Activation took longer than ' + jobInfo.defaultMinToWaitForLWCFlexCards + ' minutes - Aborted';
        }

        if (jsonError) {
            jobInfo.hasError = true;
            let failedCards = JSON.parse(jsonError).failedCards;
            let failedCardsIds = Object.keys(failedCards);
            for (let i = 0; i < failedCardsIds.length; i++) {
                let failedCardsId = failedCardsIds[i];
                let errorMessageCard = failedCards[failedCardsId];
                let cardKey = jobInfo.flexCardsToCompile[failedCardsId];
                jobInfo.currentStatus[cardKey] = 'Error';
                jobInfo.currentErrors[cardKey] = 'LWC Activation Error >> ' + cardKey + ' - ' + errorMessageCard;
                jobInfo.errors.push('LWC Activation Error >> ' + cardKey + ' - ' + errorMessageCard);
                VlocityUtils.error('LWC Activation Error', cardKey + ' - ' +  errorMessageCard);
            }
        }
        
        if (errorMessage) {
            jobInfo.hasError = true;
            let failedCardsIds = Object.keys(jobInfo.flexCardsToCompile);
            for (let i = 0; i < failedCardsIds.length; i++) {
                let failedCardsId = failedCardsIds[i];
                let cardKey = jobInfo.flexCardsToCompile[failedCardsId];
                jobInfo.currentStatus[cardKey] = 'Error';
                //jobInfo.currentErrors[cardKey] = 'LWC Activation Error >> ' + cardKey + ' - ' + errorMessage;
                jobInfo.errors.push('LWC Activation Error >> ' + cardKey + ' - ' + errorMessage);
                VlocityUtils.error('LWC Activation Error', cardKey + ' - ' +  errorMessage);
            }
        }
        jobInfo.flexCardsToCompile = {};
        browser.close();
    }
}

FlexCard.prototype.onDeployFinish = async function(jobInfo) { 
    if (jobInfo.flexCardsToCompile) {
        let hasFlexCardCompiler = true;

        if (!jobInfo.ignoreLWCActivationCards && !jobInfo.checkLWCActivationCards) {
            let minVersions = yaml.safeLoad(fs.readFileSync(path.join(__dirname,'..', 'buildToolsMinVersionCards-LWC.yaml'), 'utf8'));
            let minVersion = minVersions[this.vlocity.namespace]
            let currentVersion = this.vlocity.PackageVersion;
            if (minVersion && currentVersion && !(currentVersion >= minVersion)) {
                jobInfo.ignoreLWCActivationCards = true;
                VlocityUtils.error('Cards LWC Activation', 'Unsupported Managed package Version, LWC Activation disabled');
            }
            jobInfo.checkLWCActivationCards = true;
        }

        if (jobInfo.ignoreLWCActivationCards) {
            return;
        }
        try { 
            let idsArray = Object.keys(jobInfo.flexCardsToCompile);
            if (idsArray.length < 1){ 
                return;
            }
            if (!jobInfo.ignoreLocalCompilationCards){
                //--------Load Flexcard compiler-------
                // Make sure we load the package version
                await this.vlocity.utilityservice.getPackageVersion();
    
                const compilerName = 'flexcard-compiler';
                const namespace = this.vlocity.namespace;
                const packageVersion = this.vlocity.PackageVersion;   
    
                const flexCardsCompiler = await VlocityUtils.loadCompiler(compilerName,
                                                jobInfo, packageVersion, namespace);
                if(flexCardsCompiler){
                    for (let i = 0; i < idsArray.length; i++) { 
                        let flexCardID = idsArray[i];
                        await this.compileFlexCardsLwc(flexCardID,jobInfo,flexCardsCompiler) ;
                    } 
                } else{
                    hasFlexCardCompiler= false;
                }
            } else{
                    hasFlexCardCompiler= false;
            }        
        } catch (e) {
            hasFlexCardCompiler= false;
            VlocityUtils.error('Error while loading Flexcard Compiler', e);
        }

         // If we were unable to load the compiler package, use the legacy method
        if(!hasFlexCardCompiler){
            await this.flexCardDeployWithPuppeteer(jobInfo) ;
            return;
        }
    }

    if(!jobInfo.haveCompiledUILayouts) {
        let layoutOb = new VlocityUILayout(this.vlocity);
        await layoutOb.onDeployFinish(jobInfo);
    }
} 
FlexCard.prototype.compileFlexCardsLwc = async function (flexCardID,jobInfo,flexCardsCompiler) {
    VlocityUtils.report('Compiling Flexcard with  FlexCard ID: ',flexCardID); 
    try { 
        const isInsidePackage = !(this.vlocity.PackageVersion === 'DeveloperOrg');
        let tempSfdxFolder = path.join(jobInfo.tempFolder, 'tempDeployLWC', 'salesforce_sfdx/lwc');
        
        const fCCompiler = new flexCardsCompiler(this.vlocity.namespace, this.vlocity.jsForceConnection,
                                                 this.vlocity.jsForceConnection.instanceUrl, isInsidePackage);  
        await fCCompiler.compileMetadataWithId(flexCardID, tempSfdxFolder);
        jobInfo.deployGeneratedLwc = true; 
    }
    catch (e) {
        hasFlexCardCompiler= false;
        VlocityUtils.error(e);
    }
    
} 

FlexCard.prototype.afterActivationSuccess = async function(inputMap) {
    var jobInfo = inputMap.jobInfo;   
    var dataPack = inputMap.dataPack;
    var data = dataPack.VlocityDataPackData['%vlocity_namespace%__VlocityCard__c'] || dataPack.VlocityDataPackData['OmniUiCard'];
    var cardSourceKey = data[0].VlocityRecordSourceKey;
    var definition = data[0]['%vlocity_namespace%__Definition__c'] || data[0]['PropertySetConfig'];
    var isFlexCard = definition.includes('"isFlex":true,');
    var isLWC = definition.includes('"enableLwc":true,');
    if (isFlexCard) {
        if (!jobInfo.flexCardsToCompile) {
            jobInfo.flexCardsToCompile = {};
        }
        VlocityUtils.log('LWC for FlexCard will be compiled at the end', dataPack.VlocityDataPackKey);
        jobInfo.flexCardsToCompile[jobInfo.sourceKeyToRecordId[cardSourceKey]] = dataPack.VlocityDataPackKey;
    }  
}



