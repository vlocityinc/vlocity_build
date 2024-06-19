exports.goToUniquePage = async (page, siteUrl, packageNamespace, omniScriptId) => {
    const omniScriptDesignerPageLink = `${siteUrl}/lightning/cmp/${packageNamespace}OmniDesignerAuraWrapper?c__recordId=${omniScriptId}`;
    await page.goto(omniScriptDesignerPageLink, { timeout: 900000, waitUntil: 'networkidle2' });
};

exports.clickPreviewButton = async (page, timeout) => {
    await page.mouse.click(1127, 134);
};

exports.clickDeactivate = async (page) => {
    let pageChanged = false;
    page.on('framenavigated', frame => {
        if (frame === page.mainFrame()) pageChanged = true;
    });

    await page.mouse.click(1358, 134);
    await new Promise(res => setTimeout(res, 15000));
    await page.mouse.click(1042, 572);
    await new Promise(res => setTimeout(res, 5000));
    
    if (!pageChanged) {
        await new Promise(res => setTimeout(res, 5000));
        await page.keyboard.down('Tab');
        await page.keyboard.up('Tab');
    }
    await page.keyboard.down('Tab');
    await page.keyboard.up('Tab');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');

    if (pageChanged) {
        await new Promise(res => setTimeout(res, 10000));
        await page.keyboard.down('Tab');
        await page.keyboard.up('Tab');
        await page.keyboard.down('Enter');
        await page.keyboard.up('Enter');
    }
};

exports.clickActivate = async (page) => {
    let pageChanged = false;
    page.on('framenavigated', frame => {
        if (frame === page.mainFrame()) pageChanged = true;
    });

    await page.mouse.click(1358, 134);
    await new Promise(res => setTimeout(res, 5000));
    await page.mouse.click(1042, 572);
    await new Promise(res => setTimeout(res, 25000));

    if (!pageChanged) {
        await new Promise(res => setTimeout(res, 5000));
        await page.keyboard.down('Tab');
        await page.keyboard.up('Tab');
    }
    await page.keyboard.down('Tab');
    await page.keyboard.up('Tab');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    await page.mouse.click(1054, 670);

    if (pageChanged) {
        await new Promise(res => setTimeout(res, 7000));
        await page.keyboard.down('Tab');
        await page.keyboard.up('Tab');
        await page.keyboard.down('Enter');
        await page.keyboard.up('Enter');
    }
};


exports.verifyOmniscriptActivation = async (page) => {
    const getShadowElement = async (element, selector) => {
        return await element.evaluateHandle((el, sel) => el.shadowRoot.querySelector(sel), selector);
    };

    const canvasWebComponentHandle = await page.$('omnistudio-omni-designer-canvas');
    if (!canvasWebComponentHandle) throw new Error('omnistudio-omni-designer-canvas element not found');

    const designerCanvasHandle = await getShadowElement(canvasWebComponentHandle, 'c-omni-designer-canvas-body');
    if (!designerCanvasHandle) throw new Error('c-omni-designer-canvas-body element not found');

    const designerCanvasBodyHandle = await getShadowElement(designerCanvasHandle, 'c-omni-designer-preview');
    if (!designerCanvasBodyHandle) throw new Error('c-omni-designer-preview element not found');

    const iframeHandle = await getShadowElement(designerCanvasBodyHandle, 'iframe');
    if (!iframeHandle) throw new Error('iframe element not found');

    const contentFrame = await iframeHandle.contentFrame();
    const errorElement = await contentFrame.$('.slds-text-color_error');
    return !errorElement;
};
