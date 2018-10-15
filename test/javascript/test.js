
module.exports = function(vlocity, currentContextData, jobInfo, callback) {
    
    VlocityUtils.report('RunningJS');
    if (callback) {
        callback();
    }
}