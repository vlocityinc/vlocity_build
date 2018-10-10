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

    self.testJobInfo = {
        jobInfo : jobInfo,
        PricebookEntries : {},
        tests : {}
    };

    self.config = self.loadConfig();
    self.vlocityMatchingKeys = await self.vlocity.utilityservice.getAllDRMatchingKeys();
    var allTests = self.loadAllTests(jobInfo);
    var runTestData = await self.groupRunTestData(jobInfo, currentContextData, allTests);
    var promisesArray = [];

    for (var testUniqueKey in runTestData) {
        if (runTestData[testUniqueKey]) {
            runTestData[testUniqueKey].testUniqueKey = testUniqueKey;
            promisesArray.push(self.runTest(runTestData[testUniqueKey]));
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
                
                runTestData[guid] = {
                    actions : JSON.parse(JSON.stringify(yaml.safeLoad(tests[key]))),
                    dataPack : dataPack,
                    testName : key
                };

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

        var globalKeys = this.getDataPacksGlobalKeys([runTestData.dataPack]);
        
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
    
    return this.filterTestsByType(defaultTests, jobInfo);
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
        self.testJobInfo.tests[testUniqueKey] = {
            cleanDataMap : {},
            dataJson : {},
            timeTrackingArray : [],
            dataPackUniqueKey : dataPackUniqueKey, 
            dataPack : testDataToRunAgainst.dataPack,
            testName : testDataToRunAgainst.testName
        };

        for (var y = 0; y < actions.length; y++) {
            var obj = actions[y];
            obj.dataPackUniqueKey = dataPackUniqueKey;
            obj.testUniqueKey = testUniqueKey;
            obj.dataPack = testDataToRunAgainst.dataPack;
            
            self.testJobInfo.tests[testUniqueKey].assertPassed = true;
            self.testJobInfo.tests[testUniqueKey].assertMessage = '';

            if (obj && obj.Action) {
                var result;
                var action = obj.Action;

                if (self.vlocity.validationtest[action]) {
                    VlocityUtils.success('Run ', action);

                    self.startTimer(obj);
                    result = await self.vlocity.validationtest[action](obj);
                    self.endTimer(obj);

                    if (self.doAssert(obj)) {
                        self.assert(obj, result);
                        
                        if (!self.testJobInfo.tests[obj.testUniqueKey].assertPassed) {
                            self.cleanDataAll(obj);
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
    return this.testJobInfo.tests[obj.testUniqueKey].dataPack;
};

ValidationTest.prototype.finalReport = function() {
    VlocityUtils.success('Unit Test completed.');
    VlocityUtils.verbose('Summary: \n', yaml.dump(this.createFileData()));
    
    var result = this.createFileData(true);

    if (this.vlocity.utilityservice.isEmptyObject(result)) {
        result = 'No failures';
    }

    VlocityUtils.success('Summary: \n', yaml.dump(result));
};

ValidationTest.prototype.createFileData = function(failuresOnly) {
    var timeTrackingMap = {};
    var failuresOnly = failuresOnly ? true : false;

    for (var testUniqueKey in this.testJobInfo.tests) {
        var dataPackKey = this.testJobInfo.tests[testUniqueKey].dataPack.VlocityRecordSourceKey;
        var testName = this.testJobInfo.tests[testUniqueKey].testName;
        var timeTrackingArr = this.testJobInfo.tests[testUniqueKey].timeTrackingArray;

        if (failuresOnly) {
            timeTrackingArr = [];

            var trackingArrSize = this.testJobInfo.tests[testUniqueKey].timeTrackingArray.length;

            if (this.testJobInfo.tests[testUniqueKey].timeTrackingArray[trackingArrSize-1]
                && this.testJobInfo.tests[testUniqueKey].timeTrackingArray[trackingArrSize-1].Result === false) {
                    timeTrackingArr = this.testJobInfo.tests[testUniqueKey].timeTrackingArray;
            }
        }

        if (timeTrackingArr && timeTrackingArr.length > 0) {
            if (!timeTrackingMap[dataPackKey]) {
                timeTrackingMap[dataPackKey] = {};
            }
    
            timeTrackingMap[dataPackKey][testName] = timeTrackingArr;
        }
    }

    return timeTrackingMap;
};

ValidationTest.prototype.saveResults = function() {
    var timeTrackingMap = this.createFileData();
    var timeTrackingMapFailures = this.createFileData(true);
    
    if (timeTrackingMap && !this.vlocity.utilityservice.isEmptyObject(timeTrackingMap)) {
        fs.outputFileSync(path.join('vlocity-temp', 'timeTracking', this.testJobInfo.jobInfo.logName), yaml.dump(timeTrackingMap), 'utf8');
    }
    
    if (timeTrackingMapFailures && !this.vlocity.utilityservice.isEmptyObject(timeTrackingMapFailures)) {
        fs.outputFileSync(path.join('vlocity-temp', 'timeTrackingFailures', this.testJobInfo.jobInfo.logName), yaml.dump(timeTrackingMapFailures), 'utf8');
    }
};

ValidationTest.prototype.startTimer = function(action) {
    if (action && action.TimeTrack) {
        this.testJobInfo.tests[action.testUniqueKey]['startTime' + action.Action] = new Date();
    }
};

ValidationTest.prototype.endTimer = function(action) {
    var startTime = this.testJobInfo.tests[action.testUniqueKey]['startTime' + action.Action];

    if (startTime) {
        var endTime = new Date() - startTime;
        var trackingMap = {};
        trackingMap['Action Name'] = action.Action;
        trackingMap['Elapsed Time'] = endTime;

        this.testJobInfo.tests[action.testUniqueKey].timeTrackingArray.push(trackingMap);
        this.testJobInfo.tests[action.testUniqueKey]['startTime' + action.Action] = '';
        this.vlocity.validationtest.saveResults();
    }
};

ValidationTest.prototype.createCart = async function(action) {
    action.SObject = action.Type;
    var result = await this.createSObject(action);
    this.testJobInfo.tests[action.testUniqueKey].dataJson['createCart'] = result;
    return result;
};

ValidationTest.prototype.createSObject = async function(action) {
    var sObjectType = action.SObject;
    
    var sObject = await this.buildSObject(action);
    var result = await this.vlocity.utilityservice.createSObject(sObjectType, sObject);
    var sObjectRetrieved = await this.retrieveSObject(sObjectType, result.id);
    this.addToCleanUpMap(action, sObjectType, sObjectRetrieved);
    this.testJobInfo.tests[action.testUniqueKey].dataJson['createSObject' + sObjectType] = sObjectRetrieved;
    return sObjectRetrieved;
};

ValidationTest.prototype.getCartItems = async function(action) {
    var self = this;
    var dataJson = self.testJobInfo.tests[action.testUniqueKey].dataJson;
    var cartId = dataJson.createCart.Id;

    var result = await new Promise(function(resolve, reject) {
        self.vlocity.jsForceConnection.apex.get(self.buildBaseURL() + "/carts/" + cartId + "/items", function(err, result) {
            if (err || !result) {
                VlocityUtils.error('Get cart items failed.', err.message);
            }

            resolve(result);
        });
    });

    self.testJobInfo.tests[action.testUniqueKey].dataJson['getCartItems'] = result;
    return result;
};

ValidationTest.prototype.getCartsProducts = async function(action) {
    var self = this;
    var dataJson = self.testJobInfo.tests[action.testUniqueKey].dataJson;
    var cartId = dataJson.createCart.Id;

    var result = await new Promise(function(resolve, reject) {
        self.vlocity.jsForceConnection.apex.get(self.buildBaseURL() + "/carts/" + cartId + "/products", function(err, result) {
            if (err || !result) {
                VlocityUtils.error('Get cart products failed.', err.message);
            }

            resolve(result);
        });
    });

    self.testJobInfo.tests[action.testUniqueKey].dataJson['getCartsProducts'] = result;
    return result;
};

ValidationTest.prototype.deleteCartItems = async function(action) {
    var self = this;
    var dataJson = self.testJobInfo.tests[action.testUniqueKey].dataJson;
    var deleteCartItems = '';
    var cartId = dataJson.createCart.Id;
    var cartItems = dataJson.getCartItems.records;

    for (var i = 0; i < cartItems.length; i++) {
        deleteCartItems = deleteCartItems + cartItems[i].Id.value;

        if (i < cartItems.length-1) {
            deleteCartItems = deleteCartItems + ',';
        }
    }

    return await new Promise(function(resolve, reject) {
        self.vlocity.jsForceConnection.apex.del(self.buildBaseURL() + "/carts/" + cartId + "/items?id=" + deleteCartItems, function(err, result) {
            resolve(result);
        });
    });
};

ValidationTest.prototype.addProduct = async function(action) {
    var self = this;
    var dataJson = self.testJobInfo.tests[action.testUniqueKey].dataJson;
    var cartId = dataJson.createCart.Id;
    var productGlobalKey = action.dataPackUniqueKey;
    var pricebookId = dataJson.createCart.Pricebook2Id;
    var pricebookEntryId;

    if (!self.testJobInfo.PricebookEntries[pricebookId]) {
        self.testJobInfo.PricebookEntries[pricebookId] = {};
    }

    pricebookEntryId = self.testJobInfo.PricebookEntries[pricebookId][productGlobalKey];

    if (!pricebookEntryId) {
        var queryString = self.vlocity.queryservice.buildSOQL('Id', 'PricebookEntry', "Product2Id IN (SELECT Id FROM Product2 WHERE %vlocity_namespace%__GlobalKey__c = '" + productGlobalKey + "') AND Pricebook2Id = '" + pricebookId + "' LIMIT 1");
        var result = await self.vlocity.queryservice.query(queryString);
               
        if (!result || !result.records || result.records.length < 0) {
            VlocityUtils.error('Not found: ', result);  
        } else {
            pricebookEntryId = result.records[0].Id;
            self.testJobInfo.PricebookEntries[pricebookId][productGlobalKey] = pricebookEntryId;
        }
    }

    var body = {items: [{itemId:pricebookEntryId}]};    

    var result = await new Promise(function(resolve, reject) {
        self.vlocity.jsForceConnection.apex.post(self.buildBaseURL() + "/carts/" + cartId + "/items", body, function(err, result) {
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

    self.testJobInfo.tests[action.testUniqueKey].dataJson['addProduct'] = result;
    return result;
};

ValidationTest.prototype.addToCleanUpMap = function(action, name, result) {
    var value = new Array();

    if (result && result.id) {
        if (this.testJobInfo.tests[action.testUniqueKey].cleanDataMap.hasOwnProperty(name)) {
            value = this.testJobInfo.tests[action.testUniqueKey].cleanDataMap[name];
            value.push(result.id);
        } else {
            value.push(result.id);
        }

        this.testJobInfo.tests[action.testUniqueKey].cleanDataMap[name] = value;
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
    for (var key in this.testJobInfo.tests[action.testUniqueKey].cleanDataMap) {
        await this.destroySObject(key, this.testJobInfo.tests[action.testUniqueKey].cleanDataMap[key]);
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

ValidationTest.prototype.getPricelist = async function() {
    var queryString = this.vlocity.queryservice.buildSOQL('Id,%vlocity_namespace%__Code__c', '%vlocity_namespace%__PriceList__c', "%vlocity_namespace%__Code__c = '" + this.testJobInfo.DefaultPriceList + "'");
    var result = await this.vlocity.queryservice.query(queryString);
    var value;
        
    if (!result || result.records.length === 0) {
        VlocityUtils.error('Price List not found: ' + this.testJobInfo.DefaultPriceList);
    } else {
        value = result.records[0].Id;
    }

    return value;
};

ValidationTest.prototype.parseFunctionVal = async function(value, dataJson, action) {
    if (!this.testJobInfo.tests[action.testUniqueKey].hashValues) {
        this.testJobInfo.tests[action.testUniqueKey].hashValues = {};
    }

    if (this.testJobInfo.tests[action.testUniqueKey].hashValues[value]) {
        return this.testJobInfo.tests[action.testUniqueKey].hashValues[value];
    }

    if (value == 'TODAY()') {
        valueRes = new Date();
    } else if (value == 'ACCOUNT()') {
        valueRes = dataJson.createSObjectAccount.Id
    } else if (value == 'PRICELIST()') {
        valueRes = await this.getPricelist();
    } else {
        return value;
    }

    this.testJobInfo.tests[action.testUniqueKey].hashValues[value] = valueRes;
    return valueRes;
};

ValidationTest.prototype.buildSObject = async function(action) {
    var dataJson = this.testJobInfo.tests[action.testUniqueKey].dataJson;
    var sObjectType = action.SObject;
    var sObjectConfig = JSON.parse(JSON.stringify(this.config[sObjectType]));
    
    for (key in sObjectConfig) {
        var value = action[key];
        
        if (!value) {
            value = sObjectConfig[key];
        }

        sObjectConfig[key] = await this.parseFunctionVal(value, dataJson, action);
    }

    return sObjectConfig;
};

// ----- ASSERTS -----
ValidationTest.prototype.doAssert = function(action) {
    return action && action.Assert;
};

ValidationTest.prototype.assert = async function(action, result) {
    if (action && result) {
        var assert = action.Assert;

        for (var key in assert) {
            if (this['assert' + key])   {
                this['assert' + key](action, result, assert);
            } else {
                this.assertEquals(action, result[key], assert[key], action.Action + ' ' + key);
            }
        }

        this.addAssertResult(action.testUniqueKey);
    }
};

ValidationTest.prototype.assertfields = async function(action, result, assert) {
    var key = 'fields';
    for (var field in assert[key]) {
        this.assertEquals(action, result[field], assert[key][field], action.Action + ' ' + field);    
    }
};

ValidationTest.prototype.asserttotalSize = async function(action, result, assert) {
    var key = 'totalSize';
    if (typeof(assert[key]) == 'string') {
        this.compare(action, result[key], assert[key], action.Action + ' ' + key);
    } else {
        this.assertEquals(action, result[key], assert[key], action.Action + ' ' + key);
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
            this.assertTrue(action, actualVal > num, message + ' actual value: ' + actualVal + ' is not > ' + num);
            break;
        case '<':
            this.assertTrue(action, actualVal < num, message + ' actual value: ' + actualVal + ' is not < ' + num);
            break;
        case '>=':
            this.assertTrue(action, actualVal >= num, message + ' actual value: ' + actualVal + ' is not "=> ' + num + '"');
            break;
        case '<=':
            this.assertTrue(action, num <= actualVal, message + ' actual value: ' + actualVal + ' is not "=< ' + num + '"');
            break;
    }
};

ValidationTest.prototype.assertmatchingKey = async function(action, dataPack, assert) {
    var matchingKeyField = this.vlocityMatchingKeys[dataPack.VlocityRecordSObjectType];
    var assertVal = assert['matchingKey'];
    if (this['assert' + assertVal]) {
        this['assert' + assertVal](action, dataPack, matchingKeyField);
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
        this.testJobInfo.tests[action.testUniqueKey].assertPassed = false;
        this.testJobInfo.tests[action.testUniqueKey].assertMessage = message;
        VlocityUtils.error('Assert failed: ' + message);
    }
}

ValidationTest.prototype.assertEquals = function(action, actual, expected, message) {
    if (actual !== expected) {
        this.testJobInfo.tests[action.testUniqueKey].assertPassed = false;
        this.testJobInfo.tests[action.testUniqueKey].assertMessage = 'Assert failed: ' + message + ' Actual result: ' + actual + ' Expected result: ' + expected;
        VlocityUtils.error('Assert failed: ' + message, 'Actual result: ' + actual, 'Expected result: ' + expected);
    }
}

ValidationTest.prototype.addAssertResult = function(testUniqueKey) {
    var timeTrackingArray = this.testJobInfo.tests[testUniqueKey].timeTrackingArray;

    if (timeTrackingArray && timeTrackingArray.length > 0) {
        var trackingMap = timeTrackingArray[timeTrackingArray.length-1];
        trackingMap['Result'] = this.testJobInfo.tests[testUniqueKey].assertPassed;

        if (!this.testJobInfo.tests[testUniqueKey].assertPassed) {
            trackingMap['Result Message'] = this.testJobInfo.tests[testUniqueKey].assertMessage;
        }

        this.testJobInfo.tests[testUniqueKey].timeTrackingArray[timeTrackingArray.length-1] = JSON.parse(JSON.stringify(trackingMap));
        this.saveResults();
    }

    this.testJobInfo.tests[testUniqueKey].assertMessage = '';
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

ValidationTest.prototype.loadConfig = function() {
    var result = yaml.safeLoad(fs.readFileSync(path.join(__dirname, 'validationtestsettings.yaml'), 'utf8')); 
    result = this.vlocity.utilityservice.checkNamespacePrefix(result);
    return result;
};