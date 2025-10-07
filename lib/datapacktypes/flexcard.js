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
    
        let idsArray = Object.keys(jobInfo.flexCardsToCompile);
        
        if (jobInfo.useBulkOmniScriptLwcCompile) {
            // Process FlexCards one by one when bulk mode is enabled
            VlocityUtils.report('Starting Individual FlexCard LWC Activation (Bulk Mode)', 'Number of FlexCards to compile: ' + idsArray.length);
            
            for (let i = 0; i < idsArray.length; i++) {
                let flexCardId = idsArray[i];
                let flexCardKey = jobInfo.flexCardsToCompile[flexCardId];
                
                await this.compileFlexCardLwcIndividual(jobInfo, flexCardId, flexCardKey, page, package, siteUrl, loginTimeout);
            }
        } else {
            // Original bulk processing logic - refactored to use common methods
            await this.compileBulkFlexCards(jobInfo, idsArray, page, package, siteUrl, loginTimeout);
        }
        jobInfo.flexCardsToCompile = {};
        browser.close();
    }
}

// Common method to monitor FlexCard compilation status
FlexCard.prototype.monitorFlexCardCompilation = async function(page, jobInfo, context) {
    let tries = 0;
    var errorMessage;
    var maxNumOfTries = Math.ceil((60 / jobInfo.defaultLWCPullTimeInSeconds) * jobInfo.defaultMinToWaitForLWCFlexCards);
    if (context.isIndividual) {
        // For individual cards, don't multiply by array length
        maxNumOfTries = Math.ceil((60 / jobInfo.defaultLWCPullTimeInSeconds) * jobInfo.defaultMinToWaitForLWCFlexCards);
    } else {
        // For bulk processing, multiply by array length
        maxNumOfTries = maxNumOfTries * context.cardCount;
    }
    
    while (tries < maxNumOfTries && !jobInfo.ignoreLWCActivationCards) {
        try {
            let message;
            try {
                message = await page.waitForSelector('#compileMessage-0');
            } catch (messageTimeout) {
                VlocityUtils.verbose('Error', messageTimeout);
                VlocityUtils.log(context.logPrefix, 'Loading Page taking too long - Retrying - Tries: ' + tries + ' of ' + maxNumOfTries);
            }

            if (message) {
                let currentStatus = await message.evaluate(node => node.innerText);
                VlocityUtils.report(context.statusMessage, context.logId || context.logPrefix, currentStatus);
                jobInfo.elapsedTime = VlocityUtils.getTime();
                VlocityUtils.report('Elapsed Time', jobInfo.elapsedTime);
                
                if (currentStatus === 'DONE SUCCESSFULLY') {
                    VlocityUtils.success('LWC Activated', context.logId || context.successMessage);
                    
                    // Extract session storage data if in individual/bulk mode
                    if (context.isIndividual && context.flexCardKey) {
                        await this.vlocity.utilityservice.extractSessionStorageData(page, context.flexCardKey, jobInfo, 'FlexCard');
                    }
                    
                    return { success: true };
                } else if (currentStatus === 'DONE WITH ERRORS') {
                    let jsonResulNode = await page.waitForSelector('#resultJSON-0');
                    let jsonError = await jsonResulNode.evaluate(node => node.innerText);
                    VlocityUtils.verbose('LWC FlexCard Compilation Error Result', jsonError);
                    
                    return { success: false, jsonError: jsonError };
                }
            }
        } catch (e) {
            VlocityUtils.error('Error Activating LWC', context.logId || context.logPrefix, e);
            errorMessage = ' Error: ' + e;
        }
        tries++;
        await page.waitForTimeout(jobInfo.defaultLWCPullTimeInSeconds * 1000);
    }

    if (tries == maxNumOfTries) {
        errorMessage = 'Activation took longer than ' + jobInfo.defaultMinToWaitForLWCFlexCards + ' minutes - Aborting';
    }

    return { success: false, errorMessage: errorMessage };
}

