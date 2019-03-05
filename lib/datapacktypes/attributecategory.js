var AttributeCategory = module.exports = function(vlocity) {
    this.vlocity = vlocity;
};

AttributeCategory.prototype.onDeployError = async function(inputMap) {
    var jobInfo = inputMap.jobInfo;
    var dataPack = inputMap.dataPack;

    await this.vlocity.datapackserrorhandling.autoFixDeployErrors(jobInfo, dataPack);
};