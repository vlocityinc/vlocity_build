'use strict'
var fs = require('fs-extra');
var path = require('path');

const _vlocity = require('../lib/vlocity');
const _vlocitycli = require('../lib/vlocitycli');
const _testframework = require('../lib/testframework');

const expect = require('chai').expect;
const assert = require('chai').assert;

describe('Test Framework', async () => {

    var self = this;

    /**
    var options = {
        username: "",
        password: ""
    };

    var vlocity = new _vlocity(options);
    var vlocitycli = new _vlocitycli();
    var testframework = new _testframework(vlocity);

    describe('VlocityCLI', async () => {
    
        it('Run Test Job', async () => { 
            var body = {"testKeys": ["TestFramework_Test"], "resultWithDetails": true};
            let result = await testframework.runJob(body, 'Start');
            expect(result).to.not.be.eq(null);
        });
    });

    describe('VlocityCLI', async () => {
    
        it('Run Get Test Procedure Job', async () => { 
            let result = await testframework.runJob({}, 'GetTestProcedures');
            expect(result).to.not.be.eq(null);
         });
    });
    */
});