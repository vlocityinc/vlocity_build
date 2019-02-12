var OmniScript = module.exports = function(vlocity) {
    this.vlocity = vlocity;
};

// Returns an Object of label to value used in the field diff. 
OmniScript.prototype.createTitleFields = function(input) {
    var dataPackData = input.dataPackData;
    var fieldDiffs = [];

    var elements = dataPackData.VlocityDataPackData['%vlocity_namespace%__OmniScript__c'][0]['%vlocity_namespace%__Element__c'];

    var relevantFields = [ 'Name', '%vlocity_namespace%__Type__c', 'VlocityRecordSourceKey' ];

    if (elements) {
        var elementsInOrder = [];
        var elementByKey = {};

        for (var element of elements) {

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

                    parent.childElements.push(elementInTree)
                } else {
                    elementsInOrder.push(elementInTree);
                }
            } catch (e) {
                VlocityUtils.error('Error Building OmniScript Sequence', e);
            }
        }

        fieldDiffs.push({ 
            field: 'Elements', 
            value: elementsInOrder, 
            fieldType: 'tree', 
            VlocityDataPackType: 'OmniScript', revertHandler: true 
        });
    }

    return fieldDiffs;
};