var fs = require("fs-extra");
var path  = require('path');
var yaml = require('js-yaml');

const VLOCITY_NAMESPACE_PREFIX = '%vlocity_namespace%__';

var TestFramework = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};
};

TestFramework.prototype.runJob = async function(jobInfo, jobName) {
    await this.vlocity.checkLogin();

    this.jobInfo = jobInfo;
    let result;

    try {
        result = await this['execute' + jobName](jobInfo);
    } catch (e) {
        VlocityUtils.error('Run Job Error:jobName', jobName);
        VlocityUtils.verbose('Run Job Error:e', e);
        VlocityUtils.verbose('Run Job Error:result', result);

        this.jobInfo.hasError = true;

        if (!this.jobInfo.errors){
            this.jobInfo.errors = [];
        }

        this.jobInfo.errors.push(e);
    }

    return result;
};

TestFramework.prototype.executeStart = async function() {
    var startResult = await this.start(this.jobInfo);
    let result = await this.resultChunked(startResult, this.jobInfo.resultWithDetails);
    this.jobInfo.data = result;
    return result;
}

TestFramework.prototype.executeStartAll = async function() {
    var startAllResult = await this.startAll(this.jobInfo);
    let result = await this.resultChunked(startAllResult, this.jobInfo.resultWithDetails);
    this.jobInfo.data = result;
    return result;
}

TestFramework.prototype.start = async function(input) {
    if (!input
        || !input.testKeys
        || !(input.testKeys instanceof Array))
    {
        VlocityUtils.error('Start Error', input);
        return null;
    }

    let request = {'testKeys' : input.testKeys};
    VlocityUtils.verbose('Start Request', request);

    let result =  await this.vlocity.jsForceConnection.apex.post('/' + this.vlocity.namespace + '/v1/testprocedure/start', request);
    return this.toJson(result);
};

TestFramework.prototype.startAll = async function() {
    let result = await this.vlocity.jsForceConnection.apex.post('/' + this.vlocity.namespace + '/v1/testprocedure/startAll');
    return this.toJson(result);
};

