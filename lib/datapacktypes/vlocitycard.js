var vlocity = require('../vlocity');
var utilityservice = require('../utilityservice');
var puppeteer = require('puppeteer-core');
var fs = require('fs-extra');
var path = require('path');
var yaml = require('js-yaml');

var VlocityCard = module.exports = function(vlocity) {
	this.vlocity = vlocity;
};

VlocityCard.prototype.onDeployFinish = async function(jobInfo) {

    if (jobInfo.flexCardsToCompile) {
        if (!jobInfo.ignoreLWCActivationCards && !jobInfo.checkLWCActivationCards) {
            var minVersions = yaml.safeLoad(fs.readFileSync(path.join(__dirname,'..', 'buildToolsMinVersionCards-LWC.yaml'), 'utf8'));
            var minVersion = minVersions[this.vlocity.namespace]
            var currentVersion = this.vlocity.PackageVersion;
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

            let puppeteerOptions = await utilityservice.prototype.getPuppeteerOptions(jobInfo);
 
            if (!puppeteerOptions.executablePath && !jobInfo.puppeteerInstalled) {
                VlocityUtils.error('Chromium not installed. LWC activation disabled. Run "npm install puppeteer -g" or set puppeteerExecutablePath in your Job File');
                jobInfo.ignoreLWCActivationCards = true;
                jobInfo.ignoreLWCActivationOS = true;
            } else {
                var package = this.vlocity.namespacePrefix;
            
                var siteUrl = this.vlocity.jsForceConnection.instanceUrl;
                var sessionToken = this.vlocity.jsForceConnection.accessToken;
                var loginURl = siteUrl + '/secur/frontdoor.jsp?sid=' + sessionToken;
                var browser;
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
            
                var idsArrayString = '';
                var idsArray = Object.keys(jobInfo.flexCardsToCompile);
                for (let i = 0; i < idsArray.length; i++) {
                    var cardId = idsArray[i];
                    idsArrayString = idsArrayString + cardId + ','
                }
                idsArrayString = idsArrayString.substring(0, idsArrayString.length - 1);


                var flexCardCompilePage = siteUrl + '/apex/' + package + 'FlexCardCompilePage?id=' + idsArrayString;

                VlocityUtils.verbose('LWC FlexCards Compilation URL', flexCardCompilePage);

                await page.goto(flexCardCompilePage);
                await page.waitForTimeout(5000);

                VlocityUtils.log('Starting LWC Compile For all Flex Cards', ' Number of FlexCards to compile: ' +  idsArray.length);
                
                let tries = 0;
                var jsonError;
                var errorMessage;
                var minutesToWait = jobInfo.defaultMinToWaitForLWCFlexCards*idsArray.length;
                var maxNumOfTries = minutesToWait*2;
                while (tries < maxNumOfTries && !jobInfo.ignoreLWCActivationCards) {
                    try {
                        let message;
                        try {
                            message = await page.waitForSelector('#compileMessage-0');
                        } catch (messageTimeout) {
                            VlocityUtils.log(dataPack.VlocityDataPackKey, 'Loading Page taking too long - Retrying - Tries: ' + tries + ' of ' + maxNumOfTries);
                        }
                        
                        if (message) { 
                            let currentStatus = await message.evaluate(node => node.innerText);
                            VlocityUtils.log('Activating All FlexCards LWC', currentStatus);
                            if (currentStatus === 'DONE SUCCESSFULLY') {
                                VlocityUtils.success('Activated','All LWC for FlexCards Activated');
                                break;
                            } else if (currentStatus === 'DONE WITH ERRORS') {
                                var jsonResulNode  = await page.waitForSelector('#resultJSON-0');
                                jsonError = await jsonResulNode.evaluate(node => node.innerText);
                                VlocityUtils.verbose('LWC FlexCards Compilation Error Result', jsonError);
                                break;
                            } 
                        }
                    } catch (e) {
                        VlocityUtils.error('Error Activating LWC',e);
                        errorMessage = ' Error: ' + e;
                    }
                    tries++;
                    await page.waitForTimeout(30000);
                }

                if (tries == maxNumOfTries) {
                    errorMessage = 'Activation took longer than ' + minutesToWait + ' minutes - Aborted';
                }

                if (jsonError) {
                    jobInfo.hasError = true;
                    var failedCards = JSON.parse(jsonError).failedCards;
                    var failedCardsIds = Object.keys(failedCards);
                    for (let i = 0; i < failedCardsIds.length; i++) {
                        var failedCardsId = failedCardsIds[i];
                        var errorMessageCard = failedCards[failedCardsId];
                        var carKey = jobInfo.flexCardsToCompile[failedCardsId];
                        jobInfo.currentStatus[carKey] = 'Error';
                        jobInfo.currentErrors[carKey] = 'LWC Activation Error >> ' + carKey + ' - ' + errorMessageCard;
                        jobInfo.errors.push('LWC Activation Error >> ' + carKey + ' - ' + errorMessageCard);
                        VlocityUtils.error('LWC Activation Error', carKey + ' - ' +  errorMessageCard);
                    }
                }
                
                if (errorMessage) {
                    jobInfo.hasError = true;
                    var failedCardsIds = Object.keys(jobInfo.flexCardsToCompile);
                    for (let i = 0; i < failedCardsIds.length; i++) {
                        var failedCardsId = failedCardsIds[i];
                        var carKey = jobInfo.flexCardsToCompile[failedCardsId];
                        jobInfo.currentStatus[carKey] = 'Error';
                        jobInfo.currentErrors[carKey] = 'LWC Activation Error >> ' + carKey + ' - ' + errorMessage;
                        jobInfo.errors.push('LWC Activation Error >> ' + carKey + ' - ' + errorMessage);
                        VlocityUtils.error('LWC Activation Error', carKey + ' - ' +  errorMessage);
                    }
                }

                browser.close();
            }
        } catch (e) {
            VlocityUtils.error(e);
        }
    }

}


VlocityCard.prototype.afterActivationSuccess = async function(inputMap) {
    var jobInfo = inputMap.jobInfo;
    var dataPack = inputMap.dataPack;
    var cardSourceKey = dataPack.VlocityDataPackData['%vlocity_namespace%__VlocityCard__c'][0].VlocityRecordSourceKey;
    var definition = dataPack.VlocityDataPackData['%vlocity_namespace%__VlocityCard__c'][0]['%vlocity_namespace%__Definition__c'];
    var isFlexCard = definition.includes('"isFlex":true,');
    if (isFlexCard) {
        if (!jobInfo.flexCardsToCompile) {
            jobInfo.flexCardsToCompile = {};
        }
        VlocityUtils.log('LWC for FlexCard will be compiled at the end', cardSourceKey);
        jobInfo.flexCardsToCompile[jobInfo.sourceKeyToRecordId[cardSourceKey]] = cardSourceKey;
    }
    //console.log(jobInfo.flexCardsToCompile);
}
