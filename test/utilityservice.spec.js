'use strict'

const _utilityservice = require('../lib/utilityservice');
const _vlocityutils = require('../lib/vlocityutils');
const path = require('path');

const expect = require('chai').expect;

describe('DataPacksExpand', async () => 
{
    var utilityservice = new _utilityservice();
  
    it('should not be null', () => { 
      expect(utilityservice).to.not.be.eq(null);
      expect(utilityservice).to.not.be.eq(null)
    }) 
    
    describe('gitCheckOutputFilesChanged', () => {
        it('should find correct changed files', () => {
  
            var gitChanges = `:100644 000000 f8d93f51a... 000000000... D	vlocity/Product2/SAME_KEY/OLDNAME_AttributeAssignments.json
:100644 000000 2f6fcc50e... 000000000... D	vlocity/Product2/SAME_KEY/OLDNAME_DataPack.json
:100644 000000 ee6dd108d... 000000000... D	vlocity/Product2/SAME_KEY/OLDNAME_ParentKeys.json
:100644 000000 5d6667dc5... 000000000... D	vlocity/Product2/SAME_KEY/OLDNAME_PriceListEntries.json
:100644 000000 848475b93... 000000000... D	vlocity/Product2/SAME_KEY/OLDNAME_PricebookEntries.json
:100644 000000 71b727341... 000000000... D	vlocity/Product2/SAME_KEY/OLDNAME_ProductChildItems.json
:100644 000000 f70e39c74... 000000000... D	vlocity/Product2/SAME_KEY/OLDNAME_ProductRelationships.json
:000000 100644 000000000... 3ee17815c... A	vlocity/Product2/SAME_KEY/NEWNAME_AttributeAssignments.json
:000000 100644 000000000... 91d9ea713... A	vlocity/Product2/SAME_KEY/NEWNAME_DataPack.json
:000000 100644 000000000... 18b229f63... A	vlocity/Product2/SAME_KEY/NEWNAME_ParentKeys.json
:000000 100644 000000000... e12a1e296... A	vlocity/Product2/SAME_KEY/NEWNAME_PriceListEntries.json
:000000 100644 000000000... 1a13f3ac2... A  vlocity/Product2/SAME_KEY/NEWNAME_PricebookEntries.json
:000000 100644 000000000... 71b727341... A	vlocity/Product2/SAME_KEY/NEWNAME_ProductChildItems.json
:000000 100644 000000000... f70e39c74... A	vlocity/Product2/SAME_KEY/NEWNAME_ProductRelationships.json
.../OLDNAME_AttributeAssignments.json            |  338 ------
.../crm_PRD_OLDNAME/OLDNAME_DataPack.json      |  123 ---
.../crm_PRD_OLDNAME/OLDNAME_ParentKeys.json    |    5 -
.../OLDNAME_PriceListEntries.json                |   43 -
.../OLDNAME_PricebookEntries.json                |   32 -
.../OLDNAME_ProductChildItems.json               |   31 -
.../OLDNAME_ProductRelationships.json            |   33 -
.../NEWNAME_AttributeAssignments.json  | 1094 ++++++++++++++++++++
.../NEWNAME_DataPack.json              |  130 +++
.../NEWNAME_ParentKeys.json            |    6 +
.../NEWNAME_PriceListEntries.json      |   86 ++
.../NEWNAME_PricebookEntries.json      |   32 +
.../NEWNAME_ProductChildItems.json     |   31 +
.../NEWNAME_ProductRelationships.json  |   33 +
14 files changed, 1412 insertions(+), 605 deletions(-)`;

            var allPotentialFiles = [];
            var deletedParentFiles = [];
            var addedParentFiles = [];

            utilityservice.getGitChangesFromCommand(gitChanges, allPotentialFiles, deletedParentFiles, addedParentFiles);

            // Will contains other files
            expect(allPotentialFiles).to.include('vlocity/Product2/SAME_KEY/OLDNAME_AttributeAssignments.json');
            expect(allPotentialFiles).to.include('vlocity/Product2/SAME_KEY/NEWNAME_PriceListEntries.json');

            // Contains Old
            expect(deletedParentFiles).to.include('vlocity/Product2/SAME_KEY/OLDNAME_DataPack.json');
          
            // Contains New
            expect(addedParentFiles).to.include('vlocity/Product2/SAME_KEY/NEWNAME_DataPack.json');
        });
    });

    describe('escapeSOQLString', () => {
        it('should escape single quotes to prevent SOQL injection', () => {
            expect(utilityservice.escapeSOQLString("O'Brien")).to.eq("O\\'Brien");
        });
        it('should escape backslashes so they cannot escape the escaping', () => {
            expect(utilityservice.escapeSOQLString("a\\b")).to.eq("a\\\\b");
        });
        it('should escape backslash before quote (no escape-the-escape bypass)', () => {
            expect(utilityservice.escapeSOQLString("a\\'b")).to.eq("a\\\\\\'b");
        });
        it('should leave ordinary values unchanged', () => {
            expect(utilityservice.escapeSOQLString('Claim')).to.eq('Claim');
        });
        it('should neutralize a quote-breakout injection payload', () => {
            expect(utilityservice.escapeSOQLString("x' OR Id != '")).to.eq("x\\' OR Id != \\'");
        });
        it('should pass null/undefined through unchanged', () => {
            expect(utilityservice.escapeSOQLString(null)).to.eq(null);
            expect(utilityservice.escapeSOQLString(undefined)).to.eq(undefined);
        });
    });

    describe('verifyFrontDoorSession', () => {
        function fakePage(url, hasLoginForm) {
            return {
                url: () => url,
                $: async (sel) => (hasLoginForm && (sel === '#username' || sel === '#password' || sel === '#Login')) ? {} : null
            };
        }

        it('returns true for an authenticated app URL', async () => {
            var jobInfo = { errors: [] };
            var ok = await utilityservice.verifyFrontDoorSession(fakePage('https://x.lightning.force.com/lightning/page/home', false), jobInfo);
            expect(ok).to.eq(true);
            expect(jobInfo.hasError).to.eq(undefined);
        });

        it('detects the ec=302 login bounce and sets the internal abort flag', async () => {
            var jobInfo = { errors: [] };
            var ok = await utilityservice.verifyFrontDoorSession(fakePage('https://x.my.salesforce.com/?ec=302&startURL=%2Fhome', false), jobInfo);
            expect(ok).to.eq(false);
            expect(jobInfo.hasError).to.eq(true);
            expect(jobInfo.lwcActivationBounced).to.eq(true);
            expect(jobInfo.ignoreLWCActivationOS).to.eq(undefined);
            expect(jobInfo.ignoreLWCActivationCards).to.eq(undefined);
            expect(jobInfo.errors.length).to.eq(1);
        });

        it('detects a login-page URL', async () => {
            var ok = await utilityservice.verifyFrontDoorSession(fakePage('https://login.salesforce.com/', false), { errors: [] });
            expect(ok).to.eq(false);
        });

        it('detects a login form via DOM fallback when the URL looks neutral', async () => {
            var ok = await utilityservice.verifyFrontDoorSession(fakePage('https://x.my.salesforce.com/somepage', true), { errors: [] });
            expect(ok).to.eq(false);
        });

        it('proceeds (returns true) without throwing if the page probe errors', async () => {
            var throwingPage = { url: () => 'https://x.my.salesforce.com/somepage', $: async () => { throw new Error('Execution context was destroyed'); } };
            var ok = await utilityservice.verifyFrontDoorSession(throwingPage, { errors: [] });
            expect(ok).to.eq(true);
        });

        it('detects an ec=302 bounce even with a trailing url fragment', async () => {
            var ok = await utilityservice.verifyFrontDoorSession(fakePage('https://x.my.salesforce.com/?ec=302#/setup/home', false), { errors: [] });
            expect(ok).to.eq(false);
        });

        it('detects a sandbox bounce to test.salesforce.com', async () => {
            var ok = await utilityservice.verifyFrontDoorSession(fakePage('https://test.salesforce.com/', false), { errors: [] });
            expect(ok).to.eq(false);
        });

        it('does not false-positive on a page with username/password but no login button', async () => {
            var changePwPage = { url: () => 'https://x.my.salesforce.com/setup/changepw', $: async (sel) => (sel === '#username' || sel === '#password') ? {} : null };
            var ok = await utilityservice.verifyFrontDoorSession(changePwPage, { errors: [] });
            expect(ok).to.eq(true);
        });

        it('does not false-positive when a login host appears only inside a query param', async () => {
            var ok = await utilityservice.verifyFrontDoorSession(fakePage('https://x.my.salesforce.com/apex/OmniLwcCompile?retURL=https://login.salesforce.com/home', false), { errors: [] });
            expect(ok).to.eq(true);
        });
    });

    describe('QueryService.buildWhereClauseValueByType', () => {
        const _queryservice = require('../lib/queryservice');
        var queryservice = new _queryservice({ utilityservice: utilityservice });
        it('should escape single quotes in the text (default) branch', () => {
            expect(queryservice.buildWhereClauseValueByType('Name', "x' OR Id != '", 'string'))
                .to.eq("Name = 'x\\' OR Id != \\''");
        });
    });

});
