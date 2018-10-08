var yaml = require('js-yaml');
var fs = require('fs-extra');
var path = require('path');
var mustache = require('mustache');

var ValidationTest = module.exports = function(vlocity, currentContextData, jobInfo) {
    this.vlocity = vlocity || {};
    this.testJobInfo = {};
};

ValidationTest.prototype.validate = async function(jobInfo, currentContextData) {
    var self = this;
    self.testJobInfo.jobInfo = jobInfo;
    self.vlocityMatchingKeys = await self.vlocity.utilityservice.getAllDRMatchingKeys();
    var allTests = self.vlocity.validationtest.loadAllTests(jobInfo);
    var runTestData = await self.vlocity.validationtest.groupRunTestData(jobInfo, currentContextData, allTests);
    var promisesArray = [];

    for (var testUniqueKey in runTestData) {
        if (runTestData[testUniqueKey]) {
            runTestData[testUniqueKey].testUniqueKey = testUniqueKey;
            promisesArray.push(self.vlocity.validationtest.runTest(runTestData[testUniqueKey]));
        }
    }

    const promises = await self.vlocity.utilityservice.parallelLimit(promisesArray, 20);
    await Promise.all(promises);
    self.vlocity.validationtest.finalReport();
};

ValidationTest.prototype.groupRunTestData = async function(jobInfo, currentContextData, allTests) {
    var self = this;
    var runTestData = {};

    for (var y = 0; y < currentContextData.length; y++) {
        var dataPackType = currentContextData[y].VlocityDataPackType;
        var dataPack = this.vlocity.utilityservice.getDataPackData(currentContextData[y]);

        if (dataPackType && dataPack) {
            var tests = {};
            
            if (allTests['All']) {
                tests = JSON.parse(JSON.stringify(allTests['All']));
            }

            if (allTests[dataPackType]) {
                if (!tests) {
                    tests = JSON.parse(JSON.stringify(allTests[dataPackType]));
                } else {
                    tests = self.vlocity.utilityservice.mergeMaps(tests, JSON.parse(JSON.stringify(allTests[dataPackType])));
                }
            }

            for (var key in tests) {
                var guid = this.vlocity.datapacksutils.guid();
                runTestData[guid] = {};
                runTestData[guid].actions = JSON.parse(JSON.stringify(yaml.safeLoad(tests[key])));
                runTestData[guid].dataPack = dataPack;
                runTestData[guid].testName = key;

                if (self['initializeTest' + dataPackType]) {
                    runTestData[guid] = self['initializeTest' + dataPackType](jobInfo, runTestData[guid]);
                }
            }
        }
    }

    return runTestData;
};

ValidationTest.prototype.initializeTestProduct2 = function(jobInfo, runTestData) {
    if (runTestData.dataPack && jobInfo) {
        if (!this.testJobInfo.DefaultPriceList) {
            this.testJobInfo.DefaultPriceList = jobInfo.DefaultPriceList;
        }

        var globalKeys = this.vlocity.validationtest.getDataPacksGlobalKeys([runTestData.dataPack]);
        
        if (globalKeys && globalKeys[0]) {
            runTestData.dataPackUniqueKey = globalKeys[0];
        }
    }

    return runTestData;
};

ValidationTest.prototype.loadAllTests = function(jobInfo) {  
    var tests;

    try {
        tests = JSON.parse(JSON.stringify(this.vlocity.datapacksutils.loadFilesFromDir(path.join(jobInfo.projectPath, '..', 'test', 'vlocitytests'), 'vlocitytests')));
    } catch(e)  {}

    var defaultTests = JSON.parse(JSON.stringify(this.vlocity.datapacksutils.loadFilesFromDir(path.join(__dirname, '..', 'test', 'validationtest'), 'validationtest')));

    if (tests) {
        for (var key in tests) {
            if (defaultTests[key]) {
                for (var fileName in tests[key]) {
                    if (defaultTests[key][fileName]) {
                        VlocityUtils.error('Change the name of the test in the folder', key, fileName);
                    }

                    defaultTests[key][fileName] = tests[key][fileName];
                }
            } else {
                defaultTests[key] = tests[key];
            }
        }
    }
    
    return this.vlocity.validationtest.filterTestsByType(defaultTests, jobInfo);
};

