var ProductHierarchy = module.exports = function(vlocity) {
    this.vlocity = vlocity;
};

ProductHierarchy.prototype.onGenerateParentKeys = async function(input) {
	input.allParentKeys.push(`Product2/${input.dataPackData.VlocityDataPackData.Product2[0]['%vlocity_namespace%__GlobalKey__c']}`);
	// Due to triggers that check for Pricebook Entries in hierarchy objects
	input.allParentKeys.push(`ProductPricing/${input.dataPackData.VlocityDataPackData.Product2[0]['%vlocity_namespace%__GlobalKey__c']}`);
}