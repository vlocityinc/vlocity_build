var jsforce = require('jsforce');

var DATA_PACKS_REST_RESOURCE = "/v1/VlocityDataPacks/";

var DataPacks = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};
    this.retried = [];
};

DataPacks.prototype.dataPacksEndpoint = function() {
    return '/' + this.vlocity.namespace + DATA_PACKS_REST_RESOURCE;
}

DataPacks.prototype.ignoreActivationErrors = function(dataPackId, callback) {
    var dataPackObj = { Id: dataPackId };

    dataPackObj[this.vlocity.namespacePrefix + 'ActivationStatus__c'] = "";

    this.vlocity.jsForceConnection.sobject(this.vlocity.namespacePrefix + 'VlocityDataPack__c').update(dataPackObj, callback);
}

DataPacks.prototype.getAllDataPacks = function(callback) {
    var self = this;

    self.vlocity.checkLogin(function(){
        self.vlocity.jsForceConnection.apex.get(self.dataPacksEndpoint(), function(err, res) {
            if (err) { throw err; }
                callback(JSON.parse(res));
            });
    });
}

DataPacks.prototype.getDataPackData = function(dataPackId, callback) {
    var self = this;

    self.vlocity.checkLogin(function() {
        self.vlocity.jsForceConnection.apex.get(self.dataPacksEndpoint() + dataPackId, function(err, res) {
            if (err) { throw err; }

            var dataPackData = JSON.parse(res);

            if (dataPackData.isChunked) {

                var keysToRetrieveInitial = [];

                // Get all the keys to retrieve as chunks
                dataPackData.dataPacks.forEach(function(dataPack) {
                    keysToRetrieveInitial.push(dataPack.VlocityDataPackKey);
                });

                // Empty out the dataPacks Array
                dataPackData.dataPacks = [];

                var dataPackDataInfoInitial = {
                    dataPackId: dataPackId,
                    allRetrievedData: dataPackData,
                    keysToRetrieve: keysToRetrieveInitial,
                    retrievedKeys: []
                };

                self.getDataPackDataChunked(dataPackDataInfoInitial, null, callback);
            } else {
                callback(dataPackData);
            }
        });
    });
}

DataPacks.prototype.getDataPackDataChunked = function(dataPackDataInfo, chunkResult, callback) {
    var self = this;

    self.vlocity.checkLogin(function() {
         if (chunkResult != null) {
            if (chunkResult.dataPacks) {
                chunkResult.dataPacks.forEach(function(dataPack) {
                    dataPackDataInfo.allRetrievedData.dataPacks.push(dataPack);
                    dataPackDataInfo.retrievedKeys.push(dataPack.VlocityDataPackKey);
                });
            }
        }

        var keysRemaining = [];

        dataPackDataInfo.keysToRetrieve.forEach(function(key) {
            if (dataPackDataInfo.retrievedKeys.indexOf(key) === -1 && keysRemaining.length < 100) {
                keysRemaining.push(key);
            }
        });

        // Finished getting chunks
        if (keysRemaining.length == 0) {
            callback(dataPackDataInfo.allRetrievedData);
        } else {

            // Need to double encode the commas
            var chunkedGetURL = self.dataPacksEndpoint() + dataPackDataInfo.dataPackId + '?chunks=' + keysRemaining.join("%252C");
            
            self.vlocity.jsForceConnection.apex.get(chunkedGetURL, function(err, res) {
                if (err) { throw err; }

                self.getDataPackDataChunked(dataPackDataInfo, JSON.parse(res), callback);
            });
        }   
    });
}

DataPacks.prototype.getErrorsFromDataPack = function(dataPackData, callback) {
    var self = this;
    var errors = [];

    if (dataPackData.errors) {

        var mapOfDataPacks = {};

        dataPackData.dataPacks.forEach(function(dataPack) {
            mapOfDataPacks[dataPack.VlocityDataPackKey] = dataPack;
        });

        Object.keys(dataPackData.errors).forEach(function(dataPackKey) {

            var errorMessage = dataPackData.errors[dataPackKey][0].VlocityDataPackType + ' --- ' + dataPackData.errors[dataPackKey][0].VlocityDataPackName + ' --- ' +dataPackData.errors[dataPackKey][0].VlocityDataPackMessage;

            if (mapOfDataPacks[dataPackKey].VlocityDataPackAllRelationships != null 
                && Object.keys(mapOfDataPacks[dataPackKey].VlocityDataPackAllRelationships).length > 0)
            {
                var listOfRels = '';

                Object.keys(mapOfDataPacks[dataPackKey].VlocityDataPackAllRelationships).forEach(function(parentKey) {

                    if (mapOfDataPacks[parentKey] && mapOfDataPacks[parentKey].VlocityDataPackName) {

                        if (listOfRels != '') {
                            listOfRels += ' | ';
                        }

                        listOfRels += mapOfDataPacks[parentKey].VlocityDataPackName;
                    }
                });

                errorMessage += ' --- Referenced by: ' + listOfRels;
            }

            errors.push(errorMessage);
        });
    }

    callback(errors);
}

