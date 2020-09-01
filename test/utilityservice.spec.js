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

});
