exports.goToUniquePage = async (page, siteUrl, packageNamespace, omniScriptId) => {
    const omniScriptDesignerPageLink = `${siteUrl}/lightning/cmp/${packageNamespace}OmniDesignerAuraWrapper?c__recordId=${omniScriptId}`;
    await page.goto(omniScriptDesignerPageLink, { timeout: 900000, waitUntil: 'networkidle2' });
};

exports.clickPreviewButton = async (page, timeout) => {
    await page.mouse.click(1127, 134);
};
const traverseDOM = async (element) => {
    const tagName = await element.evaluate(el => el.tagName.toLowerCase());

    // If it's a <p> tag, check its text content
    if (tagName === 'p') {
        const textContent = await element.evaluate(el => el.textContent);
        if (textContent.toLowerCase().includes('error')) {
            console.log('Error message found:', textContent);
            return true;
        }
    }
    
    // If it's a <div> tag, check its text content
    if (tagName === 'div') {
        const textContent = await element.evaluate(el => el.textContent);
        if (textContent.toLowerCase().includes('error')) {
            console.log('Error message found:', textContent);
            return true;
        }
    }

    // Handle iframes using .contentFrame()
    if (tagName === 'iframe') {
        const frame = await element.contentFrame();
        if (frame) {
            const frameBody = await frame.$('body');
            if (frameBody && await traverseDOM(frameBody)) {
                await frameBody.dispose();
                return true;
            }
            await frameBody.dispose();
        }
    }

    // If the element has a shadow DOM, traverse it
    const hasShadowRoot = await element.evaluate(el => !!el.shadowRoot);
    if (hasShadowRoot) {
        const shadowRoot = await element.evaluateHandle(el => el.shadowRoot);
        const shadowChildren = await shadowRoot.evaluateHandle(root => Array.from(root.children));
        const shadowChildrenArray = await shadowChildren.jsonValue();

        for (let i = 0; i < shadowChildrenArray.length; i++) {
            const childHandle = await shadowRoot.evaluateHandle((root, index) => root.children[index], i);
            if (await traverseDOM(childHandle)) {
                await childHandle.dispose();
                await shadowRoot.dispose();
                return true;
            }
            await childHandle.dispose();
        }
        await shadowRoot.dispose();
    }

    // Traverse regular children
    const childrenHandle = await element.evaluateHandle(el => Array.from(el.children));
    const childrenArray = await childrenHandle.jsonValue();

    for (let i = 0; i < childrenArray.length; i++) {
        const childHandle = await element.evaluateHandle((el, index) => el.children[index], i);
        if (await traverseDOM(childHandle)) {
            await childHandle.dispose();
            await childrenHandle.dispose();
            return true;
        }
        await childHandle.dispose();
    }
    await childrenHandle.dispose();

    return false;
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
        await contentFrame.waitForSelector('body'); // Wait for the body to be present
        const bodyHandle = await contentFrame.$('body');
        if (bodyHandle) {
            return await traverseDOM(bodyHandle);
        } else {
        return true;
        }
};
