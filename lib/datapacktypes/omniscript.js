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

		var indentation = 0;
		var previousElement = null;

		for (var element of elements) {

			if (element['%vlocity_namespace%__ParentElementId__c'] == null) {
				indentation = 1;
			} else if (element['%vlocity_namespace%__ParentElementId__c'].VlocityMatchingRecordSourceKey == previousElement)  {
				indentation += 2;
			}

			elementsInOrder += `${' '.repeat(indentation)}${element.Name} (${element['%vlocity_namespace%__Type__c']})\n`;
			previousElement = element.VlocityRecordSourceKey;
		}

		fieldDiffs.push({ field: 'Elements', value: elementsInOrder, fieldType: 'side-by-side' });
	}

	return fieldDiffs;
};