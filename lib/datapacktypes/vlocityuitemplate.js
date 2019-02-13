var async = require('async');

var VlocityUITemplate = module.exports = function(vlocity) {
	this.vlocity = vlocity;
};

VlocityUITemplate.prototype.onDeployFinish = async function(jobInfo) {
    if (jobInfo.foundOmniScriptTemplate) {
        if (!this.vlocity.sfdxUsername) {
            VlocityUtils.report('Invalid Action', 'OmniScripts cannot be automatically activated unless using SFDX Authentication');
        } else {
            queryPromises = [];

            var activeOmniScripts = await this.vlocity.queryservice.query(`SELECT Id FROM ${this.vlocity.namespace}__OmniScript__c WHERE ${this.vlocity.namespace}__IsActive__c = true`);
        
            for (var omniscript of activeOmniScripts.records) {
                queryPromises.push({context: this, argument: { omniscript : omniscript}, func: 'activateOmniScript'});
            }
        
            await this.vlocity.utilityservice.parallelLimit(queryPromises, 5);
        }
    }
};

VlocityUITemplate.prototype.activateOmniScript = async function(inputMap) {
    var omniscript = inputMap.omniscript;
    await this.vlocity.datapacksutils.jsRemote(`${this.vlocity.namespace}.EmbeddingBusinessProcessController`, 'activateScript', [ omniscript.Id, 1], `${this.vlocity.namespace}__embeddingbusinessprocesspage`)
}

VlocityUITemplate.prototype.afterActivationSuccess  = async function(inputMap) {
    var jobInfo = inputMap.jobInfo;
    var dataPack = inputMap.dataPack;

    if (jobInfo.reactivateOmniScriptsWhenEmbeddedTemplateFound) {
        if (dataPack.VlocityDataPackData['%vlocity_namespace%__VlocityUITemplate__c'][0]['%vlocity_namespace%__Type__c'] === 'OmniScript') {
            jobInfo.foundOmniScriptTemplate = true;
        }
    }   
}