TestFramework.prototype.result = async function(input, resultWithDetails) {
    if (!input
        || !input.apexJobId
        || (!input.testSuiteUniqueKey || (!input.testKeys || !(input.testKeys instanceof Array))))
    {
        VlocityUtils.error('Result Chunked Error', input);
        return null;
    }

    let request = {
        'apexJobId' : input.apexJobId,
        'testKeys' : input.testKeys,
        'testSuiteUniqueKey' : input.testSuiteUniqueKey
    };

    VlocityUtils.verbose('Result Request', request);

    let finalResult = {};
    let withDetails = resultWithDetails == true;
    let endpoint;

    if (withDetails) {
        endpoint = '/' + this.vlocity.namespace + '/v1/testprocedure/resultWithDetails';
    } else {
        endpoint = '/' + this.vlocity.namespace + '/v1/testprocedure/result';
    }

    do {
        let postRequestResult = await this.vlocity.datapacks.makeApexPostRequest(endpoint, request);
        finalResult = this.toJson(postRequestResult);

        if (finalResult 
            && finalResult.Status === 'InProgress')
        {
            VlocityUtils.verbose('Work In Progress');
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    } while (finalResult
        && finalResult.Status === 'InProgress')

    return finalResult;
};

TestFramework.prototype.resultChunked = async function(input, resultWithDetails) {
    if (!input
        || !input.apexJobId
        || !input.testSuiteUniqueKey 
        || !input.testKeys 
        || !(input.testKeys instanceof Array))
    {
        VlocityUtils.error('Result Chunked Error', input);
        return null;
    }

    let withDetails = resultWithDetails == true;
    var chunkPromises = [];

    if (input.testKeys.length < 50) {
        chunkPromises.push(this.result(input, true)); // withDetails
    }
    else
    {
        let testKeys = [];

        for (var i = 0; i < input.testKeys.length; i++) {
            let testKey = input.testKeys[i];
            testKeys.push(testKey);
    
            if (testKeys.length == 50
                || (i == input.testKeys.length-1 && testKeys.length <= 50)) {
                
                let request = {
                    'apexJobId' : input.apexJobId,
                    'testKeys' : testKeys,
                    'testSuiteUniqueKey' : input.testSuiteUniqueKey
                };

                chunkPromises.push(this.result(request, true));
                testKeys = [];
            }
        }
    }

    var promiseResults = await Promise.all(chunkPromises);

    let response = {};

    if (promiseResults)
    {
        let finalResult = {
            Failures : 0,
            Status : true,
            notRun : 0,
            success: 0,
            Total: 0,
            testResults: []
        };

        for (var result of promiseResults) {
            finalResult.Failures = finalResult.Failures + result.Failures;
            finalResult.notRun = finalResult.notRun + result.notRun;
            finalResult.Total = finalResult.Total + result.Total;
            finalResult.success = finalResult.success + result.success;

            if (!finalResult.Status && result.Status) {
                finalResult.Status = false;
            }

            finalResult.testResults.push(...result.testResults);
        }

        VlocityUtils.verbose('Final Result', finalResult);

        response = this.vlocity.utilityservice.setNamespaceToDefault(finalResult);
        
        this.createResponse(response, input.testSuiteUniqueKey);
        this.saveToDir(path.join(this.vlocity.tempFolder, 'runTestProcedureResult', input.testSuiteUniqueKey), response);
    }

    return response;
};

TestFramework.prototype.executeGetTestProcedures = async function(jobInfo) { 
    let result = await this.vlocity.jsForceConnection.apex.get('/' + this.vlocity.namespace + '/v1/testprocedure/alltests');

    result = this.toJson(result);
    result = this.vlocity.utilityservice.setNamespaceToDefault(result)
    jobInfo.data = result;
};

TestFramework.prototype.createResponse = function(response, testSuiteUniqueKey) {
    if (response
        && response.testResults
        && response.testResults instanceof Array) {

        if (!response.Status) {
            this.jobInfo.hasError = true;
            VlocityUtils.success('Test Result Total', response.Total);
            VlocityUtils.error('Test Result Failures', response.Failures);
            VlocityUtils.error('Test Result Not Run', response.notRun);
            VlocityUtils.success('Test Result Success', response.success);
            VlocityUtils.error('Test Result Status', 'Failed');
        }

        for (var testResult of response.testResults) {
            let uniqueKey = testResult.Name;
            let statusField = testResult[VLOCITY_NAMESPACE_PREFIX + 'Status__c'];
            let testName = testResult[VLOCITY_NAMESPACE_PREFIX + 'TestName__c'];

            if (statusField === 'Success') {
                this.jobInfo.currentStatus[uniqueKey] = 'Success';
            }
            else {
                this.jobInfo.currentStatus[uniqueKey] = 'Error';

                if (statusField === 'Invalid Test Name') {
                    this.jobInfo.errors.push(`Invalid Test Name >> ${testName} - TestUniqueKey__c >> ${uniqueKey} - TestSuiteUniqueKey__c >> ${testSuiteUniqueKey}`);
                }
            }
        }
    }
};

TestFramework.prototype.toJson = function(request) {
    if (request && typeof request === 'string') { 
        try {
            return JSON.parse(request);
        } catch (e) {
            VlocityUtils.error('Error To Json', e);
        }
    }
    
    return null;
}

TestFramework.prototype.saveToDir = function(path, data) {
    if (path && data) {
        VlocityUtils.verbose('Save To Dir Path', path);

        try {
            fs.outputFileSync(path, yaml.dump(data), 'utf8');
            return true;
        } catch (e) {
            VlocityUtils.error('Save To Dir', e);
        }
    }

    return false;
}