ValidationTest.prototype.filterTestsByType = function(allTests, jobInfo) {
    var tests = JSON.parse(JSON.stringify(allTests));
    var testsType = jobInfo.tests;

    var validateInOrg = false;
    var validateLocally = false;
    var testTypes = {};

    if (testsType) {
        for (var i = 0; i < testsType.length; i++) {
            if (testsType[i] === 'validateInOrg') {
                validateInOrg = true;
            } else if (testsType[i] === 'validateLocally') {
                validateLocally = true;
            } else if (testsType[i].includes('/')) {
                testTypes[testsType[i] + '.yaml'] = '';
            }
        }
    }

    for (var dataPackType in tests) {
        if (tests[dataPackType]) {
            for (var fileName in tests[dataPackType]) {
                var data = tests[dataPackType][fileName];
                var actions = yaml.safeLoad(data);
                var uniqueKey = dataPackType + '/' + fileName;

                if (uniqueKey && testTypes.hasOwnProperty(uniqueKey)) {
                    continue;
                } else if (actions && actions[0] && actions[0].Action) {
                    var firstAction = actions[0].Action;

                    if (!((firstAction === 'validateInOrg' && validateInOrg)
                        || (firstAction === 'validateLocally' && validateLocally))) {
                        delete tests[dataPackType][fileName];
                    }
                } else {
                    delete tests[dataPackType][fileName];
                }
            }
        }
    }

    return tests;
};

ValidationTest.prototype.runTest = async function(testDataToRunAgainst) {
    var self = this;
    var actions = testDataToRunAgainst.actions;
    var testUniqueKey = testDataToRunAgainst.testUniqueKey;
    var dataPackUniqueKey = testDataToRunAgainst.dataPackUniqueKey;

    if (!dataPackUniqueKey) {
        dataPackUniqueKey = testUniqueKey;
    }

    if (actions && testUniqueKey) {
        self.testJobInfo[testUniqueKey] = {};
        self.testJobInfo[testUniqueKey].cleanDataMap = {};
        self.testJobInfo[testUniqueKey].dataJson = {};
        self.testJobInfo[testUniqueKey].timeTrackingArray = [];
        self.testJobInfo[testUniqueKey].dataPackUniqueKey = dataPackUniqueKey;
        self.testJobInfo[testUniqueKey].dataPack = testDataToRunAgainst.dataPack;
        self.testJobInfo[testUniqueKey].testName = testDataToRunAgainst.testName;

        for (var y = 0; y < actions.length; y++) {
            var obj = actions[y];
            obj.dataPackUniqueKey = dataPackUniqueKey;
            obj.testUniqueKey = testUniqueKey;
            obj.dataPack = testDataToRunAgainst.dataPack;
            
            self.testJobInfo[testUniqueKey].assertPassed = true;
            self.testJobInfo[testUniqueKey].assertMessage = '';

            if (obj && obj.Action) {
                var result;
                var action = obj.Action;

                if (self.vlocity.validationtest[action]) {
                    VlocityUtils.success('Run ', action);

                    self.vlocity.validationtest.startTimer(obj);
                    result = await self.vlocity.validationtest[action](obj);

                    self.vlocity.validationtest.endTimer(obj);

                    if (self.vlocity.validationtest.doAssert(obj)) {
                        self.vlocity.validationtest.assert(obj, result);
                        
                        if (!self.testJobInfo[obj.testUniqueKey].assertPassed) {
                            self.vlocity.validationtest.cleanDataAll(obj);
                            break;
                        }
                    }
                }
            }
        }
    }
};

ValidationTest.prototype.query = async function(obj) {
   var queryString = mustache.render(obj.Query, obj.dataPack);
   queryString = this.vlocity.utilityservice.checkNamespacePrefix(queryString);
   return await this.vlocity.queryservice.query(queryString);
};

ValidationTest.prototype.validateDataPackFields = function(obj) {
    return this.testJobInfo[obj.testUniqueKey].dataPack;
};

ValidationTest.prototype.finalReport = function() {
    VlocityUtils.success('Unit Test completed.');
    
    VlocityUtils.verbose('Summary: \n', yaml.dump(this.vlocity.validationtest.createFileData()));
    
    var result = this.vlocity.validationtest.createFileData(true);

    if (this.vlocity.utilityservice.isEmptyObject(result)) {
        result = 'No failures';
    }

    VlocityUtils.success('Summary: \n', yaml.dump(result));
};

