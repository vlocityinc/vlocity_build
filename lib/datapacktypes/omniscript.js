var vlocity = require('../vlocity');

var OmniScript = module.exports = function(vlocity) {
    this.vlocity = vlocity;
};

var OMNI_BULK_RECORDS_LIMIT_MIN = 1000;

// Returns an Object of label to value used in the field diff. 
OmniScript.prototype.createTitleObjects = function(input) {
    var dataPackData = input.dataPackData;
    var titleObjects = [];

    if (dataPackData.VlocityDataPackData['%vlocity_namespace%__OmniScript__c'][0]['%vlocity_namespace%__Element__c']) {
        dataPackData.VlocityDataPackData['%vlocity_namespace%__OmniScript__c'][0]['%vlocity_namespace%__Element__c'] = this.vlocity.datapacksexpand.sortList(dataPackData.VlocityDataPackData['%vlocity_namespace%__OmniScript__c'][0]['%vlocity_namespace%__Element__c'], '%vlocity_namespace%__OmniScript__c');
    }
    
    var elements = dataPackData.VlocityDataPackData['%vlocity_namespace%__OmniScript__c'][0]['%vlocity_namespace%__Element__c'];

    var sourceKey = dataPackData.VlocityDataPackData['%vlocity_namespace%__OmniScript__c'][0].VlocityRecordSourceKey;

    var omniscriptName = `${dataPackData.VlocityDataPackData['%vlocity_namespace%__OmniScript__c'][0]['%vlocity_namespace%__Type__c']} ${dataPackData.VlocityDataPackData['%vlocity_namespace%__OmniScript__c'][0]['%vlocity_namespace%__SubType__c']} ${dataPackData.VlocityDataPackData['%vlocity_namespace%__OmniScript__c'][0]['%vlocity_namespace%__Language__c']}`;

    var relevantFields = [ 'Name', '%vlocity_namespace%__Type__c', 'VlocityRecordSourceKey' ];

    if (elements) {

        dataPackData.VlocityDataPackData['%vlocity_namespace%__OmniScript__c'][0]['%vlocity_namespace%__Element__c'] = this.vlocity.datapacksexpand.sortList(elements, '%vlocity_namespace%__OmniScript__c');

        elements = dataPackData.VlocityDataPackData['%vlocity_namespace%__OmniScript__c'][0]['%vlocity_namespace%__Element__c']; 

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

        titleObjects.push({ 
            field: 'Elements', 
            value: elementsAsText, 
            fieldType: 'DisplayOnly', 
            VlocityDataPackType: 'OmniScript', 
            revertHandler: true,
            VlocityRecordSourceKey: sourceKey,
            VlocitySObjectRecordLabel: `OmniScript / ${omniscriptName} / Elements`
        });
    }

    return titleObjects;
};