DataPacks.prototype.getErrors = function(dataPackId, callback) {
    var self = this;

    self.vlocity.checkLogin(function(){
        self.vlocity.jsForceConnection.apex.get(self.dataPacksEndpoint() + dataPackId, function(err, res) {
            if (err) { throw err; }

            var dataPackData = JSON.parse(res);
            self.getErrorsFromDataPack(dataPackData, callback);
        });
    });
}

DataPacks.prototype.runDataPackProcess = function(dataPackData, options, onSuccess, onError) {
    var self = this;

    if (options && dataPackData && dataPackData.processData) {

        Object.keys(options).forEach(function(optionKey){
            dataPackData.processData[optionKey] = options[optionKey];
        });
    }

    var dataPackId = dataPackData.processData.VlocityDataPackId;

    self.vlocity.checkLogin(function() {
        self.vlocity.jsForceConnection.apex.post(self.dataPacksEndpoint(), dataPackData, function(err, result) {
            if (err) { 
                err = { VlocityDataPackId: dataPackId, message: err.message.trim(), code: err.name, dataPackError: true };
                
                if (dataPackId && self.retried.indexOf(dataPackId) == -1) {
                    self.retried.push(dataPackId);

                    VlocityUtils.error('\x1b[31m', 'RETRYING FOR ERROR >>' ,'\x1b[0m', dataPackId,  err.code + ':', err.message);
                    
                    self.vlocity.isLoggedIn = false;

                    setTimeout(function() { self.runDataPackProcess(dataPackData, options, onSuccess, onError); }, 1000);
                } else {
                    VlocityUtils.error('\x1b[31m', 'ERROR >>' ,'\x1b[0m', dataPackId, err.code, ':', err.message);
                    
                    if (onError) onError(err);
                    else if (onSuccess) onSuccess(err);
                    else throw err;
                }
            } else {
                if (typeof result == "string") {
                   result = JSON.parse(result);
                }

                if (self.vlocity.verbose) { 
                    VlocityUtils.log('Result', result);
                }

                if (result.Total > 0) {
                    if (dataPackData.processType == "Export" 
                        && dataPackData.processData
                        && (!dataPackData.processData.maxDepth 
                            || dataPackData.processData.maxDepth == -1)
                        && dataPackData.processData.exportPacksMaxSize 
                        && result.Finished > dataPackData.processData.exportPacksMaxSize) {
                        result.Status = "Complete";
                    }

                    if (result.Async && result.Total == result.Finished) {
                        result.Finished--;
                    }
                }

                if (result.activationSuccess) {
                    result.activationSuccess.forEach(function(activatedEntity) {
                        VlocityUtils.log('\x1b[32m', 'Activated >>', '\x1b[0m', activatedEntity.VlocityDataPackKey);
                    });
                }

                if (result.activationError) {
                    result.activationError.forEach(function(activatedEntity) {
                        VlocityUtils.log('\x1b[31m', 'Activation Error >>', '\x1b[0m', activatedEntity.VlocityDataPackKey, '---', activatedEntity.ActivationMessage);
                    });
                }
                 
                if (/(Ready|InProgress)/.test(result.Status)) {
                    dataPackData.processData = result;
                    
                    setTimeout(function() { self.runDataPackProcess(dataPackData, options, onSuccess, onError); }, result.Async ? 3000 : 1);
                } else if (/(Complete|Deleted)/.test(result.Status)) {

                    if (onSuccess) onSuccess(result);
                    else VlocityUtils.log(result);
                } else if (/Error/.test(result.Status)) {
                    if (onError) onError(result);
                    else if (onSuccess) onSuccess(result);
                    else VlocityUtils.log(result);
                }
            }
        });
    });
}

DataPacks.prototype.export = function(dataPackType, exportData, options, onSuccess, onError) {
    var dataPackData = { 
            processType: 'Export', 
            processData: {
                VlocityDataPackType: dataPackType,
                VlocityDataPackData: exportData
        }
    };

    this.runDataPackProcess(dataPackData, options, onSuccess, onError);
}

DataPacks.prototype.import = function(dataJson, options, onSuccess, onError) {
    var dataPackData = { 
        processType: 'Import', 
        processData: { 'VlocityDataPackData': dataJson }
    };

    this.runDataPackProcess(dataPackData, options, onSuccess, onError);
}

DataPacks.prototype.activate = function(dataPackId, dataPackKeysToActivate, options, onSuccess, onError) {
    var dataPackData = { 
            processType: 'Activate', 
            processData: { 
                'VlocityDataPackId': dataPackId,
                'VlocityDataPackKeysToActivate': dataPackKeysToActivate
         }
    };

    this.runDataPackProcess(dataPackData, options, onSuccess, onError);
}

DataPacks.prototype.delete = function(dataPackId, options, onSuccess, onError) {
    var dataPackData = { 
            processType: 'Delete', 
            processData: { 
                'VlocityDataPackId': dataPackId
         }
    };

    this.runDataPackProcess(dataPackData, options, onSuccess, onError);
}

