
exports.activateOmniScript = async (page, siteUrl, packageNamespace, omniScriptId, omniScriptKey, jobInfo) => {
    const omniScriptDesignerPageLink = `${siteUrl}/apex/${packageNamespace}OmniLwcCompile?id=${omniScriptId}&activate=true`;
    const omniScriptLogId = `${omniScriptKey} (${omniScriptId})`;

    VlocityUtils.report('Starting OmniScript LWC Activation', omniScriptLogId);
    VlocityUtils.verbose('LWC Activation URL', omniScriptDesignerPageLink);

    await page.goto(omniScriptDesignerPageLink, { timeout: 900000, waitUntil: 'networkidle0' });
    await new Promise(resolve => setTimeout(resolve, 5000));

    let tries = 0;
    let errorMessage;
    const maxNumOfTries = Math.ceil((60 / jobInfo.defaultLWCPullTimeInSeconds) * jobInfo.defaultMinToWaitForLWCOmniScript);

    while (tries < maxNumOfTries && !jobInfo.ignoreLWCActivationOS) {
        try {
            let message;
            try {
                message = await page.waitForSelector('#compiler-message');
            } catch (messageTimeout) {
                VlocityUtils.verbose('Error', messageTimeout);
                console.log(omniScriptKey, 'Loading Page taking too long - Retrying - Tries: ' + tries + ' of ' + maxNumOfTries);
            }

            if (message) {
                const currentStatus = await message.evaluate(node => node.innerText);
                VlocityUtils.report('Activating LWC for OmniScript', omniScriptLogId, currentStatus);
                jobInfo.elapsedTime = VlocityUtils.report('Elapsed Time', jobInfo.elapsedTime);

                if (currentStatus === 'DONE') {
                    VlocityUtils.success('LWC Activated', omniScriptLogId);
                    break;
                } else if (/^ERROR: No MODULE named markup/.test(currentStatus)) {
                    errorMessage = 'Missing Custom LWC - ' + currentStatus.substring('ERROR: '.length, currentStatus.indexOf(' found :'));
                    break;
                } else if (/^ERROR/.test(currentStatus)) {
                    errorMessage = 'Error Activating LWC - ' + currentStatus;
                    break;
                }
            }
        } catch (e) {
            VlocityUtils.error('Error Activating LWC', omniScriptLogId, e);
            errorMessage = 'Error: ' + e;
        }
        tries++;
        await new Promise(resolve => setTimeout(resolve, jobInfo.defaultLWCPullTimeInSeconds * 1000));
    }

    if (tries === maxNumOfTries) {
        errorMessage = 'Activation took longer than ' + jobInfo.defaultMinToWaitForLWCOmniScript + ' minutes - Aborting';
    }

    return errorMessage;
};

exports.handleErrorAndDeactivate = async (errorMessage, jobInfo, omniScriptId, omniScriptKey, deactivateOmniScript) => {
    if (!jobInfo.omniScriptLwcActivationSkip) {
        jobInfo.omniScriptLwcActivationSkip = {};
    }
    jobInfo.omniScriptLwcActivationSkip[omniScriptKey] = errorMessage;
    jobInfo.hasError = true;
    jobInfo.currentStatus[omniScriptKey] = 'Error';
    jobInfo.currentErrors[omniScriptKey] = 'LWC Activation Error >> ' + omniScriptKey + ' - ' + errorMessage;
    jobInfo.errors.push('LWC Activation Error >> ' + omniScriptKey + ' - ' + errorMessage);
    VlocityUtils.error('LWC Activation Error', omniScriptKey + ' - ' + errorMessage);
    await deactivateOmniScript(omniScriptId);
};


