var vlocity = require('../vlocity');
var utilityservice = require('../utilityservice');
var puppeteer = require('puppeteer-core');
var fs = require('fs-extra');
var path = require('path');
var yaml = require('js-yaml');

var VlocityUILayout = module.exports = function(vlocity) {
	this.vlocity = vlocity;
};

VlocityUILayout.prototype.onDeployFinish = async function(jobInfo) {

    if (jobInfo.UILayoutsToCompile) {
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
            
                for (let i = 0; i < jobInfo.UILayoutsToCompile.length; i++) {
                    var layoutSourceKey = jobInfo.UILayoutsToCompile[i];
                    var layoutId = jobInfo.sourceKeyToRecordId[layoutSourceKey];

                    var pageCarddesignernew = siteUrl + '/apex/' + package + 'carddesignernew?id=' + layoutId + '&compile=true';

                    VlocityUtils.verbose('LWC Card Compilation URL', pageCarddesignernew);

                    await page.goto(pageCarddesignernew);
                    await page.waitForTimeout(5000);

                    VlocityUtils.log('Starting LWC Compilation for Classic Card',layoutSourceKey);
                    
                    let tries = 0;
                    var errorMessage;
                    var maxNumOfTries = jobInfo.defaultMinToWaitForLWCClassicCards*2;
                    while (tries < maxNumOfTries && !jobInfo.ignoreLWCActivationCards) {
                        try {
                            let message;
                            try {
                                message = await page.waitForSelector('#compileMessage');
                            } catch (messageTimeout) {
                                VlocityUtils.log(dataPack.VlocityDataPackKey, 'Loading Page taking too long - Retrying - Tries: ' + tries + ' of ' + maxNumOfTries);
                            }
                            
                            if (message) { 
                                let currentStatus = await message.evaluate(node => node.innerText);
                                VlocityUtils.log('Activating Classic Card LWC', layoutSourceKey, currentStatus);
                                if (currentStatus === 'DONE') {
                                    VlocityUtils.success('Activated','LWC Activated for Card: ' + layoutSourceKey);
                                    break;
                                } else if (/^No MODULE named markup/.test(currentStatus)) {
                                    var missingLWCTrimedError = currentStatus.substring('ERROR:'.length, currentStatus.indexOf('found :'));
                                    errorMessage = ' Missing Custom LWC - ' + missingLWCTrimedError;
                                    break;
                                } else if (/^ERROR/.test(currentStatus)) {
                                    errorMessage = ' Error Activating LWC - ' + currentStatus;
                                    break;
                                }
                            }
                        } catch (e) {
                            VlocityUtils.error('Error Activating LWC', layoutSourceKey, e);
                            errorMessage = ' Error: ' + e;
                        }
                        tries++;
                        await page.waitForTimeout(30000);
                    }

                    if (tries == maxNumOfTries) {
                        errorMessage = 'Activation took longer than ' + jobInfo.defaultMinToWaitForLWCClassicCards + ' minutes - Aborted';
                    }

                    if (errorMessage) {
                        if (!jobInfo.CardLwcActivationSkip) {
                            jobInfo.CardLwcActivationSkip = {};
                        }
                        jobInfo.hasError = true;
                        jobInfo.currentStatus[dataPack.VlocityDataPackKey] = 'Error';
                        jobInfo.currentErrors[dataPack.VlocityDataPackKey] = 'LWC Activation Error >> ' + dataPack.VlocityDataPackKey + ' - '+ errorMessage;
                        jobInfo.errors.push('LWC Activation Error >> ' + dataPack.VlocityDataPackKey + errorMessage);
                        VlocityUtils.error('LWC Activation Error', dataPack.VlocityDataPackKey + errorMessage);
                        await this.deactivateOmniScript(omniScriptId);
                    }
                }
                browser.close();
            }
        } catch (e) {
            VlocityUtils.error(e);
        }
    }

}

VlocityUILayout.prototype.afterActivationSuccess = async function(inputMap) {
    var jobInfo = inputMap.jobInfo;
    var dataPack = inputMap.dataPack;
    var clayoutSourceKey = dataPack.VlocityDataPackData['%vlocity_namespace%__VlocityUILayout__c'][0].VlocityRecordSourceKey;
    var definition = dataPack.VlocityDataPackData['%vlocity_namespace%__VlocityUILayout__c'][0]['%vlocity_namespace%__Definition__c'];
    var isLWC = definition.includes('"enableLwc":true,');
    if (isLWC) {
        if (!jobInfo.UILayoutsToCompile) {
            jobInfo.UILayoutsToCompile = [];
        }
        VlocityUtils.log('LWC for Classic Card will be compile at the end', dataPack.VlocityDataPackData['%vlocity_namespace%__VlocityUILayout__c'][0].VlocityRecordSourceKey );
        jobInfo.UILayoutsToCompile.push(clayoutSourceKey);
    }
}
