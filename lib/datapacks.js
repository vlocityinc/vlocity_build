var jsforce = require('jsforce');
var async = require('async');

var DATA_PACKS_REST_RESOURCE = "/v1/VlocityDataPacks/";

var DataPacks = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};
    this.retried = [];
};

DataPacks.prototype.dataPacksEndpoint = function() {
    return (this.vlocity.namespace ? '/' + this.vlocity.namespace : '') + DATA_PACKS_REST_RESOURCE;
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
            
            if (err) { 
                VlocityUtils.error('Error Retreiving DataPack', dataPackId, err.message);
                return callback({ retrieveError: err.message });
            }

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
                    retrievedKeys: []
                };

                try {
                    self.getDataPackDataChunked(dataPackDataInfo, callback);
                } catch (e) {
                    VlocityUtils.error('Error Retreiving DataPack Chunk', dataPackId, e);
                    return callback({ retrieveError: err.message });
                }
            } else {
                callback(dataPackData);
            }
        });
    });
}

DataPacks.prototype.getDataPackDataChunked = function(dataPackDataInfo, callback) {
    var self = this;

    self.vlocity.checkLogin(function() {

        var keyChunks = dataPackDataInfo.keysToRetrieve;
        var CHUNK_CONCURRENCY = 10;

        var q = async.queue(function(chunkKey, qCallback) {

            var chunkedGetURL = self.dataPacksEndpoint() + dataPackDataInfo.dataPackId + '?chunks=' + encodeURIComponent(chunkKey);
            
            self.vlocity.jsForceConnection.apex.get(chunkedGetURL, function(err, res) {
                if (err) { 
                    VlocityUtils.error('API Error - Get Chunk', err);
                    throw err; 
                }

                var chunkResult = JSON.parse(res);

                chunkResult.dataPacks.forEach(function(dataPack) {
                    dataPackDataInfo.allRetrievedData.dataPacks.push(dataPack);
                });

                qCallback();
            });
            
        }, CHUNK_CONCURRENCY);

        q.drain = function() {
            callback(dataPackDataInfo.allRetrievedData);
        }

        q.push(dataPackDataInfo.keysToRetrieve, function (err) {
            if (err) {
                VlocityUtils.error('Error retreiving chunk', err);
            }
        });
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

        if (!self.vlocity.namespace) {
            // Handle un-namespaced developer orgs
            dataPackData = JSON.parse(JSON.stringify(dataPackData).replace(/%vlocity_namespace%__/g, ''));
        }

        self.vlocity.jsForceConnection.apex.post(self.dataPacksEndpoint(), dataPackData, function(err, result) {
            if (err) { 
                VlocityUtils.verbose('Error', result);
                err = { VlocityDataPackId: dataPackId, message: err.message ? err.message.trim() : '', code: err.name, dataPackError: true };
                
                if (dataPackId && self.retried.indexOf(dataPackId) == -1) {
                    self.retried.push(dataPackId);

                    VlocityUtils.error('RETRYING FOR ERROR', dataPackId,  err.code + ':', err.message);
                    
                    self.vlocity.isLoggedIn = false;

                    setTimeout(function() { self.runDataPackProcess(dataPackData, options, onSuccess, onError); }, 1000);
                } else {
                    VlocityUtils.error('Error', dataPackId, err.code, ':', err.message);
                    
                    if (onError) onError(err);
                    else if (onSuccess) onSuccess(err);
                    else throw err;
                }
            } else {
                VlocityUtils.verbose('Result', result);

                if (typeof result == "string") {

                    try {
                        result = JSON.parse(result);
                    } catch (e) {
                        result = { VlocityDataPackId: dataPackId, message: result, dataPackError: true };
                        return onError(result);
                    }
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