ValidationTest.prototype.createFileData = function(failuresOnly) {
    var timeTrackingMap = {};
    var failuresOnly = failuresOnly ? true : false;

    for (var key in this.testJobInfo) {
        if (this.testJobInfo[key].timeTrackingArray
            && this.testJobInfo[key].testName
            && this.testJobInfo[key].dataPack) {
                var dataPackKey = this.testJobInfo[key].dataPack.VlocityRecordSourceKey;
                var testName = this.testJobInfo[key].testName;

                if (!timeTrackingMap[dataPackKey]) {
                    timeTrackingMap[dataPackKey] = {};
                }

                timeTrackingMap[dataPackKey][testName] = this.testJobInfo[key].timeTrackingArray;

                if (failuresOnly) {
                    if (this.testJobInfo[key].timeTrackingArray[0]
                        && this.testJobInfo[key].timeTrackingArray[0].Result === false) {
                        timeTrackingMap[dataPackKey][testName] = this.testJobInfo[key].timeTrackingArray;
                    } else {
                        delete timeTrackingMap[dataPackKey][testName];
                        
                        if (this.vlocity.utilityservice.isEmptyObject(timeTrackingMap[dataPackKey])) {
                            delete timeTrackingMap[dataPackKey]
                        }
                    }
                }
        }
    }

    return timeTrackingMap;
};

ValidationTest.prototype.saveResults = function() {
    var timeTrackingMap = this.vlocity.validationtest.createFileData();
    var timeTrackingMapFailures = this.vlocity.validationtest.createFileData(true);
    
    if (timeTrackingMap && !this.vlocity.utilityservice.isEmptyObject(timeTrackingMap)) {
        fs.outputFileSync(path.join('vlocity-temp', 'timeTracking', this.testJobInfo.jobInfo.logName), yaml.dump(timeTrackingMap), 'utf8');
    }
    
    if (timeTrackingMapFailures && !this.vlocity.utilityservice.isEmptyObject(timeTrackingMapFailures)) {
        fs.outputFileSync(path.join('vlocity-temp', 'timeTrackingFailures', this.testJobInfo.jobInfo.logName), yaml.dump(timeTrackingMapFailures), 'utf8');
    }
};

ValidationTest.prototype.startTimer = function(action) {
    if (action && action.TimeTrack) {
        this.testJobInfo[action.testUniqueKey]['startTime' + action.Action] = new Date();
    }
};

ValidationTest.prototype.endTimer = function(action) {
    var startTime = this.testJobInfo[action.testUniqueKey]['startTime' + action.Action];
    if (startTime) {
        var endTime = new Date() - startTime;
        var trackingMap = {};
        trackingMap['Action Name'] = action.Action;
        trackingMap['Elapsed Time'] = endTime;

        this.testJobInfo[action.testUniqueKey].timeTrackingArray.push(trackingMap);
        this.testJobInfo[action.testUniqueKey]['startTime' + action.Action] = '';
        this.vlocity.validationtest.saveResults();
    }
};

ValidationTest.prototype.createOrder = async function(action) {
    var self = this;
    var originalAction = JSON.parse(JSON.stringify(action));
    var sObject = await self.vlocity.validationtest.buildSObject(action);

    var result = await new Promise(function(resolve, reject) {
        self.vlocity.jsForceConnection.sobject("Order").create(sObject, function(err, result) {
            if (err || !result.success) {
                VlocityUtils.error('Error creating Order', sObject, err.message);
            }
            resolve(result);
        });
    });

    self.vlocity.validationtest.addToCleanUpMap(originalAction, 'Order', result);
    self.testJobInfo[originalAction.testUniqueKey].dataJson['CreateOrder'] = result;
    return result;
};

ValidationTest.prototype.createAccount = async function(action) {
    var self = this;
    var originalAction = JSON.parse(JSON.stringify(action));

    if (!action) {
        var action = {};
        action.Action = 'CreateAccount';
    }

    var sObject = await self.vlocity.validationtest.buildSObject(action);

    var result = await new Promise(function(resolve, reject) {
        self.vlocity.jsForceConnection.sobject("Account").create(sObject, function(err, result) {
            if (err || !result.success) {
                VlocityUtils.error('Error creating Account', sObject, err.message);
            }
            resolve(result);
        });
    });

    self.vlocity.validationtest.addToCleanUpMap(originalAction, 'Account', result);
    self.testJobInfo[originalAction.testUniqueKey].dataJson['CreateAccount'] = result;
    return result;
};

