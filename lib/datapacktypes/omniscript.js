var vlocity = require('../vlocity');

var OmniScript = module.exports = function(vlocity) {
    this.vlocity = vlocity;
};

var OMNI_BULK_RECORDS_LIMIT_MIN = 1000;

// Returns an Object of label to value used in the field diff. 
OmniScript.prototype.createTitleObjects = function(input) {
    var dataPackData = input.dataPackData;
    var titleObjects = [];
    let defaultNamespace = '%vlocity_namespace%__';
    if(!dataPackData.VlocityDataPackData[`${defaultNamespace}OmniScript__c`]){
        defaultNamespace = '';
    }
    if(dataPackData.VlocityDataPackData[`${defaultNamespace}OmniScript__c`][0][`${defaultNamespace}Element__c`]) {
        dataPackData.VlocityDataPackData[`${defaultNamespace}OmniScript__c`][0][`${defaultNamespace}Element__c`] = this.vlocity.datapacksexpand.sortList(dataPackData.VlocityDataPackData[`${defaultNamespace}OmniScript__c`][0][`${defaultNamespace}Element__c`], `${defaultNamespace}OmniScript__c`);
    }
    
    var elements = dataPackData.VlocityDataPackData[`${defaultNamespace}OmniScript__c`][0][`${defaultNamespace}Element__c`];

    var sourceKey = dataPackData.VlocityDataPackData[`${defaultNamespace}OmniScript__c`][0].VlocityRecordSourceKey;

    var omniscriptName = `${dataPackData.VlocityDataPackData[`${defaultNamespace}OmniScript__c`][0][`${defaultNamespace}Type__c`]} ${dataPackData.VlocityDataPackData[`${defaultNamespace}OmniScript__c`][0][`${defaultNamespace}SubType__c`]} ${dataPackData.VlocityDataPackData[`${defaultNamespace}OmniScript__c`][0][`${defaultNamespace}Language__c`]}`;

    var relevantFields = [ 'Name', `${defaultNamespace}Type__c`, 'VlocityRecordSourceKey' ];

    if (elements) {

        dataPackData.VlocityDataPackData[`${defaultNamespace}OmniScript__c`][0][`${defaultNamespace}Element__c`] = this.vlocity.datapacksexpand.sortList(elements, `${defaultNamespace}OmniScript__c`);

        elements = dataPackData.VlocityDataPackData[`${defaultNamespace}OmniScript__c`][0][`${defaultNamespace}Element__c`]; 

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
                if (element[`${defaultNamespace}ParentElementId__c`] != null) {
                    var parent = elementByKey[element[`${defaultNamespace}ParentElementId__c`].VlocityMatchingRecordSourceKey];

                    if (!parent.childElements) {
                        parent.childElements = [];
                    }

                    elementIndentation = indentations[element[`${defaultNamespace}ParentElementId__c`].VlocityMatchingRecordSourceKey] + 2;
                    parent.childElements.push(elementInTree)
                } else {
                    elementsInOrder.push(elementInTree);
                }

                indentations[element.VlocityRecordSourceKey] = elementIndentation;
                elementsAsText += `${' '.repeat(elementIndentation)}${element.Name} (${element[`${defaultNamespace}Type__c`]})\n`;
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
    var onActivateErrorResult = {},
        defaultNamespace = '%vlocity_namespace%__';
    if(!dataPackData.dataPacks[0].VlocityDataPackData[`${defaultNamespace}OmniScript__c`]){
        defaultNamespace = '';
    }
    var omniScriptDataPack = dataPackData.dataPacks[0].VlocityDataPackData[`${defaultNamespace}OmniScript__c`][0];
    var currentOmniScriptId = dataPackData.dataPacks[0].VlocityDataPackRecords[0].VlocityRecordSalesforceId;

    if (currentOmniScriptId && omniScriptDataPack[`${defaultNamespace}IsReusable__c`]) {

        if (!this.vlocity.sfdxUsername && !this.vlocity.oauthConnection) {
            VlocityUtils.log('Skipping Individual Activation because using SFDX Authentication is required');
        } else {
            var searchKey = `${omniScriptDataPack[`${defaultNamespace}Type__c`]}|${omniScriptDataPack[`${defaultNamespace}SubType__c`]}|${omniScriptDataPack[`${defaultNamespace}Language__c`]}`;

            VlocityUtils.verbose('Handling Reusable OmniScript Activation Directly', searchKey)
            
            var resultOfActivate = await this.vlocity.datapacksutils.jsRemote(`${this.vlocity.namespace}.EmbeddingBusinessProcessController`, 'activateScript', [ currentOmniScriptId, 1], `${this.vlocity.namespace}__embeddingbusinessprocesspage`);

            if (resultOfActivate && resultOfActivate[0].statusCode >= 300) {
                VlocityUtils.error('Error Activating OmniScript', resultOfActivate[0].message);

                onActivateErrorResult.ActivationStatus = 'Error';
                onActivateErrorResult.message = resultOfActivate[0].message;

                return onActivateErrorResult;
            }

            let reusableOmnis = await this.vlocity.jsForceConnection.query(`SELECT Id, ${this.vlocity.namespacePrefix}OmniScriptId__c FROM ${this.vlocity.namespacePrefix}Element__c WHERE ${this.vlocity.namespacePrefix}SearchKey__c = '${searchKey}' AND ${this.vlocity.namespacePrefix}OmniScriptId__r.${this.vlocity.namespacePrefix}IsActive__c = true`);
            
            for (var i = 0; i < reusableOmnis.records.length; i++) {
                
                var activationResult = await this.vlocity.datapacksutils.jsRemote(`${this.vlocity.namespace}.EmbeddingBusinessProcessController`, 'activateScript', [ reusableOmnis.records[i][`${this.vlocity.namespacePrefix}OmniScriptId__c`], 1], `${this.vlocity.namespacePrefix}embeddingbusinessprocesspage`);

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
                                var tempData = {},
                                    defaultNamespace = '%vlocity_namespace%__';
                                if(!OmniScriptData[`${defaultNamespace}ParentElementId__c`]){
                                    defaultNamespace = '';
                                }
                                Object.keys(OmniScriptData).forEach(function (omniData) {
                                    if (omniData === `${defaultNamespace}ParentElementId__c`) {
                                        tempData[`${defaultNamespace}ParentElementId__c`] = OmniScriptData[`${defaultNamespace}ParentElementId__c`]['VlocityMatchingRecordSourceKey'];
                                        //Add entry to parent-child relation map
                                        self.vlocity.relationMap[OmniScriptData['VlocityRecordSourceKey']] = tempData[`${defaultNamespace}ParentElementId__c`];
                                    }
                                    else if ((omniData.endsWith('__c') || omniData === 'Name' || omniData === 'VlocityRecordSourceKey') && omniData !== `${defaultNamespace}ReusableOmniScript__c`) {
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
        let defaultNamespace = element['%vlocity_namespace%__Order__c'] ? '%vlocity_namespace%__': ''
        if (element[defaultNamespace + 'Order__c'] >= orderToIncrementAfter) {
            element[defaultNamespace + 'Order__c'] = element[defaultNamespace + 'Order__c'] + 1;
        }
    })
}

OmniScript.prototype.discardSObject = function(input) {
    var deletedObject = input.deletedObject;
    var parentObject = input.parentObject;
    var defaultNamespace = parentObject['%vlocity_namespace%__Element__c'] ? '%vlocity_namespace%__':'';
    OmniScript.incrementElements(parentObject[defaultNamespace + 'Element__c'], deletedObject[defaultNamespace + 'Order__c']);

    parentObject[defaultNamespace + 'Element__c'].push(deletedObject);

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

    var defaultNamespace = sourceDataPack.VlocityDataPackData['%vlocity_namespace%__OmniScript__c'] ? '%vlocity_namespace%__' : '';
    
    var sourceElements = '',
        targetElements = '';

    
    sourceElements = sourceDataPack.VlocityDataPackData[`${defaultNamespace}OmniScript__c`][0][`${defaultNamespace}Element__c`];
    
    
    targetElements = targetDataPack.VlocityDataPackData[`${defaultNamespace}OmniScript__c`][0][`${defaultNamespace}Element__c`];

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
        OmniScript.incrementElements(sourceElements, targetElements[targetElementIndex][defaultNamespace + 'Order__c']);

        if (sourceElementIndex != -1) {

            //VlocityUtils.error('CHANGING' , readdElements[i], targetElements[targetElementIndex][defaultNamespace + 'Order__c'], sourceElements[sourceElementIndex][defaultNamespace + 'Order__c'])

            sourceElements[sourceElementIndex][`${defaultNamespace}Order__c`] = targetElements[targetElementIndex][`${defaultNamespace}Order__c`];
            sourceElements[sourceElementIndex][`${defaultNamespace}ParentElementId__c`] = targetElements[targetElementIndex][`${defaultNamespace}ParentElementId__c`];
            sourceElements[sourceElementIndex][`${defaultNamespace}ParentElementName__c`] = targetElements[targetElementIndex][`${defaultNamespace}ParentElementName__c`];
            sourceElements[sourceElementIndex][`${defaultNamespace}ParentElementType__c`] = targetElements[targetElementIndex][`${defaultNamespace}ParentElementType__c`];
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
            sourceElements[sourceElementIndex][`${defaultNamespace}Order__c`] = targetElements[targetElementIndex][`${defaultNamespace}Order__c`];
            sourceElements[sourceElementIndex][`${defaultNamespace}ParentElementId__c`] = targetElements[targetElementIndex][`${defaultNamespace}ParentElementId__c`];
            sourceElements[sourceElementIndex][`${defaultNamespace}ParentElementName__c`] = targetElements[targetElementIndex][`${defaultNamespace}ParentElementName__c`];
            sourceElements[sourceElementIndex][`${defaultNamespace}ParentElementType__c`] = targetElements[targetElementIndex][`${defaultNamespace}ParentElementType__c`];
        } else if (sourceElementIndex > -1) {
            sourceElements[sourceElementIndex].VlocityDataPackIsIncluded = false;
        }
    }

    if (removeElements.length > 0) {
        sourceDataPack.VlocityDataPackData[`${defaultNamespace}OmniScript__c`][0][`${defaultNamespace}Element__c`] = sourceDataPack.VlocityDataPackData[`${defaultNamespace}OmniScript__c`][0][`${defaultNamespace}Element__c`].filter(element => {
            return element.VlocityDataPackIsIncluded !== false;
        })
    }

    return true;
}

OmniScript.prototype.hashSObjectData = async function(input) {

    var sobject = input.sobject,
        defaultNamespace = sobject['%vlocity_namespace%__PropertySet__c'] ? '%vlocity_namespace%__' : '';

    if (sobject && sobject[`${defaultNamespace}PropertySet__c`]) {
        sobject[`${defaultNamespace}PropertySet__c`] = sobject[`${defaultNamespace}PropertySet__c`].replace(/id=01.+?&/g, 'id=<SalesforceId>').replace(/oid=00.+?\\/g, 'oid=<SalesforceId>\\').replace(/oid=00.+?"/g, 'oid=<SalesforceId>"').replace(/file=015.+?&/g, 'file=<SalesforceId>&');
    }
};

OmniScript.prototype.getBulkJobObjectName = function() {
    return this.vlocity.namespacePrefix + "Element__c"; 
}

OmniScript.prototype.getBulkJobObjectKey =  function () {
    return this.vlocity.namespacePrefix + "OmniScriptId__c";
}