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