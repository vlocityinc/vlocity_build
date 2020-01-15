var CalculationMatrixVersion = module.exports = function (vlocity) {
    this.vlocity = vlocity;
};

var CALC_BULK_RECORDS_LIMIT_MIN = 2000;

CalculationMatrixVersion.prototype.extractAllBulkRecords = async function (input) {
    
    var calculationMatrixRecords = [];
    var calculationMatrixHeaders = [];
	var datapack = input.dataPackData;
	
	var dataPrefix = '%vlocity_namespace%__';

	if (!datapack.VlocityDataPackData[dataPrefix + 'CalculationMatrixVersion__c']) {
		dataPrefix = '';
	}

	var result = await this.vlocity.jsForceConnection.query(`SELECT count() FROM ${this.vlocity.namespacePrefix}CalculationMatrixRow__c WHERE ${this.vlocity.namespacePrefix}CalculationMatrixVersionId__r.Name = '${datapack.VlocityDataPackData[dataPrefix + 'CalculationMatrixVersion__c'][0].Name}'`);

	if (result.totalSize > 100000) {
		throw 'Cannot Update a Matrix Version with more than 100,000 rows. You must create a new Version.';
	}

    if (datapack.recordsCount < CALC_BULK_RECORDS_LIMIT_MIN) {
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

							if (!calcObj.hasOwnProperty(`${dataPrefix}OutputData__c`)) {
								tempData[`${dataPrefix}OutputData__c`] = '';
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

	let matrixVersionToActivate = { Id: input.dataPack.VlocityDataPackRecords[0].VlocityRecordSalesforceId };
	
	matrixVersionToActivate[`${this.vlocity.namespacePrefix}IsEnabled__c`] = true;

	let activationResult = await this.vlocity.jsForceConnection.sobject(`${this.vlocity.namespacePrefix}CalculationMatrixVersion__c`).update([ matrixVersionToActivate ], {});

	VlocityUtils.verbose('activationResult', activationResult);
	VlocityUtils.success('Activation Success', input.dataPack.VlocityDataPackKey);
}

