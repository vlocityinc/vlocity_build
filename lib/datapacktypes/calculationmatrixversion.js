const fs = require('fs-extra');
const path = require('path');

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

CalculationMatrixVersion.prototype.exportWithJavaScript = async function(input) {
	try {
		let matrixVersion = input.exportData[0];

		var result = await this.vlocity.jsForceConnection.query(`SELECT count() FROM ${this.vlocity.namespacePrefix}CalculationMatrixRow__c WHERE ${this.vlocity.namespacePrefix}CalculationMatrixVersionId__c = '${matrixVersion.Id}'`);

		if (result.totalSize > CALC_BULK_RECORDS_LIMIT_MIN) {

			var buildDataPack = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'defaultdatapack.json'), 'utf8'));

			var dataPackKey = `CalculationMatrixVersion/${matrixVersion.Name}`;
			var dataPackName = matrixVersion.Name;
			var sObjectType = '%vlocity_namespace%__CalculationMatrixVersion__c';
			var dataPackType = 'CalculationMatrixVersion';

			var dataPack = {
				VlocityDataPackKey: dataPackKey,
				VlocityDataPackType: dataPackType,
				VlocityDataPackStatus: 'Success',
				VlocityDataPackIsIncluded: true,
				VlocityDataPackName: dataPackName,
				VlocityDataPackData: {
					VlocityDataPackKey: dataPackKey,
					VlocityDataPackType: dataPackType,
					VlocityDataPackIsIncluded: true,
					Id: matrixVersion.Id
				},
				VlocityDataPackRelationshipType: 'Primary'
			}
			
			buildDataPack.dataPacks.push(dataPack);

			dataPack.VlocityDataPackData[sObjectType] = [];

			let matrixVersionResult = await this.vlocity.queryservice.queryAllFields(sObjectType, `Id = '${matrixVersion.Id}'`, ['%vlocity_namespace%__CalculationMatrixId__r.Name']);

			let matrixVersionRecord = matrixVersionResult.records[0];	
			let matrixParentId = matrixVersionRecord['%vlocity_namespace%__CalculationMatrixId__c'];
			let matrixName = matrixVersionRecord['%vlocity_namespace%__CalculationMatrixId__r'].Name;

			matrixVersionRecord['%vlocity_namespace%__CalculationMatrixId__c'] = {
				Name: matrixName,
				VlocityDataPackType: "VlocityLookupMatchingKeyObject",
				VlocityLookupRecordSourceKey: `VlocityRecordSourceKey:${matrixParentId}`,
				VlocityRecordSObjectType: '%vlocity_namespace%__CalculationMatrix__c'
			};

			delete matrixVersionRecord['%vlocity_namespace%__CalculationMatrixId__r'];
			delete matrixVersionRecord.attributes;

			Object.keys(matrixVersionRecord).forEach(key => {
				if (matrixVersionRecord[key] === null) {
					matrixVersionRecord[key] = '';
				}
			});

			matrixVersionRecord.VlocityDataPackType = "SObject";
			matrixVersionRecord.VlocityRecordSObjectType = sObjectType;
			matrixVersionRecord.VlocityRecordSourceKey = `VlocityRecordSourceKey:${matrixVersionRecord.Id}`;

			var matrixRows = await this.vlocity.queryservice.queryAllFields( '%vlocity_namespace%__CalculationMatrixRow__c', `%vlocity_namespace%__CalculationMatrixVersionId__c = '${matrixVersion.Id}'`);

			matrixRows = matrixRows.records;

			for (var row of matrixRows) {
				row["%vlocity_namespace%__CalculationMatrixVersionId__c"] = {
					Name: matrixVersionRecord.Name,
					'%vlocity_namespace%__CalculationMatrixId__r': { Name: matrixName },
					'%vlocity_namespace%__VersionNumber__c': matrixVersionRecord['%vlocity_namespace%__VersionNumber__c'],
					VlocityDataPackType: "VlocityMatchingKeyObject",
					VlocityMatchingRecordSourceKey: `VlocityRecordSourceKey:${matrixVersionRecord.Id}`,
					VlocityRecordSObjectType: '%vlocity_namespace%__CalculationMatrixVersion__c'
				};

				row.VlocityDataPackType = "SObject";
				row.VlocityRecordSObjectType = "%vlocity_namespace%__CalculationMatrixRow__c";

				delete row.attributes;

				Object.keys(row).forEach(key => {
					if (row[key] === null) {
						row[key] = '';
					}
				});
			}

			matrixVersionRecord["%vlocity_namespace%__CalculationMatrixRow__c"] = matrixRows;

			dataPack.VlocityDataPackData["%vlocity_namespace%__CalculationMatrixVersion__c"].push(matrixVersionRecord);

			return buildDataPack;
		}
	} catch (e) {
		VlocityUtils.error('Error Exporting Large Matrix Version through JavaScript', e.stack);
	}
	
}

