'use strict'
var fs = require('fs-extra');
var path = require('path');

const expect = require('chai').expect;
const _datapackserrorhandling = require('../lib/datapackserrorhandling');
const _vlocity = require('../lib/vlocity');

describe('DataPacksErrorHandling', () => {
    var self = this;
    self.testData = {};

    var vlocity = new _vlocity();
    var datapackserrorhandling = new _datapackserrorhandling(vlocity);

    it('should not be null', () => {
        expect(_datapackserrorhandling).to.not.be.eq(null);
        expect(datapackserrorhandling).to.not.be.eq(null);
    })

    // ------ DEPLOY ERRORS ------  
    describe('handleMissingReference', () => {
        runTest('handleMissingReference');
    })

    describe('handleWereNotProcessed', () => {
        runTest('handleWereNotProcessed');
    })

    describe('handleIncorrectImportData', () => {
        runTest('handleIncorrectImportData');
    })
    
    // ------ EXPORT ERRORS ------
    describe('handleNotFound', () => {
        runTest('handleNotFound');
    })

    function runTest(testName) {
        it('should be a function', () => {
            expect(datapackserrorhandling[testName]).to.be.a('function');
        })

        var srcpath = path.join(__dirname, 'testDataPacksErrorHandlingData/' + testName + '/');
        var testData = loadFilesFromDir.call(self, srcpath, testName);
        testData = testData[testName];

        var jobInfo;
        var dataPackWithError;
        var assert; 

        for (var key in testData) {
            if (testData[key]) {
                if (testData[key]['jobInfo.json']) {
                    jobInfo = JSON.parse(testData[key]['jobInfo.json']);
                }

                if (testData[key]['dataPackWithError.json']) {
                    dataPackWithError = JSON.parse(testData[key]['dataPackWithError.json']);
                }
                
                if (testData[key]['assert.txt']) {
                    assert = testData[key]['assert.txt'];
                }

                equalsAssert(testName, dataPackWithError, jobInfo, assert);
            }
        }
    }

    describe('parseMissingReferenceErrorMessage', () => {
        it('should be a function', () => {
            expect(datapackserrorhandling.parseMissingReferenceErrorMessage).to.be.a('function');
        })
        it('should return a map', () => {
            var errorMessage = 'No match found for %vlocity_namespace%__ProductChildItem__c.%vlocity_namespace%__ChildProductId__c - %vlocity_namespace%__GlobalKey__c=2bf166dd-0a5b-4634-4bcb-ff73b5747935';
            var expectedErrorMessageMap = {searchPath: ['%vlocity_namespace%__ProductChildItem__c', '%vlocity_namespace%__ChildProductId__c'], 
                compareValues: [{'%vlocity_namespace%__GlobalKey__c':'2bf166dd-0a5b-4634-4bcb-ff73b5747935'}]};
            expect(datapackserrorhandling.parseMissingReferenceErrorMessage(errorMessage)).to.be.deep.equal(expectedErrorMessageMap);
        })
    })

    describe('getMatchingError', () => {
        it('should be a function', () => {
            expect(datapackserrorhandling.getMatchingError).to.be.a('function');
        })

        var errorMessage;

        it('should return an error message - MissingReference', () => {
            errorMessage = 'No match found for %vlocity_namespace%__ProductChildItem__c.%vlocity_namespace%__ChildProductId__c - %vlocity_namespace%__GlobalKey__c=2bf166dd-0a5b-4634-4bcb-ff73b5747935';
            expect(datapackserrorhandling.getMatchingError(errorMessage)).to.be.eq('MissingReference');
        })

        it('should return an error message - NotFound', () => {
            errorMessage = 'Not Found';
            expect(datapackserrorhandling.getMatchingError(errorMessage)).to.be.eq('NotFound');
        })

        it('should return an error message - SObjectUniqueness', () => {
            errorMessage = 'duplicate value found: <unknown> duplicates value on record with id: <unknown>';
            expect(datapackserrorhandling.getMatchingError(errorMessage)).to.be.eq('SObjectUniqueness');
        })

        it('should return an error message - WereNotProcessed', () => {
            errorMessage = 'Some records were not processed. Please validate imported data types. ["Pricebook2/B2B - All"]';
            expect(datapackserrorhandling.getMatchingError(errorMessage)).to.be.eq('WereNotProcessed');
        })

        it('should return an error message - IncorrectImportData', () => {
            errorMessage = 'Incorrect Import Data. Multiple Imported Records will incorrecty create the same Saleforce Record. %vlocity_namespace%__CatalogRelationship__c: Deals2';
            expect(datapackserrorhandling.getMatchingError(errorMessage)).to.be.eq('IncorrectImportData');
        })
    })

    function equalsAssert(functionName, dataPackWithError, jobInfo, assert) {
        it('should return an error message', () => {   
            expect(datapackserrorhandling[functionName].call(datapackserrorhandling, dataPackWithError, jobInfo)).to.be.eq(assert);
        })
    }
});

function getFiles(srcpath) {
    try {
        return fs.readdirSync(srcpath).filter(function(file) {
            return fs.statSync(path.join(srcpath, file)).isFile();
        });
    } catch(e) {
        return [];
    }
};

function loadFilesAtPath(srcpath, testName) {
    var self = this;

    if (!self.testData[testName]) {
        self.testData[testName] = {};
    }
    
    var dirName = srcpath.substr(srcpath.lastIndexOf('/')+1);

    if (!dirName.startsWith('.')) {
        self.testData[testName][dirName] = {};

        getFiles(srcpath).forEach(function(filename) {
            self.testData[testName][dirName][filename] = fs.readFileSync(path.join(srcpath, filename), 'utf8');
        });
    }

    return self.testData;
}

function loadFilesFromDir(srcpath, testName) {
    var self = this;

    var dirNames = fs.readdirSync(srcpath);

    for (var i = 0; i < dirNames.length; i++) {
        loadFilesAtPath.call(self, srcpath + dirNames[i], testName);
    }

    return self.testData;
}