ValidationTest.prototype.addProducts = async function(action) {
    var self = this;
    var originalAction = JSON.parse(JSON.stringify(action));
    var dataJson = self.testJobInfo[action.testUniqueKey].dataJson;
    var cartId;
    var pricebookEntryIds;
    var pricebookId;
    var productGlobalKeys = [];

    if (!action || !action.Products) {
        VlocityUtils.error('Products are missing: ', action);
    }

    productGlobalKeys = action.Products;

    if (dataJson.cart && dataJson.cart.cartId) {
        cartId = dataJson.cart.cartId;
    } else {
        cartId = dataJson.CreateOrder.id;
        dataJson.cart = {};
        dataJson.cart.cartId = cartId;
    }

    if (dataJson.cart.pricebookId) {
        pricebookId = dataJson.cart.pricebookId;
    } else {
        var sObject = await self.vlocity.validationtest.retrieveSObject("Order", cartId);
        
        if (sObject && sObject.Pricebook2Id) {
            dataJson.cart.pricebookId = sObject.Pricebook2Id;
            pricebookId = sObject.Pricebook2Id;
        }
    }

    if (dataJson[productGlobalKeys]) {
        pricebookEntryId = dataJson[productGlobalKeys].pricebookEntryId; 
    } else {
        var globalKeysQueryStr = '(';
        for (var i = 0; i < productGlobalKeys.length; i++) {
            globalKeysQueryStr = globalKeysQueryStr + '\'' + productGlobalKeys[i] + '\'';

            if (i < productGlobalKeys.length-1) {
                globalKeysQueryStr = globalKeysQueryStr + ',';
            }
        }

        globalKeysQueryStr = globalKeysQueryStr + ')';

        var queryString = self.vlocity.queryservice.buildSOQL('Id', 'PricebookEntry', "Product2Id IN (SELECT Id FROM Product2 WHERE %vlocity_namespace%__GlobalKey__c IN " + globalKeysQueryStr + ") AND Pricebook2Id = '" + pricebookId + "' LIMIT 50000");
        var result = await self.vlocity.queryservice.query(queryString);
            
        if (result && result.records) {
            pricebookEntryIds = result.records; 
        } else {
            VlocityUtils.error('Not found: ', result);
        }
    }

    var productItems = [];

    for (var i = 0; i < pricebookEntryIds.length; i++) {
        var item = {};
        item.itemId = pricebookEntryIds[i].Id;
        productItems.push(item);
    }

    var body = {items: productItems};

    var result = await new Promise(function(resolve, reject) {
        self.vlocity.jsForceConnection.apex.post(self.vlocity.validationtest.buildBaseURL() + "/carts/" + cartId + "/items", body, function(err, result) {
            if (err || !result) {
                VlocityUtils.error('Error add to cart', body, err.message);
            }
            
            if (result.messages) {
                if (result.messages[0].message
                && result.messages[0].message !== 'Successfully added.') {
                    VlocityUtils.error('Item not added to the cart', result.messages);
                }
            }

            resolve(result);
        });
    });

    self.testJobInfo[originalAction.testUniqueKey].dataJson['AddProducts'] = result;
    return result;
};

ValidationTest.prototype.getCartItems = async function(action) {
    var self = this;
    var originalAction = JSON.parse(JSON.stringify(action));
    var dataJson = self.testJobInfo[action.testUniqueKey].dataJson;
    var cartId;

    if (dataJson.cartId) { 
        cartId = dataJson.cartId;
    } else if (dataJson.CreateOrder) {
        cartId = dataJson.CreateOrder.id;
    } else {
        VlocityUtils.error('Cart id is missing: ', action);
    }

    var result = await new Promise(function(resolve, reject) {
        self.vlocity.jsForceConnection.apex.get(self.vlocity.validationtest.buildBaseURL() + "/carts/" + cartId + "/items", function(err, result) {
            if (err || !result) {
                VlocityUtils.error('Get cart items failed.', err.message);
            }

            resolve(result);
        });
    });

    self.testJobInfo[originalAction.testUniqueKey].dataJson['GetCartItems'] = result;
    return result;
};

