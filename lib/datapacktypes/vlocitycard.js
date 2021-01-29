var vlocity = require('../vlocity');
var utilityservice = require('../utilityservice');
var VlocityUILayout = require('./vlocityuilayout');
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

                VlocityUtils.report('Starting LWC Activation For all Flex Cards', ' Number of FlexCards to compile: ' +  idsArray.length);

                VlocityUtils.verbose('LWC FlexCards Activation URL', flexCardCompilePage);

                var errorMessage;
                
                await page.goto(flexCardCompilePage, {timeout: loginTimeout});

                await page.waitForTimeout(5000);
                
                let tries = 0;
                var jsonError;
                
                var maxNumOfTries = Math.ceil((60/jobInfo.defaultLWCPullTimeInSeconds)*jobInfo.defaultMinToWaitForLWCFlexCards)*idsArray.length;
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
                            let currentStatus = await message.evaluate(node => node.innerText);
                            VlocityUtils.report('Activating LWC for All FlexCards', currentStatus);
                            jobInfo.elapsedTime = VlocityUtils.getTime();
                            VlocityUtils.report('Elapsed Time', jobInfo.elapsedTime);
                            if (currentStatus === 'DONE SUCCESSFULLY') {
                                VlocityUtils.success('LWC Activated','All LWC for FlexCards Activated');
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
                    }
                    tries++;
                    await page.waitForTimeout(jobInfo.defaultLWCPullTimeInSeconds*1000);
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
                        var cardKey = jobInfo.flexCardsToCompile[failedCardsId];
                        jobInfo.currentStatus[cardKey] = 'Error';
                        jobInfo.currentErrors[cardKey] = 'LWC Activation Error >> ' + cardKey + ' - ' + errorMessageCard;
                        jobInfo.errors.push('LWC Activation Error >> ' + cardKey + ' - ' + errorMessageCard);
                        VlocityUtils.error('LWC Activation Error', cardKey + ' - ' +  errorMessageCard);
                    }
                }
                
                if (errorMessage) {
                    jobInfo.hasError = true;
                    var failedCardsIds = Object.keys(jobInfo.flexCardsToCompile);
                    for (let i = 0; i < failedCardsIds.length; i++) {
                        var failedCardsId = failedCardsIds[i];
                        var cardKey = jobInfo.flexCardsToCompile[failedCardsId];
                        jobInfo.currentStatus[cardKey] = 'Error';
                        //jobInfo.currentErrors[cardKey] = 'LWC Activation Error >> ' + cardKey + ' - ' + errorMessage;
                        jobInfo.errors.push('LWC Activation Error >> ' + cardKey + ' - ' + errorMessage);
                        VlocityUtils.error('LWC Activation Error', cardKey + ' - ' +  errorMessage);
                    }
                }
                jobInfo.flexCardsToCompile = {};
                browser.close();
            }
        } catch (e) {
            VlocityUtils.error(e);
        }
    }

    if(!jobInfo.haveCompiledUILayouts) {
        var layoutOb = new VlocityUILayout(this.vlocity);
        await layoutOb.onDeployFinish(jobInfo);
    }
}


VlocityCard.prototype.afterActivationSuccess = async function(inputMap) {
    var jobInfo = inputMap.jobInfo;   
    var dataPack = inputMap.dataPack;
    var cardSourceKey = dataPack.VlocityDataPackData['%vlocity_namespace%__VlocityCard__c'][0].VlocityRecordSourceKey;
    var definition = dataPack.VlocityDataPackData['%vlocity_namespace%__VlocityCard__c'][0]['%vlocity_namespace%__Definition__c'];
    var isFlexCard = definition.includes('"isFlex":true,');
    var isLWC = definition.includes('"enableLwc":true,');
    if (isFlexCard) {
        if (!jobInfo.flexCardsToCompile) {
            jobInfo.flexCardsToCompile = {};
        }
        VlocityUtils.log('LWC for FlexCard will be compiled at the end', dataPack.VlocityDataPackKey);
        jobInfo.flexCardsToCompile[jobInfo.sourceKeyToRecordId[cardSourceKey]] = dataPack.VlocityDataPackKey;
    } else if (isLWC && jobInfo.lookForParentLayoutsForlWCCards) {
        var parentUILayouts = await this.addParentUILayoutForCard(jobInfo,dataPack.VlocityDataPackKey);
    }
}


VlocityCard.prototype.addParentUILayoutForCard = async function(jobInfo,carKey) {

    if (!jobInfo.UILayoutsToCompile) {
        jobInfo.UILayoutsToCompile =  {};
    }

    var cardsKeys = Object.keys(jobInfo.sourceKeyToMatchingKeysData);
    for (let i = 0; i < cardsKeys.length; i++) {
        var key = cardsKeys[i];
        var LayoutsToLookFor = [];
        if (key.includes('VlocityUILayout')) {
            var object = jobInfo.sourceKeyToMatchingKeysData[key];
            var definitionFile = path.join(jobInfo.projectPath, jobInfo.expansionPath,'VlocityUILayout',object.Name,object['%vlocity_namespace%__Definition__c']);
            var UILayoutName = object.Name;
            let rawdata = fs.readFileSync(definitionFile);
            if (rawdata) {
                let definitionContent = JSON.parse(rawdata);
                var UILayoutcards = definitionContent.Cards;
                if (UILayoutcards) {
                    for (let i = 0; i < UILayoutcards.length; i++) {
                        var cardName = UILayoutcards[i];
                        if(carKey.split('/')[1] == cardName){
                            LayoutsToLookFor.push(UILayoutName)
                        }      
                    }
                }
            }
        }  
        if (LayoutsToLookFor.length > 0) {      
            var query = `SELECT ID, Name FROM ${this.vlocity.namespacePrefix}VlocityUILayout__c WHERE ${this.vlocity.namespacePrefix}Active__c = true AND Name IN (`
            for (let i = 0; i < LayoutsToLookFor.length; i++) {
                var UILayoutName = LayoutsToLookFor[i];
                query += "'" + UILayoutName + "',"; 
            }
            query = query.substring(0, query.length - 1) + ')';
            try {
                var result = await this.vlocity.jsForceConnection.query(query);
                var records = await result.records;
                for (let i = 0; i < records.length; i++) {
                    const element = records[i];
                    //console.log(element);
                    jobInfo.UILayoutsToCompile[element.Id] = 'VlocityUILayout/' + element.Name;
                    VlocityUtils.log('LWC for VlocityUILayout will be compiled at the end for chield Card', carKey);
                }
            } catch (error) {
                VlocityUtils.error('Could not get Parent VlocityUILayout for Card ', carKey + ' - ' +  error);
            }
        }
    }
}