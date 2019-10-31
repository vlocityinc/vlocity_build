var ApexClass = module.exports = function(vlocity) {
    this.vlocity = vlocity;
};

ApexClass.prototype.onAutoExport = function(refObject) {
    if(refObject.jobInfo.includeSalesforceMetadata){
        return 'classes/'+ refObject.currentData.remoteClass + '.cls';
    } else{
        return;
    }
}