ValidationTest.prototype.getCartsProducts = async function(action) {
    var self = this;
    var originalAction = JSON.parse(JSON.stringify(action));
    var cartId;
    var dataJson = self.testJobInfo[action.testUniqueKey].dataJson;
    var globalKey = action.dataPackUniqueKey;

    if (self.testJobInfo.cartId) {
        cartId = self.testJobInfo.cartId;
    } else if (dataJson.CreateOrder) {
        cartId = dataJson.CreateOrder.id;
    } else {
        var createOrderResult = await self.vlocity.validationtest.createOrder({
            Action:'CreateOrder', 
            globalKey: globalKey,
            testUniqueKey: action.testUniqueKey
        });

        cartId = createOrderResult.id;
    }

    var result = await new Promise(function(resolve, reject) {
        self.vlocity.jsForceConnection.apex.get(self.vlocity.validationtest.buildBaseURL() + "/carts/" + cartId + "/products", function(err, result) {
            if (err || !result) {
                VlocityUtils.error('Get cart products failed.', err.message);
            }

            resolve(result);
        });
    });

    self.testJobInfo[originalAction.testUniqueKey].dataJson['GetCartsProducts'] = result;
    return result;
};

ValidationTest.prototype.deleteCartItems = async function(action) {
    var self = this;
    var dataJson = self.testJobInfo[action.testUniqueKey].dataJson;
    var deleteCartItems = '';
    var cartId;
    var cartItems = [];

    if (dataJson.cartId) {
        cartId = dataJson.cartId;
    } else if (dataJson.CreateOrder) {
        cartId = dataJson.CreateOrder.id;
    }

    if (dataJson.GetCartItems 
        && dataJson.GetCartItems.records) {
        cartItems = dataJson.GetCartItems.records;
    }

    for (var i = 0; i < cartItems.length; i++) {
        deleteCartItems = deleteCartItems + cartItems[i].Id.value;

        if (i < cartItems.length-1) {
            deleteCartItems = deleteCartItems + ',';
        }
    }

    return await new Promise(function(resolve, reject) {
        self.vlocity.jsForceConnection.apex.del(self.vlocity.validationtest.buildBaseURL() + "/carts/" + cartId + "/items?id=" + deleteCartItems, function(err, result) {
            resolve(result);
        });
    });
};

ValidationTest.prototype.addProduct = async function(action) {
    var self = this;
    var originalAction = JSON.parse(JSON.stringify(action));
    var cartId;
    var pricebookEntryId;
    var pricebookId;
    var productGlobalKey = action.dataPackUniqueKey;
    var dataJson = self.testJobInfo[action.testUniqueKey].dataJson;

    if (!action || !productGlobalKey) {
        VlocityUtils.error('Product is missing: ', action);
    }

    if (dataJson.cart && dataJson.cart.cartId) {
        cartId = dataJson.cart.cartId;
    } else {
        cartId = dataJson.CreateOrder.id;
        self.testJobInfo[action.testUniqueKey].dataJson.cart = {};
        self.testJobInfo[action.testUniqueKey].dataJson.cart.cartId = cartId;
    }

    if (dataJson.cart && dataJson.cart.pricebookId) {
        pricebookId = dataJson.cart.pricebookId;
    } else {
        var sObject = await self.vlocity.validationtest.retrieveSObject("Order", cartId);
           
        if (sObject && sObject.Pricebook2Id) {
            self.testJobInfo[action.testUniqueKey].dataJson.cart.pricebookId = sObject.Pricebook2Id;
            pricebookId = sObject.Pricebook2Id;
        }
    }

    if (dataJson.cart && dataJson.cart.pricebookEntryId) {
        pricebookEntryId = dataJson.cart.pricebookEntryId;
    } else {
        var queryString = self.vlocity.queryservice.buildSOQL('Id', 'PricebookEntry', "Product2Id IN (SELECT Id FROM Product2 WHERE %vlocity_namespace%__GlobalKey__c = '" + productGlobalKey + "') AND Pricebook2Id = '" + pricebookId + "' LIMIT 1");
        var result = await self.vlocity.queryservice.query(queryString);
               
        if (result && result.records && result.records.length > 0) {
            pricebookEntryId = result.records[0].Id;
            self.testJobInfo[action.testUniqueKey].dataJson.cart.pricebookEntryId = pricebookEntryId;
        } else {
            VlocityUtils.error('Not found: ', result);
        }
    }

    var body = {items: [{itemId:pricebookEntryId}]};    

    var result = await new Promise(function(resolve, reject) {
        self.vlocity.jsForceConnection.apex.post(self.vlocity.validationtest.buildBaseURL() + "/carts/" + cartId + "/items", body, function(err, result) {
            if (err || !result) {
                VlocityUtils.error('Error add to cart', body, err.message);
            }
                
            if (result.messages) {
                if (result.messages[0].message
                    && result.messages[0].message !== 'Successfully added.') {
                    VlocityUtils.error('Item not added to the cart', result.messages);
                }
            }

            resolve(result);
        });
    });

    self.testJobInfo[originalAction.testUniqueKey].dataJson['AddProduct'] = result;
    return result;
};

