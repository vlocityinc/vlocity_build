module.exports = function(vlocity, dataPackData, jobInfo, callback) {
    delete dataPackData.VlocityDataPackData.Product2[0].PricebookEntry;
    callback();
}