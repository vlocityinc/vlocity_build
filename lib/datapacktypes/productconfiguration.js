var ProductConfiguration = module.exports = function(vlocity) {
    this.vlocity = vlocity;
};

ProductConfiguration.prototype.onGenerateParentKeys = async function(input) {
	input.allParentKeys.push(`Product2/${input.dataPackData.VlocityDataPackData.Product2[0]['%vlocity_namespace%__GlobalKey__c']}`);
}