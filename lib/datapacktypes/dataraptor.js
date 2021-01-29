var DataRaptor = module.exports = function (vlocity) {
    this.vlocity = vlocity;
};

DataRaptor.prototype.addParentReference = function (dataPack) {
    dataPack.VlocityDataPackData['%vlocity_namespace%__DRBundle__c'][0]['%vlocity_namespace%__DRMapItem__c'].forEach(mapItem => {
        mapItem['OmniDataTransformationId'] = {
            "Name": dataPack.VlocityDataPackName,
            "VlocityRecordSObjectType": "OmniDataTransform",
            "VlocityDataPackType": "VlocityMatchingKeyObject",
            "VlocityMatchingRecordSourceKey": "%vlocity_namespace%__DRBundle__c/" + dataPack.VlocityDataPackName
        }
    });
}