var async = require('async');

var VlocityUITemplate = module.exports = function(vlocity) {
	this.vlocity = vlocity;
};

VlocityUITemplate.prototype.onDeployFinish = async function(jobInfo) {
    if (!this.vlocity.sfdxUsername) {
        VlocityUtils.error('Deploy Error', 'Please run again using SFDX command');
    } else {
        queryPromises = [];

        var activeOmniScripts = await this.vlocity.queryservice.query(`SELECT Id FROM ${this.vlocity.namespace}__OmniScript__c WHERE ${this.vlocity.namespace}__IsActive__c = true`);
    
        for (var omniscript of activeOmniScripts.records) {
            queryPromises.push({context: this, argument: { omniscript : omniscript}, func: 'activateOmniScript'});
        }
    
        await this.vlocity.utilityservice.parallelLimit(queryPromises, 5);
    }
};

VlocityUITemplate.prototype.activateOmniScript = async function(inputMap) {
    var omniscript = inputMap.omniscript;
    await this.vlocity.datapacksutils.jsRemote(`${this.vlocity.namespace}.EmbeddingBusinessProcessController`, 'activateScript', [ omniscript.Id, 1], `${this.vlocity.namespace}__embeddingbusinessprocesspage`)
}