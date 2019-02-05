var OmniScript = module.exports = function(vlocity) {
	this.vlocity = vlocity;
};

// Returns an Object of label to value used in the field diff. 
OmniScript.prototype.createTitleFields = function(input) {
	var dataPackData = input.dataPackData;
	var fieldDiffs = [];

	var elements = dataPackData.VlocityDataPackData['%vlocity_namespace%__OmniScript__c'][0]['%vlocity_namespace%__Element__c'];

	if (elements) {
		var elementsInOrder = '';

		var indentations = {};

		for (var element of elements) {
			let elementIndentation = 1;

			try {
				if (element['%vlocity_namespace%__ParentElementId__c'] != null) {
					elementIndentation = indentations[element['%vlocity_namespace%__ParentElementId__c'].VlocityMatchingRecordSourceKey] + 2;
				} 
			} catch (e) {
				VlocityUtils.error('Error Building OmniScript Sequence', e);
			}

			indentations[element.VlocityRecordSourceKey] = elementIndentation;
			elementsInOrder += `${' '.repeat(elementIndentation)}${element.Name} (${element['%vlocity_namespace%__Type__c']})\n`;
		}

		fieldDiffs.push({ field: 'Elements', value: elementsInOrder, fieldType: 'side-by-side' });
	}

	return fieldDiffs;
};

OmniScript.prototype.activateReusable = async function(reusableOmniScript) {
	
	var result = {};

	if (reusableOmniScript) {

		var searchKey = `${reusableOmniScript['%vlocity_namespace%__Type__c']}|${reusableOmniScript['%vlocity_namespace%__SubType__c']}|${reusableOmniScript['%vlocity_namespace%__Language__c']}`;
		let reusableOmnis = await this.vlocity.jsForceConnection.query(`SELECT Id, ${this.vlocity.namespace}__OmniScriptId__c FROM ${this.vlocity.namespace}__Element__c WHERE ${this.vlocity.namespace}__SearchKey__c = '${searchKey}' AND ${this.vlocity.namespace}__OmniScriptId__r.${this.vlocity.namespace}__IsActive__c = true`);

		for (var i = 0; i < reusableOmnis.records.length; i++) {
			var activationResult = await this.vlocity.datapacksutils.jsRemote(`${this.vlocity.namespace}.EmbeddingBusinessProcessController`, 'activateScript', [ reusableOmnis.records[i].Id, 1], `${this.vlocity.namespace}__embeddingbusinessprocesspage`);

			if (activationResult && activationResult instanceof Array) {
				activationResult = activationResult[0];
			} else if (activationResult && typeof(activationResult) === 'string') {
				activationResult = JSON.parse(activationResult);
			}

			if (activationResult.statusCode < 400) {
				result.ActivationStatus = 'Success';
			} else {
				result.ActivationStatus = 'Error';
				result.message = activationResult.message;
				break;
			}
		}
	}

	return result;
};