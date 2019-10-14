var VlocityUITemplate = module.exports = function(vlocity) {
	this.vlocity = vlocity;
};

VlocityUITemplate.prototype.onDeployFinish = async function(jobInfo) {
    if (jobInfo.foundOmniScriptTemplate) {
        if (!this.vlocity.sfdxUsername && !this.vlocity.oauthConnection) {
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

    var templateTypes = ['OmniScript', 'OmniScript Selectable Items'];

    if (jobInfo.reactivateOmniScriptsWhenEmbeddedTemplateFound) {
        if (templateTypes.includes(dataPack.VlocityDataPackData['%vlocity_namespace%__VlocityUITemplate__c'][0]['%vlocity_namespace%__Type__c'])) {
            jobInfo.foundOmniScriptTemplate = true;
        }
    }   
}

VlocityUITemplate.prototype.createTitleObjects = function(input) {
    var dataPackData = input.dataPackData;
    var sourceKey = dataPackData.VlocityDataPackData['%vlocity_namespace%__VlocityUITemplate__c'][0].VlocityRecordSourceKey; 
    var templateName = dataPackData.VlocityDataPackData['%vlocity_namespace%__VlocityUITemplate__c'][0]['Name'];
    var titleObjects = [];

    if (dataPackData.VlocityDataPackData['%vlocity_namespace%__VlocityUITemplate__c'] && dataPackData.VlocityDataPackData['%vlocity_namespace%__VlocityUITemplate__c'][0]) {

        if (dataPackData.VlocityDataPackData['%vlocity_namespace%__VlocityUITemplate__c'][0]['%vlocity_namespace%__HTML__c']) {
            titleObjects.push({ 
                field: 'HTML', 
                value: dataPackData.VlocityDataPackData['%vlocity_namespace%__VlocityUITemplate__c'][0]['%vlocity_namespace%__HTML__c'], 
                fieldType: 'html', 
                VlocityDataPackType: 'VlocityUITemplate', 
                VlocityRecordSourceKey: sourceKey,
                VlocityRecordEditField: '%vlocity_namespace%__HTML__c',
                VlocitySObjectRecordLabel: `Vlocity UI Template / ${templateName} / HTML`
            });
        }
        
        if (dataPackData.VlocityDataPackData['%vlocity_namespace%__VlocityUITemplate__c'][0]['%vlocity_namespace%__CustomJavascript__c']) {
            titleObjects.push({ 
                field: 'JavaScript', 
                value: dataPackData.VlocityDataPackData['%vlocity_namespace%__VlocityUITemplate__c'][0]['%vlocity_namespace%__CustomJavascript__c'], 
                fieldType: 'javascript', 
                VlocityDataPackType: 'VlocityUITemplate', 
                VlocityRecordSourceKey: sourceKey,
                VlocityRecordEditField: '%vlocity_namespace%__CustomJavascript__c',
                VlocitySObjectRecordLabel: `Vlocity UI Template / ${templateName} / JavaScript`
            });
        }

        if (dataPackData.VlocityDataPackData['%vlocity_namespace%__VlocityUITemplate__c'][0]['%vlocity_namespace%__Sass__c']) {
            titleObjects.push({
                field: 'SASS', 
                value: dataPackData.VlocityDataPackData['%vlocity_namespace%__VlocityUITemplate__c'][0]['%vlocity_namespace%__Sass__c'], 
                fieldType: 'css', 
                VlocityDataPackType: 'VlocityUITemplate', 
                VlocityRecordSourceKey: sourceKey,
                VlocityRecordEditField: '%vlocity_namespace%__Sass__c',
                VlocitySObjectRecordLabel: `Vlocity UI Template / ${templateName} / SASS`
            });
        }
    }

    return titleObjects;
}