// Common method to handle FlexCard compilation errors
FlexCard.prototype.handleFlexCardErrors = function(jobInfo, errorData, context) {
    if (errorData.jsonError) {
        jobInfo.hasError = true;
        let failedCards = JSON.parse(errorData.jsonError).failedCards;
        
        if (context.isIndividual) {
            // Handle individual card error
            let errorMessageCard = failedCards[context.flexCardId] || 'Unknown error';
            let errorMessage = ' Error Activating LWC - ' + errorMessageCard;
            this.setFlexCardError(jobInfo, context.flexCardKey, errorMessage);
        } else {
            // Handle bulk processing errors
            let failedCardsIds = Object.keys(failedCards);
            for (let i = 0; i < failedCardsIds.length; i++) {
                let failedCardsId = failedCardsIds[i];
                let errorMessageCard = failedCards[failedCardsId];
                let cardKey = jobInfo.flexCardsToCompile[failedCardsId];
                this.setFlexCardError(jobInfo, cardKey, errorMessageCard);
            }
        }
    } else if (errorData.errorMessage) {
        jobInfo.hasError = true;
        
        if (context.isIndividual) {
            // Handle individual card timeout/error
            this.setFlexCardError(jobInfo, context.flexCardKey, errorData.errorMessage);
        } else {
            // Handle bulk processing timeout/error
            let failedCardsIds = Object.keys(jobInfo.flexCardsToCompile);
            for (let i = 0; i < failedCardsIds.length; i++) {
                let failedCardsId = failedCardsIds[i];
                let cardKey = jobInfo.flexCardsToCompile[failedCardsId];
                this.setFlexCardError(jobInfo, cardKey, errorData.errorMessage);
            }
        }
    }
}

// Helper method to set error status for a FlexCard
FlexCard.prototype.setFlexCardError = function(jobInfo, cardKey, errorMessage) {
    jobInfo.currentStatus[cardKey] = 'Error';
    jobInfo.currentErrors[cardKey] = 'LWC Activation Error >> ' + cardKey + ' - ' + errorMessage;
    jobInfo.errors.push('LWC Activation Error >> ' + cardKey + ' - ' + errorMessage);
    VlocityUtils.error('LWC Activation Error', cardKey + ' - ' + errorMessage);
}

FlexCard.prototype.compileBulkFlexCards = async function(jobInfo, idsArray, page, package, siteUrl, loginTimeout) {
    // Build comma-separated string of IDs
    let idsArrayString = idsArray.join(',');
    let flexCardCompilePage = siteUrl + '/apex/' + package + 'FlexCardCompilePage?id=' + idsArrayString;

    VlocityUtils.report('Starting LWC Activation For all Flex Cards', ' Number of FlexCards to compile: ' + idsArray.length);
    VlocityUtils.verbose('LWC FlexCards Activation URL', flexCardCompilePage);

    await page.goto(flexCardCompilePage, {timeout: loginTimeout});
    await page.waitForTimeout(5000);

    // Use common monitoring method
    const context = {
        isIndividual: false,
        logPrefix: 'FlexCards LWC Activation',
        statusMessage: 'Activating LWC for All FlexCards',
        successMessage: 'All LWC for FlexCards Activated',
        cardCount: idsArray.length
    };

    const result = await this.monitorFlexCardCompilation(page, jobInfo, context);
    
    if (!result.success) {
        this.handleFlexCardErrors(jobInfo, result, context);
    }
}

FlexCard.prototype.compileFlexCardLwcIndividual = async function(jobInfo, flexCardId, flexCardKey, page, package, siteUrl, loginTimeout) {
    try {
        // Add bulk parameter similar to OmniScript
        var bulkParam = '&deploybulk=true';
        var flexCardCompilePage = siteUrl + '/apex/' + package + 'FlexCardCompilePage?id=' + flexCardId + bulkParam;
        var flexCardLogId = flexCardKey + ' (' + flexCardId + ')';

        VlocityUtils.report('Starting FlexCard LWC Activation', flexCardLogId);
        VlocityUtils.verbose('LWC FlexCard Activation URL', flexCardCompilePage);

        await page.goto(flexCardCompilePage, {timeout: loginTimeout});
        await page.waitForTimeout(5000);

        // Use common monitoring method
        const context = {
            isIndividual: true,
            flexCardId: flexCardId,
            flexCardKey: flexCardKey,
            logId: flexCardLogId,
            logPrefix: flexCardKey,
            statusMessage: 'Activating LWC for FlexCard',
            cardCount: 1
        };

        const result = await this.monitorFlexCardCompilation(page, jobInfo, context);
        
        if (!result.success) {
            this.handleFlexCardErrors(jobInfo, result, context);
        }
    } catch (e) {
        VlocityUtils.error('Error in individual FlexCard compilation', flexCardKey, e);
        this.setFlexCardError(jobInfo, flexCardKey, e.toString());
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
            await new Promise(resolve => setTimeout(resolve, jobInfo.msToWaitForLWCDeploy));
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



