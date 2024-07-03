const utilityservice = require('../utilityservice.js');
const { launchBrowser, loginToBrowser,checkChromiumInstallation } = require('../puppeteerHelper/puppeteerHelper.js');
const { goToUniquePage, clickPreviewButton, clickDeactivate, clickActivate, verifyOmniscriptActivation } = require('../puppeteerHelper/browserHelper.js');
const { activateOmniScript, handleErrorAndDeactivate } = require('../puppeteerHelper/omniScriptHelper.js');
let count = 0
const compileOSLWCJob = async (jobInfo, omniScriptId, omniScriptKey, deactivateOmniScript, vlocity) => {
    let browser;
    let errorMessage =  "";
    try {
        VlocityUtils.verbose('Getting Puppeteer options...');
        const puppeteerOptions = await utilityservice.prototype.getPuppeteerOptions(jobInfo);
        VlocityUtils.report('Deployed OmniScript ID', omniScriptKey + ' (' + omniScriptId + ')');
        VlocityUtils.verbose('Puppeteer options retrieved:', puppeteerOptions);

        VlocityUtils.verbose('Checking Chromium installation...');
        if (!checkChromiumInstallation(puppeteerOptions, jobInfo)) {
            VlocityUtils.verbose('Chromium installation check failed.');
            return;
        }

        const packageNamespace = vlocity.namespacePrefix;
        const siteUrl = vlocity.jsForceConnection.instanceUrl;
        const sessionToken = vlocity.jsForceConnection.accessToken;
        const loginUrl = `${siteUrl}/secur/frontdoor.jsp?sid=${sessionToken}`;
        VlocityUtils.verbose('LWC Activation Login URL', loginUrl);

        VlocityUtils.verbose('Launching browser...');
        browser = await launchBrowser(puppeteerOptions);
        if (!browser) {
            VlocityUtils.verbose('Browser launch failed, setting ignoreLWCActivationOS to true.');
            jobInfo.ignoreLWCActivationOS = true;
            return;
        }

        VlocityUtils.verbose('Logging into browser...');
        const page = await loginToBrowser(browser, loginUrl, jobInfo);
        VlocityUtils.verbose('logged into browser');
        await page.setViewport({ width: 1520, height: 1000 });

        VlocityUtils.verbose('$Activating OmniScript...');
        errorMessage = await activateOmniScript(page, siteUrl, packageNamespace, omniScriptId, omniScriptKey, jobInfo);
        if (errorMessage) {
            VlocityUtils.verbose('$Error during OmniScript activation:', errorMessage);
            await handleErrorAndDeactivate(errorMessage, jobInfo, omniScriptId, omniScriptKey, deactivateOmniScript);
            throw new Error(` rkishan${errorMessage}`); 
        }
        // await new Promise(resolve => setTimeout(resolve, 4000));
        // await goToUniquePage(page, siteUrl, packageNamespace, omniScriptId);


        // await new Promise(resolve => setTimeout(resolve, 15000));

        // VlocityUtils.verbose('$Clicking preview button...');
        // await clickPreviewButton(page);


        // await new Promise(resolve => setTimeout(resolve, 20000));
        
        // const omniScriptLogId = `${omniScriptKey} (${omniScriptId})`;

        // VlocityUtils.verbose('$Verifying OmniScript activation...');
        // const [enableReactivate,erroMessageInPreview] = await verifyOmniscriptActivation(page, packageNamespace,omniScriptLogId);
        // await page.screenshot({ path: `before verify${count++}.png` });
        // if (enableReactivate) {
        //     VlocityUtils.error(`$Reactivation required. Deactivating reason we found this error message in preview ${erroMessageInPreview}`);
        //     await clickDeactivate(page);

           
        //     await new Promise(resolve => setTimeout(resolve, 10000));

        //     VlocityUtils.verbose('Activating...');
        //     await clickActivate(page);

        //     await new Promise(resolve => setTimeout(resolve, 10000));

        //     VlocityUtils.verbose('Verifying OmniScript activation after reactivation...');
        //     await page.screenshot({ path: `before verify${count++}.png` });
        //     const [verificationfailed,errorMessageAfterReactivate] = await verifyOmniscriptActivation(page, packageNamespace,omniScriptLogId);
        //     if (verificationfailed) {
        //         throw new Error(`Even after reactivating we found ${omniScriptKey} has a text Error after click preview the error we got is ${errorMessage}`);
        //     }

        //     VlocityUtils.success('$LWC Activated_Manually', omniScriptLogId);
        //     return;
        // }

        // VlocityUtils.success('$LWC Activated_Manually wasn\'t required', omniScriptLogId);  
    } catch (e) {
        const omniScriptLogId = `${omniScriptKey} (${omniScriptId})`;
        VlocityUtils.error(e);
        VlocityUtils.error('$LWC Activated_Manually Error', omniScriptLogId + ' - ' + e + errorMessage);
        await handleErrorAndDeactivate(e, jobInfo, omniScriptId, omniScriptKey, deactivateOmniScript);
    } finally {
        if (browser) {
            VlocityUtils.verbose('Closing browser...');
            await browser.close();
        }
    }
};


module.exports = compileOSLWCJob;