ValidationTest.prototype.addToCleanUpMap = function(action, name, result) {
    var value = new Array();

    if (result && result.id) {
        if (this.testJobInfo[action.testUniqueKey].cleanDataMap.hasOwnProperty(name)) {
            value = this.testJobInfo[action.testUniqueKey].cleanDataMap[name];
            value.push(result.id);
        } else {
            value.push(result.id);
        }

        this.testJobInfo[action.testUniqueKey].cleanDataMap[name] = value;
    }
};

ValidationTest.prototype.retrieveSObject = async function(name, id) {
    var self = this;
    return await new Promise(function(resolve, reject) {
        self.vlocity.jsForceConnection.sobject(name).retrieve(id, function(err, result) {
            if (err) {
                VlocityUtils.error('Can not retrieve sObject: ' + name, object, err.message);
            }

            resolve(result);
        });
    });
};

ValidationTest.prototype.cleanDataAll = async function(action) {
    for (var key in this.testJobInfo[action.testUniqueKey].cleanDataMap) {
        await this.vlocity.validationtest.destroySObject(key, this.testJobInfo[action.testUniqueKey].cleanDataMap[key]);
    }
};

ValidationTest.prototype.destroySObject = async function(sObjectName, ids) {
    var self = this;
    return await new Promise(function(resolve, reject) {
        self.vlocity.jsForceConnection.sobject(sObjectName).destroy(ids, function(err, result) {
            if (err && err.message !== 'entity is deleted') {
                VlocityUtils.error('Delete failed: ' + sObjectName, ids, err.message);
            }

            if (result) { 
                VlocityUtils.success('Successfully deleted.');
            }

            resolve(result);
        });
    });
};

ValidationTest.prototype.buildSObject = async function(action) {
    var self = this;
    var dataJson = self.testJobInfo[action.testUniqueKey].dataJson;
    var sObject = {};
    
    if (action && action.Action) {
        if (action.Action == 'CreateOrder') {
            if (dataJson.CreateAccount
                && dataJson.CreateAccount.id) {
                sObject.AccountId = dataJson.CreateAccount.id;
            } else {
                await self.vlocity.validationtest.createAccount({Action : 'CreateAccount', testUniqueKey : action.testUniqueKey, globalKey: action.globalKey});
                sObject.AccountId = dataJson.CreateAccount.id;
            }

            if (action.Name) {
                sObject.Name = action.Name;
            } else {
                sObject.Name = 'OrderName_BUILD_TOOL';
            }

            if (action.EffectiveDate) {
                sObject.EffectiveDate = action.EffectiveDate;
            } else {
                sObject.EffectiveDate = new Date();
            }
        
            if (action.AccountId) {
                sObject.AccountId = action.AccountId;
            }
        
            if (action.Status) {
                sObject.Status = action.Status;
            } else {
                sObject.Status = 'Draft';
            }

            if (!action.PriceList && this.testJobInfo.DefaultPriceList) {
                action.PriceList = this.testJobInfo.DefaultPriceList;
            }
        
            if (action.PriceList) {
                var queryString = self.vlocity.queryservice.buildSOQL('Id,%vlocity_namespace%__Code__c', '%vlocity_namespace%__PriceList__c', "%vlocity_namespace%__Code__c = '" + action.PriceList + "'");
                var result = await self.vlocity.queryservice.query(queryString);

                if (!result || result.records.length === 0) {
                    VlocityUtils.error('Price List not found: ' + action.PriceList);
                } else {
                    sObject[self.vlocity.namespacePrefix + 'PriceListId__c'] = result.records[0].Id;
                }
            }
        } else if (action.Action == 'CreateAccount') {
            if (action.Name) {
                sObject.Name = action.Name;
            } else {
                sObject.Name = 'AccName_BUILD_TOOL';
            }
        }
    }

    return sObject;
};