OmniScript.prototype.onActivateError = async function(dataPackData) {
    
    VlocityUtils.verbose('Handling OmniScript Activation Directly', dataPackData.VlocityDataPackKey)
    var onActivateErrorResult = {};
    var omniScriptDataPack = dataPackData.dataPacks[0].VlocityDataPackData['%vlocity_namespace%__OmniScript__c'][0];
    var currentOmniScriptId = dataPackData.dataPacks[0].VlocityDataPackRecords[0].VlocityRecordSalesforceId;

    if (currentOmniScriptId && omniScriptDataPack['%vlocity_namespace%__IsReusable__c']) {

        if (!this.vlocity.sfdxUsername) {
            VlocityUtils.verbose('Skipping Individual Activation because using SFDX Authentication is required');
        } else {
            var searchKey = `${omniScriptDataPack['%vlocity_namespace%__Type__c']}|${omniScriptDataPack['%vlocity_namespace%__SubType__c']}|${omniScriptDataPack['%vlocity_namespace%__Language__c']}`;

            VlocityUtils.verbose('Handling Reusable OmniScript Activation Directly', searchKey)
            await this.vlocity.datapacksutils.jsRemote(`${this.vlocity.namespace}.EmbeddingBusinessProcessController`, 'activateScript', [ currentOmniScriptId, 1], `${this.vlocity.namespace}__embeddingbusinessprocesspage`);
           
            let reusableOmnis = await this.vlocity.jsForceConnection.query(`SELECT Id, ${this.vlocity.namespace}__OmniScriptId__c FROM ${this.vlocity.namespace}__Element__c WHERE ${this.vlocity.namespace}__SearchKey__c = '${searchKey}' AND ${this.vlocity.namespace}__OmniScriptId__r.${this.vlocity.namespace}__IsActive__c = true`);
            
            for (var i = 0; i < reusableOmnis.records.length; i++) {
                
                var activationResult = await this.vlocity.datapacksutils.jsRemote(`${this.vlocity.namespace}.EmbeddingBusinessProcessController`, 'activateScript', [ reusableOmnis.records[i][`${this.vlocity.namespace}__OmniScriptId__c`], 1], `${this.vlocity.namespace}__embeddingbusinessprocesspage`);

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

            return onActivateErrorResult;
        }
    }

    return null;
};


OmniScript.prototype.extractAllBulkRecords = function(input) {
    var OmniScriptRecords = [];
    var datapack = input.dataPackData;
    var self = this;
    
    if (datapack.recordsCount < OMNI_BULK_RECORDS_LIMIT_MIN) {
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

OmniScript.prototype.getUpdatedParentList = async function() {
    var self = this;
    var elementObjList = [];
    for (var key in self.vlocity.nameToSfIdMap) {
        if (key in self.vlocity.relationMap) {
            var elementObj = { Id: self.vlocity.nameToSfIdMap[key] };
            elementObj[self.vlocity.namespacePrefix + 'ParentElementId__c'] = self.vlocity.nameToSfIdMap[self.vlocity.relationMap[key]];
            elementObjList.push(elementObj);
            delete self.vlocity.relationMap[key];
        }
    }
    return elementObjList;
}

OmniScript.incrementElements = function(elements, orderToIncrementAfter) {
    elements.forEach(element => {
        if (element['%vlocity_namespace%__Order__c'] >= orderToIncrementAfter) {
            element['%vlocity_namespace%__Order__c'] = element['%vlocity_namespace%__Order__c'] + 1;
        }
    })
}

OmniScript.prototype.discardSObject = function(input) {
    var deletedObject = input.deletedObject;
    var parentObject = input.parentObject;

    OmniScript.incrementElements(parentObject['%vlocity_namespace%__Element__c'], deletedObject['%vlocity_namespace%__Order__c']);

    parentObject['%vlocity_namespace%__Element__c'].push(deletedObject);

    return true;
}

OmniScript.staticHandleRevert = async function(input) {

    VlocityUtils.error('staticHandleRevert');

    var comparisonFileSource = input.comparisonFileSource;
    var comparisonFileTarget = input.comparisonFileTarget;
    var revertRecord = input.revertRecord;
    var dataPackKey = revertRecord.VlocityDataPackKey; 

    var diffString = revertRecord.gitDiff;
    var diffStringSplit = diffString.split('\n');

    var readdElements = [];
    var removeElements = [];

    var sourceDataPack = comparisonFileSource.dataPacks.find(dataPack => {
        return dataPack.VlocityDataPackKey == dataPackKey;
    });

    var targetDataPack = comparisonFileTarget.dataPacks.find(dataPack => {
        return dataPack.VlocityDataPackKey == dataPackKey;
    });

    var sourceElements = sourceDataPack.VlocityDataPackData['%vlocity_namespace%__OmniScript__c'][0]['%vlocity_namespace%__Element__c'];
    var targetElements = targetDataPack.VlocityDataPackData['%vlocity_namespace%__OmniScript__c'][0]['%vlocity_namespace%__Element__c'];

    for (var i = 2; i < diffStringSplit.length; i++) {

        var elementLine = diffStringSplit[i];

        if (elementLine) {
            var elementName = elementLine.substr(1, elementLine.indexOf('(')-1).trim();

            if (elementLine[0] == '-') {
                readdElements.push(elementName);
            } else if (elementLine[0] == '+') {
                removeElements.push(elementName);
            }
        }
    }

    removeElements = removeElements.filter(elementName => {
        return readdElements.indexOf(elementName) == -1;
    });

    for (var i = 0; i < readdElements.length; i++) {
        
        var sourceElementIndex = sourceElements.findIndex(ele => {
            return ele.Name == readdElements[i];
        });

        var targetElementIndex = targetElements.findIndex(ele => {
            return ele.Name == readdElements[i];
        });

        //
        OmniScript.incrementElements(sourceElements, targetElements[targetElementIndex]['%vlocity_namespace%__Order__c']);

        if (sourceElementIndex != -1) {

            //VlocityUtils.error('CHANGING' , readdElements[i], targetElements[targetElementIndex]['%vlocity_namespace%__Order__c'], sourceElements[sourceElementIndex]['%vlocity_namespace%__Order__c'])

            sourceElements[sourceElementIndex]['%vlocity_namespace%__Order__c'] = targetElements[targetElementIndex]['%vlocity_namespace%__Order__c'];
            sourceElements[sourceElementIndex]['%vlocity_namespace%__ParentElementId__c'] = targetElements[targetElementIndex]['%vlocity_namespace%__ParentElementId__c'];
            sourceElements[sourceElementIndex]['%vlocity_namespace%__ParentElementName__c'] = targetElements[targetElementIndex]['%vlocity_namespace%__ParentElementName__c'];

            sourceElements[sourceElementIndex]['%vlocity_namespace%__ParentElementType__c'] = targetElements[targetElementIndex]['%vlocity_namespace%__ParentElementType__c'];
        } else {
            sourceElements.push(targetElements[targetElementIndex]);
        }
    }

    for (var i = 0; i < removeElements.length; i++) {
        var sourceElementIndex = sourceElements.findIndex(ele => {
            return ele.Name == removeElements[i];
        });

        var targetElementIndex = targetElements.findIndex(ele => {
            return ele.Name == removeElements[i];
        });

        if (targetElementIndex > -1) {
            sourceElements[sourceElementIndex]['%vlocity_namespace%__Order__c'] = targetElements[targetElementIndex]['%vlocity_namespace%__Order__c'];
            sourceElements[sourceElementIndex]['%vlocity_namespace%__ParentElementId__c'] = targetElements[targetElementIndex]['%vlocity_namespace%__ParentElementId__c'];
            sourceElements[sourceElementIndex]['%vlocity_namespace%__ParentElementName__c'] = targetElements[targetElementIndex]['%vlocity_namespace%__ParentElementName__c'];
            sourceElements[sourceElementIndex]['%vlocity_namespace%__ParentElementType__c'] = targetElements[targetElementIndex]['%vlocity_namespace%__ParentElementType__c'];
        } else if (sourceElementIndex > -1) {
            sourceElements[sourceElementIndex].VlocityDataPackIsIncluded = false;
        }
    }

    if (removeElements.length > 0) {
        sourceDataPack.VlocityDataPackData['%vlocity_namespace%__OmniScript__c'][0]['%vlocity_namespace%__Element__c'] = sourceDataPack.VlocityDataPackData['%vlocity_namespace%__OmniScript__c'][0]['%vlocity_namespace%__Element__c'].filter(element => {
            return element.VlocityDataPackIsIncluded !== false;
        })
    }

    return true;
}

