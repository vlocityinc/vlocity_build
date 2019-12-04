var CalculationMatrixVersion = module.exports = function (vlocity) {
    this.vlocity = vlocity;
};

var CALC_BULK_RECORDS_LIMIT_MIN = 2000;

CalculationMatrixVersion.prototype.extractAllBulkRecords = function (input) {
    
    var calculationMatrixRecords = [];
    var calculationMatrixHeaders = [];
    var datapack = input.dataPackData;

    if(datapack.recordsCount <  CALC_BULK_RECORDS_LIMIT_MIN) {
        return null;
    }

    Object.keys(datapack.VlocityDataPackData).forEach(function (key) {
        if (Array.isArray(datapack.VlocityDataPackData[key])) {
			for (var calculationMatrixData of datapack.VlocityDataPackData[key]) //for each calculation matrix version
			{
				Object.keys(calculationMatrixData).forEach(function (cmdata) {
					if (Array.isArray(calculationMatrixData[cmdata])) {
						for (var calcObj of calculationMatrixData[cmdata]) {
							var tempData = {};
							Object.keys(calcObj).forEach(function (key) {
								if (key.endsWith('__c') || key === 'Name') {
									tempData[key] = calcObj[key];
								}
							});

							if (!calcObj.hasOwnProperty("%vlocity_namespace%__OutputData__c")) {
								tempData['%vlocity_namespace%__OutputData__c'] = '';
							}

							if (tempData.Name == 'Header') {
								calculationMatrixHeaders.push(tempData);
							} else {
								calculationMatrixRecords.push(tempData);
							}
						}

						calculationMatrixData[cmdata] = calculationMatrixHeaders;
					}
				});
			}
		}
	});
	
    return calculationMatrixRecords;
}

CalculationMatrixVersion.prototype.getBulkJobObjectName = function() {
    return this.vlocity.namespacePrefix + "CalculationMatrixRow__c"; 
}

CalculationMatrixVersion.prototype.getBulkJobObjectKey = function () {
    return this.vlocity.namespacePrefix + "CalculationMatrixVersionId__c";
}

CalculationMatrixVersion.prototype.activateWithJavaScript = async function(input) {

	let matrixVersionToActivate = { Id: input.dataPack.VlocityDataPackRecords[0].SalesforceRecordId };
	
	matrixVersionToActivate[`${this.vlocity.namespacePrefix}IsEnabled__c`] = true;

	await this.vlocity.jsForceConnection.sobject(`${this.vlocity.namespacePrefix}CalculationMatrixVersion__c`).update([ matrixVersionToActivate ], {});
}

