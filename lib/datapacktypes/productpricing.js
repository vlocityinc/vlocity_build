var ProductPricing = module.exports = function(vlocity) {
    this.vlocity = vlocity;
};

ProductPricing.prototype.onGenerateParentKeys = async function(input) {
	input.allParentKeys.push(`Product2/${input.dataPackData.VlocityDataPackData.Product2[0]['%vlocity_namespace%__GlobalKey__c']}`);
}

//Deploy error:
//ProductAttributes/8a3720e2-dd61-05d3-dc62-1f760cfc81fe -- DataPack >> Multi Auto -- Error Message -- No match found for vlocityins2__OverrideDefinition__c.vlocityins2__OverriddenAttributeAssignmentId__c - vlocityins2__GlobalKey__c=50e2fa59-a00e-06a1-8633-644bb7900278 (vlocityins2)