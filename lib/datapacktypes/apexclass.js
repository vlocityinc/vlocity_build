var ApexClass = module.exports = function(vlocity) {
    this.vlocity = vlocity;
};

ApexClass.prototype.onAutoExport = function(refObject) {
    if(refObject.jobInfo.includeSalesforceMetadata && !refObject.currentData.remoteClass.includes("%vlocity_namespace%")){
        return 'classes/'+ refObject.currentData.remoteClass + '.cls';
    }
}