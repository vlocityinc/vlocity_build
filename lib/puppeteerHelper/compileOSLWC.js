const utilityservice = require('../utilityservice.js');
const { launchBrowser, loginToBrowser,checkChromiumInstallation } = require('../puppeteerHelper/puppeteerHelper.js');
const { goToUniquePage, clickPreviewButton, clickDeactivate, clickActivate, verifyOmniscriptActivation } = require('../puppeteerHelper/browserHelper.js');
const { activateOmniScript, handleErrorAndDeactivate } = require('../puppeteerHelper/omniScriptHelper.js');

const compileOSLWCJob = async (jobInfo, omniScriptId, omniScriptKey, deactivateOmniScript, vlocity) => {
    let browser;
    
    try {
        const puppeteerOptions = await utilityservice.prototype.getPuppeteerOptions(jobInfo);
        VlocityUtils.report('Deployed OmniScript ID', omniScriptKey + ' (' + omniScriptId + ')');

        if (!checkChromiumInstallation(puppeteerOptions, jobInfo)) return;
        const packageNamespace = vlocity.namespacePrefix;
        const siteUrl = vlocity.jsForceConnection.instanceUrl;
        const sessionToken = vlocity.jsForceConnection.accessToken;
        const loginUrl = `${siteUrl}/secur/frontdoor.jsp?sid=${sessionToken}`;
        VlocityUtils.verbose('LWC Activation Login URL', loginUrl);

        browser = await launchBrowser(puppeteerOptions);
        if (!browser) {
            jobInfo.ignoreLWCActivationOS = true;
            return;
        }

        const page = await loginToBrowser(browser, loginUrl, jobInfo);
        await page.setViewport({ width: 1520, height: 1000 });

        const errorMessage = await activateOmniScript(page, siteUrl, packageNamespace, omniScriptId, omniScriptKey, jobInfo);
        if (errorMessage) {
            await handleErrorAndDeactivate(errorMessage, jobInfo, omniScriptId, omniScriptKey,deactivateOmniScript);
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 5000));
        await goToUniquePage(page, siteUrl, packageNamespace, omniScriptId);
        await new Promise(resolve => setTimeout(resolve, 20000));
        await clickPreviewButton(page, 15000);
        await new Promise(resolve => setTimeout(resolve, 10000));
        const omniScriptLogId = `${omniScriptKey} (${omniScriptId})`;
        const enableReactivate = await verifyOmniscriptActivation(page);
        if (enableReactivate) {
            await clickDeactivate(page);
            await new Promise(resolve => setTimeout(resolve, 10000));
            await clickActivate(page);
            await new Promise(resolve => setTimeout(resolve, 10000));

            const omniscriptIsDeployedProperly = await verifyOmniscriptActivation(page);
            if (!omniscriptIsDeployedProperly) {
                throw new Error(`Even after reactivating we found ${omniScriptKey} has a text Error after click preview`);
            }
            VlocityUtils.success('LWC Activated_Manually', omniScriptLogId);
            return
        }
        VlocityUtils.success('LWC Activated_Manually wasnt required', omniScriptLogId);  
    } catch (e) {
        const omniScriptLogId = `${omniScriptKey} (${omniScriptId})`;
        VlocityUtils.error(e);
        VlocityUtils.error('LWC Activated_Manually Error', omniScriptLogId + ' - ' + e);
        await handleErrorAndDeactivate(e, jobInfo, omniScriptId, omniScriptKey,deactivateOmniScript);
    } finally {
        if (browser) await browser.close();
    }
};

module.exports = compileOSLWCJob;