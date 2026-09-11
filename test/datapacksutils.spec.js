'use strict'

require('../lib/vlocityutils'); // defines the global VlocityUtils used by saveCurrentJobInfo
const _datapacksutils = require('../lib/datapacksutils');
const expect = require('chai').expect;
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

describe('DataPacksUtils', () => 
{
    var datapacksutils = new _datapacksutils({tempFolder: '../vlocity-temp'});
    
    it('should not be null', () => { 
        expect(_datapacksutils).to.not.be.eq(null);
        expect(datapacksutils).to.not.be.eq(null)
    }) 
    
    describe('guid', () => {
        it('should be a function', () => {
            expect(datapacksutils.guid).to.be.a('function')
        })

        var generatedGuids = {};

        for (var i = 0; i < 1000000; i++) {
            var newGuid = datapacksutils.guid();

            expect(generatedGuids[newGuid]).to.be.eq(undefined);

            generatedGuids[newGuid] = newGuid;
        }
    });

    describe('saveCurrentJobInfo', () => {
        // W-24123573: a live Salesforce sessionId must not be persisted to currentJobInfo.json / .bak.
        it('does not persist sessionId to disk but keeps it in memory', async () => {
            const tempFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'vbt-wi-'));
            const infoFile = path.join(tempFolder, 'currentJobInfo.json');
            const utils = new _datapacksutils({ tempFolder });

            const SECRET = 'FAKE_SESSION_ID_do_not_persist';
            const jobInfo = { jobAction: 'Deploy', sessionId: SECRET, instanceUrl: 'https://example.my.salesforce.com' };

            await utils.saveCurrentJobInfo(jobInfo, true);

            const written = fs.readFileSync(infoFile, 'utf8');
            const bak = fs.readFileSync(infoFile + '.bak', 'utf8');

            expect(written).to.not.contain('sessionId');
            expect(written).to.not.contain(SECRET);
            expect(bak).to.not.contain(SECRET);
            expect(JSON.parse(written).instanceUrl).to.eq(jobInfo.instanceUrl); // non-secret data preserved
            expect(jobInfo.sessionId).to.eq(SECRET); // restored in memory so the running job still authenticates

            fs.removeSync(tempFolder);
        });
    });
})