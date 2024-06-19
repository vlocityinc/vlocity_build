const puppeteer = require('puppeteer-core');

exports.getPuppeteerOptions = async (jobInfo) => {
    return await jobInfo.getPuppeteerOptions();
};

exports.launchBrowser = async (puppeteerOptions) => {
    try {
        // return await puppeteer.launch({ ...puppeteerOptions, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
        return await puppeteer.launch(puppeteerOptions);
    } catch (error) {
        VlocityUtils.error('Puppeteer initialization Failed, LWC Activation disabled - ' + error);
        return null;
    }
};

exports.loginToBrowser = async (browser, loginUrl, jobInfo) => {
    const page = await browser.newPage();
    const loginTimeout = jobInfo.loginTimeoutForLoginLWC;
    await Promise.all([
        page.waitForNavigation({ timeout: loginTimeout, waitUntil: 'load' }),
        page.waitForNavigation({ timeout: loginTimeout, waitUntil: 'networkidle2' }),
        page.goto(loginUrl, { timeout: loginTimeout })
    ]);
    return page;
};

exports.checkChromiumInstallation = (puppeteerOptions, jobInfo) => {
    if (!puppeteerOptions.executablePath && !jobInfo.puppeteerInstalled) {
        VlocityUtils.error('Chromium not installed. LWC activation disabled. Run "npm install puppeteer -g" or set puppeteerExecutablePath in your Job File');
        jobInfo.ignoreLWCActivationOS = true;
        jobInfo.ignoreLWCActivationCards = true;
        return false;
    }
    return true;
}