// ----- ASSERTS -----
ValidationTest.prototype.doAssert = function(action) {
    return action && action.Assert;
};

ValidationTest.prototype.assert = async function(action, result) {
    if (action && result) {
        var assert = action.Assert;

        for (var key in assert) {
            if (this.vlocity.validationtest['assert' + key])   {
                this.vlocity.validationtest['assert' + key](action, result, assert);
            } else {
                this.vlocity.validationtest.assertEquals(action, result[key], assert[key], action.Action + ' ' + key);
            }
        }

        this.vlocity.validationtest.addAssertResult(action.testUniqueKey);
    }
};

ValidationTest.prototype.assertfields = async function(action, result, assert) {
    var key = 'fields';
    for (var field in assert[key]) {
        this.vlocity.validationtest.assertEquals(action, result[field], assert[key][field], action.Action + ' ' + field);    
    }
};

ValidationTest.prototype.asserttotalSize = async function(action, result, assert) {
    var key = 'totalSize';
    if (typeof(assert[key]) == 'string') {
        this.vlocity.validationtest.compare(action, result[key], assert[key], action.Action + ' ' + key);
    } else {
        this.vlocity.validationtest.assertEquals(action, result[key], assert[key], action.Action + ' ' + key);
    }
};

ValidationTest.prototype.compare = function(action, actualVal, expectedVal, message) {
    var values = expectedVal.split(' ');

    var num;
    var compar;
    for (var i = 0; i < values.length; i++) {
        if (!isNaN(values[i])) {
            num = +values[i];
        } else {
            compar = values[i];
        }
    }

    switch(compar) {
        case '>': 
            this.vlocity.validationtest.assertTrue(action, actualVal > num, message + ' actual value: ' + actualVal + ' is not > ' + num);
            break;
        case '<':
            this.vlocity.validationtest.assertTrue(action, actualVal < num, message + ' actual value: ' + actualVal + ' is not < ' + num);
            break;
        case '>=':
            this.vlocity.validationtest.assertTrue(action, actualVal >= num, message + ' actual value: ' + actualVal + ' is not "=> ' + num + '"');
            break;
        case '<=':
            this.vlocity.validationtest.assertTrue(action, num <= actualVal, message + ' actual value: ' + actualVal + ' is not "=< ' + num + '"');
            break;
    }
};

ValidationTest.prototype.assertmatchingKey = async function(action, dataPack, assert) {
    var matchingKeyField = this.vlocityMatchingKeys[dataPack.VlocityRecordSObjectType];
    var assertVal = assert['matchingKey'];
    if (this.vlocity.validationtest['assert' + assertVal]) {
        this.vlocity.validationtest['assert' + assertVal](action, dataPack, matchingKeyField);
    }
};

ValidationTest.prototype.assertNotNull = async function(action, dataPack, matchingKeyField) {
    this.vlocity.validationtest.assertTrue(action, (dataPack[matchingKeyField] !== null && dataPack[matchingKeyField] !== ''), 'Value is null.');
};

ValidationTest.prototype.assertNoDuplicates = async function(action, dataPack, matchingKeyField) {
    this.vlocity.validationtest.checkMatchingKeysDuplicate(dataPack, matchingKeyField);
    this.testJobInfo.matchingKeysMap = {};
};

ValidationTest.prototype.findAllDataPacks = function(dataPack) {
    var dataPackCloned = JSON.parse(JSON.stringify(dataPack));

    for (key in dataPackCloned) {
        if (dataPackCloned[key]
            && dataPackCloned[key] instanceof Array
            && dataPackCloned[key][0]
            && dataPackCloned[key][0] instanceof Object) {
                var matchingKeyField = this.vlocityMatchingKeys[dataPackCloned[key][0].VlocityRecordSObjectType];
                this.vlocity.validationtest.checkMatchingKeysDuplicate(dataPackCloned[key][0], matchingKeyField);
        }
    }
};

