exports.goToUniquePage = async (page, siteUrl, packageNamespace, omniScriptId) => {
    const omniScriptDesignerPageLink = `${siteUrl}/lightning/cmp/${packageNamespace}OmniDesignerAuraWrapper?c__recordId=${omniScriptId}`;
    await page.goto(omniScriptDesignerPageLink, { timeout: 900000, waitUntil: 'networkidle2' });
};

exports.clickPreviewButton = async (page, timeout) => {
    await page.mouse.click(1127, 134+32);
};
const traverseDOM = async (page,element, packageNamespaceWithoutendspecialCharacter,omniScriptLogId) => {
    let foundError = false;
    let foundStepChart = false;
    let errorMessage = ""
    let tagnamee= ""

    const traverse = async (el) => {
        const tagName = await el.evaluate(el => el.tagName.toLowerCase());
        tagnamee = tagnamee + tagName;
        if (tagName === `${packageNamespaceWithoutendspecialCharacter}-omniscript-step-chart`) {
            foundStepChart =true;
            return false;
        }
        function cleanString(str) {
            // Remove special characters
            let cleanedStr = str.replace(/[^a-zA-Z0-9 ]/g, '');
            // Trim spaces from start and end
            cleanedStr = cleanedStr.trim();
            // Replace multiple spaces with a single space
            cleanedStr = cleanedStr.replace(/\s+/g, ' ');
            return cleanedStr;
          }

        // If it's a <p> tag, check its text content
        if (tagName === 'p') {
            const textContent = await el.evaluate(el => el.textContent);
            if (textContent.toLowerCase().includes('error') && !textContent.toLowerCase().includes('required')) {
                errorMessage = errorMessage + `Error Activated_Manually >> ${omniScriptLogId} message found: ${JSON.stringify(textContent)}`
                foundError = true;
                // await page.screenshot({ path: `${cleanString(omniScriptLogId)}.png` });
            }
        }

        // If it's a <div> tag, check its text content
        if (tagName === 'div') {
            const textContent = await el.evaluate(el => el.textContent);
            if (textContent.toLowerCase().includes('error') && !textContent.toLowerCase().includes('required')) {
                errorMessage = errorMessage + `Error Activated_Manually >> ${omniScriptLogId} message found: ${JSON.stringify(textContent)}`
                foundError = true;
                // await page.screenshot({ path: `${cleanString(omniScriptLogId)}.png` });
            }
        }

        // Handle iframes using .contentFrame()
        if (tagName === 'iframe') {
            const frame = await el.contentFrame();
            if (frame) {
                const frameBody = await frame.$('body');
                if (frameBody && await traverse(frameBody) === false) {
                    await frameBody.dispose();
                    return false;
                }
                await frameBody.dispose();
            }
        }

        // If the element has a shadow DOM, traverse it
        const hasShadowRoot = await el.evaluate(el => !!el.shadowRoot);
        if (hasShadowRoot) {
            const shadowRoot = await el.evaluateHandle(el => el.shadowRoot);
            const shadowChildren = await shadowRoot.evaluateHandle(root => Array.from(root.children));
            const shadowChildrenArray = await shadowChildren.jsonValue();

            for (let i = 0; i < shadowChildrenArray.length; i++) {
                const childHandle = await shadowRoot.evaluateHandle((root, index) => root.children[index], i);
                if (await traverse(childHandle) === false) {
                    await childHandle.dispose();
                    await shadowRoot.dispose();
                    return false;
                }
                await childHandle.dispose();
            }
            await shadowRoot.dispose();
        }

        // Traverse regular children
        const childrenHandle = await el.evaluateHandle(el => Array.from(el.children));
        const childrenArray = await childrenHandle.jsonValue();

        for (let i = 0; i < childrenArray.length; i++) {
            const childHandle = await el.evaluateHandle((el, index) => el.children[index], i);
            if (await traverse(childHandle) === false) {
                await childHandle.dispose();
                await childrenHandle.dispose();
                return false;
            }
            await childHandle.dispose();
        }
        await childrenHandle.dispose();

        return true;
    };

    await traverse(element);
    return foundStepChart === true ? [false,""] : [foundError,errorMessage];
};


exports.clickDeactivate = async (page) => {
    let pageChanged = false;
    page.on('framenavigated', frame => {
        if (frame === page.mainFrame()) pageChanged = true;
    });

    await page.mouse.click(1358, 134+32);
    await new Promise(res => setTimeout(res, 15000));
    await page.mouse.click(1042, 572+32);
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

    await page.mouse.click(1358, 134+32);
    await new Promise(res => setTimeout(res, 5000));
    await page.mouse.click(1042, 572+32);
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
    await page.mouse.click(1054, 670+32);

    if (pageChanged) {
        await new Promise(res => setTimeout(res, 7000));
        await page.keyboard.down('Tab');
        await page.keyboard.up('Tab');
        await page.keyboard.down('Enter');
        await page.keyboard.up('Enter');
    }
};


exports.verifyOmniscriptActivation = async (page,packageNamespace,omniScriptLogId) => {
    const getShadowElement = async (element, selector) => {
        return await element.evaluateHandle((el, sel) => el.shadowRoot.querySelector(sel), selector);
    };
    let packageNamespaceWithoutendspecialCharacter = packageNamespace?.split('__')
    const canvasWebComponentHandle = await page.$(`${packageNamespaceWithoutendspecialCharacter[0]}-omni-designer-canvas`);
    if (!canvasWebComponentHandle) throw new Error(`${packageNamespaceWithoutendspecialCharacter[0]}-omni-designer-canvas element not found`);

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
            return await traverseDOM(page,bodyHandle,packageNamespaceWithoutendspecialCharacter,omniScriptLogId);
        } else {
        return [true,"$Preview might have not worked"];
        }
};
