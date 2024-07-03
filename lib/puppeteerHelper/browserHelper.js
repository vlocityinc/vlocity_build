exports.goToUniquePage = async (page, siteUrl, packageNamespace, omniScriptId) => {
    const omniScriptDesignerPageLink = `${siteUrl}/lightning/cmp/${packageNamespace}OmniDesignerAuraWrapper?c__recordId=${omniScriptId}`;
    await page.goto(omniScriptDesignerPageLink, { timeout: 900000, waitUntil: 'networkidle2' });
};

exports.clickPreviewButton = async (page) => {
    await page.mouse.click(1127, 134+32);
};
function cleanString(str) {
    // Remove special characters
    let cleanedStr = str.replace(/[^a-zA-Z0-9 ]/g, '');
    // Trim spaces from start and end
    cleanedStr = cleanedStr.trim();
    // Replace multiple spaces with a single space
    cleanedStr = cleanedStr.replace(/\s+/g, ' ');
    return cleanedStr;
  }
  const checkForErrorsAndStepChart = async (page, element, packageNamespaceWithoutendspecialCharacter, omniScriptLogId) => {
    let foundError = false;
    let foundStepChart = false;
    let errorMessage = "";
    let tagnamee = "";

    const traverse = async (el) => {
        if (!el) {
            return;
        }

        const tagName = await el.evaluate(el => el.tagName.toLowerCase());
        tagnamee += tagName;

        if (tagName === `${packageNamespaceWithoutendspecialCharacter}-omniscript-step-chart`) {
            foundStepChart = true;
            return;
        }

        const checkErrorMessage = async (textContent) => {
            if (textContent?.toLowerCase()?.includes('either inactive or has been replaced')) {
                errorMessage += `Error Activated_Manually >> ${omniScriptLogId} message found: ${JSON.stringify(textContent)}`;
                foundError = true;
                await page.screenshot({ path: `${cleanString(omniScriptLogId)}.png` });
            }
        };

        if (tagName === 'p' || tagName === 'div') {
            const textContent = await el.evaluate(el => el.textContent);
            await checkErrorMessage(textContent);
        }

        if (tagName === 'iframe') {
            const frame = await el.contentFrame();
            if (frame) {
                const frameBody = await frame.$('body');
                if (frameBody) {
                    await traverse(frameBody);
                    await frameBody.dispose();
                }
            }
        }

        const hasShadowRoot = await el.evaluate(el => !!el.shadowRoot);
        if (hasShadowRoot) {
            const shadowRoot = await el.evaluateHandle(el => el.shadowRoot);
            const shadowChildren = await shadowRoot.evaluateHandle(root => Array.from(root.children));
            const shadowChildrenArray = await shadowChildren.jsonValue();

            for (let i = 0; i < shadowChildrenArray.length; i++) {
                const childHandle = await shadowRoot.evaluateHandle((root, index) => root.children[index], i);
                if (childHandle) {
                    await traverse(childHandle);
                    await childHandle.dispose();
                }
            }
            await shadowRoot.dispose();
        }

        const childrenHandle = await el.evaluateHandle(el => Array.from(el.children));
        const childrenArray = await childrenHandle.jsonValue();

        for (let i = 0; i < childrenArray.length; i++) {
            const childHandle = await el.evaluateHandle((el, index) => el.children[index], i);
            if (childHandle) {
                await traverse(childHandle);
                await childHandle.dispose();
            }
        }
        await childrenHandle.dispose();
    };

    await traverse(element);
    return foundStepChart ? [false, ""] : [foundError, errorMessage];
};



let count =0;
exports.clickDeactivate = async (page) => {
    let pageChanged = false;
    page.on('framenavigated', frame => {
        if (frame === page.mainFrame()) pageChanged = true;
    });
    await page.screenshot({ path: `${count++}.png` });
    await page.mouse.click(1358, 134+32);//deactivate
    await new Promise(res => setTimeout(res, 15000));
    await page.screenshot({ path: `${count++}.png` });
    await page.mouse.click(1042, 572+32);
    await new Promise(res => setTimeout(res, 25000));//proceed sould check
    await page.screenshot({ path: `${count++}.png` });
    if (!pageChanged) {
        await new Promise(res => setTimeout(res, 5000));
        await page.keyboard.down('Tab');
        await page.keyboard.up('Tab');
    }
    await page.keyboard.down('Tab');
    await page.keyboard.up('Tab');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter'); //proceed
    await page.screenshot({ path: `${count++}.png` });
    await new Promise(res => setTimeout(res, 8000));
    if (pageChanged) {
        await new Promise(res => setTimeout(res, 10000));
        await page.keyboard.down('Tab');
        await page.keyboard.up('Tab');
        await page.keyboard.down('Enter');
        await page.keyboard.up('Enter');
        await new Promise(res => setTimeout(res, 8000));
        await page.screenshot({ path: `${count++}.png` });
    }
};

exports.clickActivate = async (page) => {
    let pageChanged = false;
    page.on('framenavigated', frame => {
        if (frame === page.mainFrame()) pageChanged = true;
    });
    await page.screenshot({ path: `${count++}.png` });
    await page.mouse.click(1358, 134+32);
    await new Promise(res => setTimeout(res, 5000));
    await page.screenshot({ path: `${count++}.png` });
    await page.mouse.click(1042, 572+32);
    await new Promise(res => setTimeout(res, 25000));
    await page.screenshot({ path: `${count++}.png` });

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
    await page.screenshot({ path: `${count++}.png` });

    if (pageChanged) {
        await new Promise(res => setTimeout(res, 7000));
        await page.keyboard.down('Tab');
        await page.keyboard.up('Tab');
        await page.keyboard.down('Enter');
        await page.keyboard.up('Enter');
        await page.screenshot({ path: `${count++}.png` });
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
            return await checkForErrorsAndStepChart(page,bodyHandle,packageNamespaceWithoutendspecialCharacter,omniScriptLogId);
        } else {
        return [true,"$Preview might have not worked"];
        }
};
