var OmniScript = module.exports = function(vlocity) {
    this.vlocity = vlocity;
};

var OMNI_BULK_RECORDS_LIMIT_MIN = 1000;

// Returns an Object of label to value used in the field diff. 
OmniScript.prototype.createTitleFields = function(input) {
    var dataPackData = input.dataPackData;
    var fieldDiffs = [];

    var elements = dataPackData.VlocityDataPackData['%vlocity_namespace%__OmniScript__c'][0]['%vlocity_namespace%__Element__c'];

    var relevantFields = [ 'Name', '%vlocity_namespace%__Type__c', 'VlocityRecordSourceKey' ];

    if (elements) {
        var elementsInOrder = [];
        var elementsAsText = '';
        var indentations = {};
        var elementByKey = {};
        
        for (var element of elements) {
            var elementIndentation = 1;

            var elementInTree = {};

            for (var field of relevantFields) {
                elementInTree[field] = element[field];
            }

            elementByKey[element.VlocityRecordSourceKey] = elementInTree;

            try {
                if (element['%vlocity_namespace%__ParentElementId__c'] != null) {
                    var parent = elementByKey[element['%vlocity_namespace%__ParentElementId__c'].VlocityMatchingRecordSourceKey];

                    if (!parent.childElements) {
                        parent.childElements = [];
                    }

                    elementIndentation = indentations[element['%vlocity_namespace%__ParentElementId__c'].VlocityMatchingRecordSourceKey] + 2;
                    parent.childElements.push(elementInTree)
                } else {
                    elementsInOrder.push(elementInTree);
                }

                indentations[element.VlocityRecordSourceKey] = elementIndentation;
                elementsAsText += `${' '.repeat(elementIndentation)}${element.Name} (${element['%vlocity_namespace%__Type__c']})\n`;
            } catch (e) {
                VlocityUtils.error('Error Building OmniScript Sequence', e);
            }
        }

        fieldDiffs.push({ 
            field: 'Elements', 
            value: elementsAsText, 
            fieldType: 'side-by-side', 
            VlocityDataPackType: 'OmniScript', 
            revertHandler: true 
        });
/*
        fieldDiffs.push({ 
            field: 'ElementTree', 
            value: elementsInOrder, 
            fieldType: 'tree', 
            VlocityDataPackType: 'OmniScript', revertHandler: true 
        });
*/
    }

    return fieldDiffs;
};

OmniScript.prototype.onActivateError = async function(dataPackData) {

	var onActivateErrorResult = {};
	var omniScriptDataPack = dataPackData.dataPacks[0].VlocityDataPackData['%vlocity_namespace%__OmniScript__c'][0];

	if (omniScriptDataPack['%vlocity_namespace%__IsReusable__c']) {
		var searchKey = `${omniScriptDataPack['%vlocity_namespace%__Type__c']}|${omniScriptDataPack['%vlocity_namespace%__SubType__c']}|${omniScriptDataPack['%vlocity_namespace%__Language__c']}`;
		let reusableOmnis = await this.vlocity.jsForceConnection.query(`SELECT Id, ${this.vlocity.namespace}__OmniScriptId__c FROM ${this.vlocity.namespace}__Element__c WHERE ${this.vlocity.namespace}__SearchKey__c = '${searchKey}' AND ${this.vlocity.namespace}__OmniScriptId__r.${this.vlocity.namespace}__IsActive__c = true`);

		for (var i = 0; i < reusableOmnis.records.length; i++) {
			var activationResult = await this.vlocity.datapacksutils.jsRemote(`${this.vlocity.namespace}.EmbeddingBusinessProcessController`, 'activateScript', [ reusableOmnis.records[i].Id, 1], `${this.vlocity.namespace}__embeddingbusinessprocesspage`);

			if (activationResult && activationResult instanceof Array) {
				activationResult = activationResult[0];
			} else if (activationResult && typeof(activationResult) === 'string') {
				activationResult = JSON.parse(activationResult);
			}

			if (activationResult.statusCode < 400) {
				onActivateErrorResult.ActivationStatus = 'Success';
			} else {
				onActivateErrorResult.ActivationStatus = 'Error';
				onActivateErrorResult.message = activationResult.message;
				break;
			}
		}
	}

	return onActivateErrorResult;
};


OmniScript.prototype.extractAllBulkRecords = function (input) {
	var OmniScriptRecords = [];
	var datapack = input.dataPackData;
	var self = this;

	if (input.recordsCount < OMNI_BULK_RECORDS_LIMIT_MIN) {
		return null;
	}

	Object.keys(datapack.VlocityDataPackData).forEach(function (key) {
		if (Array.isArray(datapack.VlocityDataPackData[key])) {
			for (var OmniScriptVersion of datapack.VlocityDataPackData[key]) {
				if (typeof OmniScriptVersion === 'object') {
					Object.keys(OmniScriptVersion).forEach(function (omniKey) {
						if (Array.isArray(OmniScriptVersion[omniKey])) {
							for (var OmniScriptData of OmniScriptVersion[omniKey]) {
								var tempData = {};
								Object.keys(OmniScriptData).forEach(function (omniData) {
									if (omniData === '%vlocity_namespace%__ParentElementId__c') {
										tempData['%vlocity_namespace%__ParentElementId__c'] = OmniScriptData['%vlocity_namespace%__ParentElementId__c']['VlocityMatchingRecordSourceKey'];
										//Add entry to parent-child relation map
										self.vlocity.relationMap[OmniScriptData['VlocityRecordSourceKey']] = tempData['%vlocity_namespace%__ParentElementId__c'];
									}
									else if ((omniData.endsWith('__c') || omniData === 'Name' || omniData === 'VlocityRecordSourceKey') && omniData !== '%vlocity_namespace%__ReusableOmniScript__c') {
										tempData[omniData] = OmniScriptData[omniData];
									}
								});
								OmniScriptRecords.push(tempData);
							}
							OmniScriptVersion[omniKey] = '';
						}
					});
				}

			}
		}
	});
	return OmniScriptRecords;

}

OmniScript.prototype.getUpdatedParentList = async function () {
	var self = this;
	var elementObjList = [];
	for (var key in self.vlocity.nameToSfIdMap) {
		if (key in self.vlocity.relationMap) {
			var elementObj = { Id: self.vlocity.nameToSfIdMap[key] };
			elementObj[self.vlocity.namespacePrefix + 'ParentElementId__c'] = self.vlocity.nameToSfIdMap[self.vlocity.relationMap[key]];
			elementObjList.push(elementObj);
		}
	}
	return elementObjList;
}
