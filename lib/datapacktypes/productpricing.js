var ProductPricing = module.exports = function(vlocity) {
    this.vlocity = vlocity;
};

ProductPricing.prototype.onGenerateParentKeys = async function(input) {
	input.allParentKeys.push(`Product2/${input.dataPackData.VlocityDataPackData.Product2[0]['%vlocity_namespace%__GlobalKey__c']}`);
}