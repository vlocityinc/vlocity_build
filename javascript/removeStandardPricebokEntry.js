module.exports = function(vlocity, dataPackData, jobInfo, callback) {

    //console.log(dataPackData);
    delete dataPackData.VlocityDataPackData.Product2[0].PricebookEntry;

   // console.log(JSON.stringify(dataPackData));
    callback();
}