var CalculationProcedureVersion = module.exports = function (vlocity) {
    this.vlocity = vlocity;
};

CalculationProcedureVersion.prototype.activateWithJavaScript = async function(input) {

	let procedureVersionToActivate = { Id: input.dataPack.VlocityDataPackRecords[0].VlocityRecordSalesforceId };
	
	procedureVersionToActivate[`${this.vlocity.namespacePrefix}IsEnabled__c`] = true;

	let activationResult = await this.vlocity.jsForceConnection.sobject(`${this.vlocity.namespacePrefix}CalculationProcedureVersion__c`).update([ procedureVersionToActivate ], {});

	VlocityUtils.verbose('activationResult', activationResult);
	VlocityUtils.success('Activation Success', input.dataPack.VlocityDataPackKey);
}