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

    describe('datapack type handler lookup (path-traversal guard)', () => {
        var planted = path.join(os.tmpdir(), 'vbt_planted_handler');
        var marker = planted + '.marker';
        var traversalType;

        before(() => {
            fs.writeFileSync(planted + '.js', "require('fs').writeFileSync(" + JSON.stringify(marker) + ", 'x'); module.exports = function() {};");
            traversalType = path.relative(path.join(__dirname, '..', 'lib', 'datapacktypes'), planted);
        });

        beforeEach(() => {
            fs.removeSync(marker);
            Object.keys(require.cache).filter(k => k.toLowerCase().includes('vbt_planted_handler')).forEach(k => delete require.cache[k]);
        });

        after(() => {
            fs.removeSync(planted + '.js');
            fs.removeSync(marker);
        });

        it('resolves a known handler by bare name, case-insensitively', () => {
            expect(_datapacksutils.getDataPackTypeHandlerPath('OmniScript')).to.eq(path.join(__dirname, '..', 'lib', 'datapacktypes', 'omniscript.js'));
        });

        it('returns null for unknown, non-string and traversal types', () => {
            expect(_datapacksutils.getDataPackTypeHandlerPath('NoSuchType')).to.eq(null);
            expect(_datapacksutils.getDataPackTypeHandlerPath(undefined)).to.eq(null);
            expect(_datapacksutils.getDataPackTypeHandlerPath(traversalType)).to.eq(null);
            expect(_datapacksutils.getDataPackTypeHandlerPath('../datapacksutils')).to.eq(null);
        });

        it('handleDataPackEventSync does not load a file outside datapacktypes', () => {
            new _datapacksutils({tempFolder: '../vlocity-temp'}).handleDataPackEventSync('anyEvent', traversalType, {});
            expect(fs.existsSync(marker)).to.eq(false);
        });

        it('handleDataPackEvent does not load a file outside datapacktypes', async () => {
            await new _datapacksutils({tempFolder: '../vlocity-temp'}).handleDataPackEvent('anyEvent', traversalType, {});
            expect(fs.existsSync(marker)).to.eq(false);
        });

        it('handleStaticDataPackEvent does not load a file outside datapacktypes', async () => {
            await _datapacksutils.handleStaticDataPackEvent('anyEvent', traversalType, {});
            expect(fs.existsSync(marker)).to.eq(false);
        });
    });
})
