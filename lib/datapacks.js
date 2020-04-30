var DATA_PACKS_REST_RESOURCE = "/v1/VlocityDataPacks/";

var DataPacks = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};
    this.retried = [];
};

DataPacks.prototype.dataPacksEndpoint = function() {
    return (this.vlocity.namespace ? '/' + this.vlocity.namespace : '') + DATA_PACKS_REST_RESOURCE;
};

DataPacks.prototype.makeApexGetRequest = async function(endpoint) {
    let tries = 0;
    while (true) {
        try {
            let response = await this.vlocity.jsForceConnection.apex.get(endpoint);
            return response;
        } catch (err) {
            
            if (err.code == 'ECONNRESET' || err.errorCode == 'ECONNRESET' || (err.errorCode == 'REQUEST_LIMIT_EXCEEDED' && err.message.indexOf('ConcurrentPerOrgLongTxn') != -1)) {
                VlocityUtils.verbose('Retrying Connection Error', err);
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else if (err.errorCode == 'REQUEST_LIMIT_EXCEEDED') {
                throw err;
            } else if (tries < 3) {
                VlocityUtils.verbose('Make Get Request Error', err);

                tries++;
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                throw err;
            }
        }
    }
}

DataPacks.prototype.makeApexPostRequest = async function(endpoint, payload) {
    let tries = 0;
    while (true) {
        try {
            let response = await this.vlocity.jsForceConnection.apex.post(endpoint, payload);
            return response;
        } catch (err) {

            VlocityUtils.verbose('Error', err);

            if (err.code == 'ECONNRESET' || err.errorCode == 'ECONNRESET' || (err.errorCode == 'REQUEST_LIMIT_EXCEEDED' && err.message.indexOf('ConcurrentPerOrgLongTxn') != -1)) {
                VlocityUtils.verbose('Retrying Connection Error', err);
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else if (err.errorCode == 'REQUEST_LIMIT_EXCEEDED') {
                throw err;
            } else if (tries < 3) {
                tries++;
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                throw err;
            }
        }
    }
}

DataPacks.prototype.ignoreActivationErrors = async function(dataPackId) {
    var dataPackObj = { Id: dataPackId };

    dataPackObj[this.vlocity.namespacePrefix + 'ActivationStatus__c'] = "";

    await this.vlocity.jsForceConnection.sobject(this.vlocity.namespacePrefix + 'VlocityDataPack__c').update(dataPackObj);
};

DataPacks.prototype.getDataPackData = async function(dataPackId, retry) {
    var self = this;
    try {
        let res = await self.makeApexGetRequest(self.dataPacksEndpoint() + dataPackId);

        var dataPackData = JSON.parse(res);

        if (dataPackData.isChunked) {

            var keysToRetrieveInitial = [];

            // Get all the keys to retrieve as chunks
            dataPackData.dataPacks.forEach(function(dataPack) {
                keysToRetrieveInitial.push(dataPack.VlocityDataPackKey);
            });

            // Empty out the dataPacks Array
            dataPackData.dataPacks = [];

            var dataPackDataInfo = {
                dataPackId: dataPackId,
                allRetrievedData: dataPackData,
                keysToRetrieve: keysToRetrieveInitial,
                retrievedKeys: [],
                retriedKeys: []
            };

            try {
                return await self.getDataPackDataChunked(dataPackDataInfo);
            } catch (e) {
                VlocityUtils.error('Error Retreiving DataPack Chunk', dataPackId, e);
                return { retrieveError: e.message };
            }
        }

        return dataPackData;
    } catch (err) {

        if (!retry || err.code == 'ECONNRESET') {
            VlocityUtils.verbose('Retrying Error');
            return await self.getDataPackData(dataPackId, true);
        } else {
            VlocityUtils.error('Error Retrieving DataPack', dataPackId, err.message);
            return { retrieveError: err.message };
        }
    }
};

DataPacks.prototype.getChunk = async function(chunkInfo) {
    var self = this;
    
    try {
        let chunkUrl = self.dataPacksEndpoint() + chunkInfo.dataPackDataInfo.dataPackId + '?chunks=' + encodeURIComponent(chunkInfo.chunkKey);

        VlocityUtils.verbose('Getting DataPack in Chunks', chunkInfo.chunkKey);

        let res = await self.makeApexGetRequest(chunkUrl);

        try {
            var chunkResult = JSON.parse(res);

            chunkResult.dataPacks.forEach(function(dataPack) {
                chunkInfo.dataPackDataInfo.allRetrievedData.dataPacks.push(dataPack);
            });
        } catch (e) {
            if (chunkInfo.dataPackDataInfo.retriedKeys.indexOf(chunkInfo.chunkKey) == -1) {
                chunkInfo.dataPackDataInfo.retriedKeys.push(chunkInfo.chunkKey);

                await self.getChunk(chunkInfo);
            }
            
            VlocityUtils.error('API Error - Get Chunk', chunkInfo.dataPackDataInfo.dataPackId, chunkInfo.chunkKey, e);
        }
    } catch (err) {
        if (err.code == 'ECONNRESET') {
            await self.getChunk(chunkInfo);
        } else if (err.errorCode == 'REQUEST_LIMIT_EXCEEDED') {
            throw err;
        } else if (chunkInfo.dataPackDataInfo.retriedKeys.indexOf(chunkInfo.chunkKey) == -1) {
            VlocityUtils.error('Retrying API Error - Get Chunk', chunkInfo.dataPackDataInfo.dataPackId, chunkInfo.chunkKey, err);

            chunkInfo.dataPackDataInfo.retriedKeys.push(chunkInfo.chunkKey);

            await self.getChunk(chunkInfo);
        } else {
            VlocityUtils.error('API Error - Get Chunk', chunkInfo.dataPackDataInfo.dataPackId, err);
        }
    }
}

DataPacks.prototype.getDataPackDataChunked = async function(dataPackDataInfo) {
    for (var chunkKey of dataPackDataInfo.keysToRetrieve) {
        await this.getChunk({ chunkKey: chunkKey, dataPackDataInfo: dataPackDataInfo });
    }

    return dataPackDataInfo.allRetrievedData;
};

DataPacks.prototype.getStorageLimitExceededError = function() {
    var self = this;

    return 'Your org\'s Storage has reached Capacity. Please Delete Data. Run "delete [SELECT Id FROM ' + self.vlocity.namespacePrefix + 'VlocityDataPack__c where ' + self.vlocity.namespacePrefix + 'Status__c in (\'InProgress\',\'Complete\', \'Ready\')];" in Anonymous Apex to delete old DataPacks Records';
};

DataPacks.prototype.runDataPackProcess = async function(dataPackData, options) {
    var self = this;

    if (options && dataPackData && dataPackData.processData) {

        Object.keys(options).forEach(function(optionKey){
            dataPackData.processData[optionKey] = options[optionKey];
        });
    }

    var dataPackId = dataPackData.processData.VlocityDataPackId;

    if (!self.vlocity.namespace) {
        // Handle un-namespaced developer orgs
        dataPackData = JSON.parse(JSON.stringify(dataPackData).replace(/%vlocity_namespace%__/g, ''));
    }

    var addDataPackArray = [];
    var allDataPacks = [];

    // This is to workaround a Managed Package code limitation on having the new Product Hierarchy / Pricing not always get seen as already exported.
    var isExportProductDataPack = false;

    if (!dataPackId) {
        if (dataPackData.processType == "Import") {
            dataPackData.processData.VlocityDataPackData.dataPacks.forEach(function(dataPack) {
                if (dataPack.VlocityDataPackRelationshipType == "Pagination") {
                    addDataPackArray.push(dataPack)
                } else {
                    allDataPacks.push(dataPack); 
                }
            });

            dataPackData.processData.VlocityDataPackData.dataPacks = allDataPacks;

        } else if (dataPackData.processType == "Export") {
            dataPackData.processData.VlocityDataPackData.forEach(function(dataPack) {
                if (dataPack.VlocityDataPackRelationshipType == "Children") {
                    addDataPackArray.push(dataPack)
                } else {
                    allDataPacks.push(dataPack); 
                }

                if (dataPack.VlocityDataPackType == "Product2") { 
                    isExportProductDataPack = true;
                }
            });
            
            dataPackData.processData.VlocityDataPackData = allDataPacks;
        }
    }

    while (true) {

        try {

            let result = await self.makeApexPostRequest(self.dataPacksEndpoint(), dataPackData);

            VlocityUtils.verbose('Result', result);

            if (!result) {
                return { VlocityDataPackId: dataPackId, message: 'Transaction Failed', dataPackError: true };
            }

            if (typeof result == "string") {

                try {
                    result = JSON.parse(result);
                } catch (e) {
                    return { VlocityDataPackId: dataPackId, message: result, dataPackError: true };
                }
            }

            if (result 
                && result.Message == 'Data Pack Id Not Found' 
                && dataPackData.processType == 'Delete') {
                    result.Status = 'Deleted';
            }

            if (result && result.Message && result.Message.indexOf('STORAGE_LIMIT_EXCEEDED') != -1) {
                result = { VlocityDataPackId: dataPackId, message: self.getStorageLimitExceededError(), dataPackError: true, storageError: true, Status: 'Error' };

                VlocityUtils.error('Error', result.message);

                return result;
            }

            while (addDataPackArray.length > 0) {
                await self.addDataPack(result.VlocityDataPackId, dataPackData.processType, addDataPackArray.shift());
            } 

            if (result.Total == 0) {
                result.Total = 1;
            }

            if (isExportProductDataPack && (result.Status != "Ready" && result.Status != "Error")) {
                result.Status = "Complete";
            } else if (result.Total > 0 
                && !result.Async 
                && dataPackData.processType == "Export" 
                && result.Status != "Complete"
                && (!options.maxDepth 
                    || options.maxDepth == -1)
                && options.exportPacksMaxSize 
                && result.Total > options.exportPacksMaxSize) {
                    result.Status = "Complete";
            }

            if (result.Total > 0 && result.Async && result.Total == result.Finished) {
                result.Finished--;
            }

            if (result.activationSuccess) {
                result.activationSuccess.forEach(function(activatedEntity) {
                    VlocityUtils.success('Activated', activatedEntity.VlocityDataPackKey);
                });
            }

            if (result.activationError) {
                result.activationError.forEach(function(activatedEntity) {
                    VlocityUtils.error('Activation Error', activatedEntity.VlocityDataPackKey, '---', activatedEntity.ActivationMessage);
                });
            }

            if (/(Ready|InProgress)/.test(result.Status)) {
                dataPackData.processData = result;

                if (result.Async) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            } else {
                return result;
            }        
        } catch (err) {

            VlocityUtils.verbose('Error', err);

            if (err.code == 'ECONNRESET' || err.errorCode == 'ECONNRESET' || (err.errorCode == 'REQUEST_LIMIT_EXCEEDED' && err.message.indexOf('ConcurrentPerOrgLongTxn') == -1)) {
                VlocityUtils.verbose('Retrying Connection Error', err);
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else if (err.errorCode == 'REQUEST_LIMIT_EXCEEDED') {
                throw err;
            }  else {
                err = { VlocityDataPackId: dataPackId, message: err.message ? err.message.trim() : '', code: err.name, dataPackError: true };
                        
                if (dataPackId && self.retried.indexOf(dataPackId) == -1) {
                    self.retried.push(dataPackId);

                    VlocityUtils.error('RETRYING FOR ERROR', dataPackId,  err.code + ':', err.message);
                
                    await self.vlocity.checkLogin();
                } else {
                    VlocityUtils.error('Error', dataPackId, err.code || err.errorCode, ':', err.message);
                    return err;
                }
            }
        }
    }
};

DataPacks.prototype.export = async function(dataPackType, exportData, options) {
    var dataPackData = { 
            processType: 'Export', 
            processData: {
                VlocityDataPackType: dataPackType,
                VlocityDataPackData: exportData
        }
    };

    return await this.runDataPackProcess(dataPackData, options);
};

DataPacks.prototype.import = async function(dataJson, options) {
    var dataPackData = { 
        processType: 'Import', 
        processData: { 'VlocityDataPackData': dataJson }
    };

    return await this.runDataPackProcess(dataPackData, options);
};

DataPacks.prototype.activate = async function(dataPackId, dataPackKeysToActivate, options) {
    var dataPackData = { 
            processType: 'Activate', 
            processData: { 
                'VlocityDataPackId': dataPackId,
                'VlocityDataPackKeysToActivate': dataPackKeysToActivate
         }
    };

    return await this.runDataPackProcess(dataPackData, options);
};

DataPacks.prototype.delete = async function(dataPackId, options) {
    var dataPackData = { 
            processType: 'Delete', 
            processData: { 
                'VlocityDataPackId': dataPackId
         }
    };

    return await this.runDataPackProcess(dataPackData, options);
};

DataPacks.prototype.addDataPack = async function(dataPackId, processType, dataPack, retryCount) {
    
    var self = this;

    var payload = {
        sClassName: this.vlocity.namespace + '.DRDataPackRunnerController.DRDataPackRunnerControllerOpen',
        sMethodName: 'addDataPack',
        input: JSON.stringify({
            dataPackId: dataPackId,
            VlocityDataPackId: dataPackId,
            dataPack: dataPack,
            currentProcess: {
                VlocityDataPackProcess: processType
            }
        })
    };

    VlocityUtils.verbose('Adding DataPack Individually', dataPack.VlocityDataPackKey);

    if (self.vlocity.namespace) {
        payload = JSON.parse(JSON.stringify(payload).replace(/%vlocity_namespace%/g, self.vlocity.namespace));
    }

    try {
        await this.makeApexPostRequest('/' + this.vlocity.namespace + '/v1/invoke/', payload); 
    } catch(err) {
        VlocityUtils.error('Error', 'Failed to Add Children Records to Export', dataPack.VlocityDataPackType, dataPack.VlocityDataPackData.Id ? ('ParentId: ' + dataPack.VlocityDataPackData.Id) : '', err.message ? err.message : '');

        if (!retryCount || retryCount < 3) {
            await self.addDataPack(dataPackId, processType, dataPack, retryCount ? (++retryCount) : 1);
        } else {
            return { Message: 'Failed to Add Children Records to Export ' + dataPack.VlocityDataPackType + ' ' + (dataPack.VlocityDataPackData.Id ? ('ParentId: ' + dataPack.VlocityDataPackData.Id) : '') + ' ' + (err.message ? err.message : '')};
        }
    }
}

