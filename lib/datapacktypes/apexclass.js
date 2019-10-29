var ApexClass = module.exports = function(vlocity) {
    this.vlocity = vlocity;
};

ApexClass.prototype.onAutoExport = function(remoteData) {
    return 'classes/'+ remoteData.remoteClass + '.cls';
}