ValidationTest.prototype.checkMatchingKeysDuplicate = function(dataPack, matchingKeyField) {
    var dataPackUniqueKey = '';
    
    if (!matchingKeyField) {
        VlocityUtils.error('Matching Key Field is missing for DataPack type: ', dataPack.VlocityRecordSObjectType);
    } else {
        if (matchingKeyField.includes(',')) {
            matchingKeyField = matchingKeyField.split(',');
    
            for (var i = 0; i < matchingKeyField.length; i++) {
                if (dataPack[matchingKeyField[i]] instanceof Object) {
                    if (dataPack[matchingKeyField[i]].VlocityMatchingRecordSourceKey) {
                        dataPackUniqueKey += dataPack[matchingKeyField[i]].VlocityMatchingRecordSourceKey;
                    } else if (dataPack[matchingKeyField[i]].VlocityLookupRecordSourceKey) {
                        dataPackUniqueKey += dataPack[matchingKeyField[i]].VlocityLookupRecordSourceKey;
                    }   
                } else {
                    dataPackUniqueKey += dataPack[matchingKeyField[i]] ? dataPack[matchingKeyField[i]] : null;
                }
            }
        } else {
            dataPackUniqueKey = dataPack.VlocityRecordSObjectType + dataPack[matchingKeyField];
        }
    
        if (!this.testJobInfo.matchingKeysMap) {
            this.testJobInfo.matchingKeysMap = {};
        }
        
        if (this.testJobInfo.matchingKeysMap[dataPackUniqueKey]) {
            this.vlocity.validationtest.assertTrue(action, false, 'Duplicate found.');
        }
    
        if (dataPackUniqueKey !== '') {
            this.testJobInfo.matchingKeysMap[dataPackUniqueKey] = '';
            this.vlocity.validationtest.findAllDataPacks(dataPack);
        }
    }
};

ValidationTest.prototype.assertTrue = function(action, actual, message) {
    if (!actual) {
        this.testJobInfo[action.testUniqueKey].assertPassed = false;
        this.testJobInfo[action.testUniqueKey].assertMessage = message;
        VlocityUtils.error('Assert failed: ' + message);
    }
}

ValidationTest.prototype.assertEquals = function(action, actual, expected, message) {
    if (actual !== expected) {
        this.testJobInfo[action.testUniqueKey].assertPassed = false;
        this.testJobInfo[action.testUniqueKey].assertMessage = 'Assert failed: ' + message + ' Actual result: ' + actual + ' Expected result: ' + expected;
        VlocityUtils.error('Assert failed: ' + message, 'Actual result: ' + actual, 'Expected result: ' + expected);
    }
}

ValidationTest.prototype.addAssertResult = function(testUniqueKey) {
    var timeTrackingArray = this.testJobInfo[testUniqueKey].timeTrackingArray;

    if (timeTrackingArray && timeTrackingArray.length > 0) {
        var trackingMap = timeTrackingArray[timeTrackingArray.length-1];
        trackingMap['Result'] = this.testJobInfo[testUniqueKey].assertPassed;

        if (!this.testJobInfo[testUniqueKey].assertPassed) {
            trackingMap['Result Message'] = this.testJobInfo[testUniqueKey].assertMessage;
        }

        this.testJobInfo[testUniqueKey].timeTrackingArray[timeTrackingArray.length-1] = trackingMap;
        this.vlocity.validationtest.saveResults();
    }

    this.testJobInfo[testUniqueKey].assertMessage = '';
};

ValidationTest.prototype.buildBaseURL = function() {
    return "/services/apexrest/" + this.vlocity.namespace + "/v2/cpq";
};

ValidationTest.prototype.getDataPacksGlobalKeys = function(dataPacks) {
    var globalKeys = [];

    if (dataPacks) {
        for (var i = 0; i < dataPacks.length; i++) {
            var dataPackData = dataPacks[i];
            if (dataPackData) {
                globalKeys.push(dataPackData['%vlocity_namespace%__GlobalKey__c']);
            }
        }
    }

    return globalKeys;
};

ValidationTest.prototype.loadFieldMappings = function() {
    return yaml.safeLoad(fs.readFileSync(path.join(__dirname, 'validationtestmappings.yaml'), 'utf8')); 
};