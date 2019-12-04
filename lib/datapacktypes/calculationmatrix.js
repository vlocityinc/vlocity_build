var CalculationMatrix = module.exports = function (vlocity) {
    this.vlocity = vlocity;
};

var CALC_BULK_RECORDS_LIMIT_MIN = 2000;

CalculationMatrix.prototype.extractAllBulkRecords = function (input) {
    
    var calculationMatrixRecords = [];
    var calculationMatrixHeaders = [];
    var datapack = input.dataPackData;

    if(datapack.recordsCount <  CALC_BULK_RECORDS_LIMIT_MIN) {
        return null;
    }

    Object.keys(datapack.VlocityDataPackData).forEach(function (key) {
        if (Array.isArray(datapack.VlocityDataPackData[key])) {
            for (var calculationMatrixVersion of datapack.VlocityDataPackData[key])//for each calculation matrix
            {
                Object.keys(calculationMatrixVersion).forEach(function (cmkey) {
                    if (Array.isArray(calculationMatrixVersion[cmkey])) {
                        for (var calculationMatrixData of calculationMatrixVersion[cmkey])//for each calculation matrix version
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

                                        if (tempData.Name== 'Header') {
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
            }
        }
    });
    return calculationMatrixRecords;

}

CalculationMatrix.prototype.getBulkJobObjectName = function() {
    return this.vlocity.namespacePrefix + "CalculationMatrixRow__c"; 
}

CalculationMatrix.prototype.getBulkJobObjectKey = function () {
    return this.vlocity.namespacePrefix + "CalculationMatrixVersionId__c";
}