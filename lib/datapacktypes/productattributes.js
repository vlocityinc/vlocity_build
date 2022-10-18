var ProductAttributes = module.exports = function(vlocity) {
    this.vlocity = vlocity;
};

ProductAttributes.prototype.onGenerateParentKeys = async function(input) {
	input.allParentKeys.push(`Product2/${input.dataPackData.VlocityDataPackData.Product2[0]['%vlocity_namespace%__GlobalKey__c']}`);
}

ProductAttributes.prototype.isSkipDeploy = function(input) {
    let vlocity = input.vlocity;
    let dataPackData = input.dataPackData[0];

    return vlocity.datapacksutils.hasOnlyProductBaseInfo(dataPackData);
}