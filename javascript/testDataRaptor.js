const async = require('async')
const VlocityUtils = require('./vlocityutils')

module.exports = function (vlocity, dataPackData, jobInfo, callback) {
  var TOTAL_TO_RUN = 10

  return new Promise(function (resolve, reject) {
    if (dataPackData && dataPackData.VlocityDataPackData && dataPackData.VlocityDataPackData['%vlocity_namespace%__DRBundle__c']) {
      var bundle = dataPackData.VlocityDataPackData['%vlocity_namespace%__DRBundle__c'][0]
      var dataRaptorName = bundle.Name
      var inputType = bundle['%vlocity_namespace%__InputType__c']
      var input

      if (inputType === 'JSON') {
        try {
          input = JSON.parse(bundle['%vlocity_namespace%__SampleInputJSON__c'])
        } catch (e) {
          return callback()
        }
      }

      var body = {
        bundleName: dataRaptorName,
        objectList: input
      }

      async.eachSeries(['false', 'true'], function (isRolledBack, seriesCallback) {
        vlocity.jsForceConnection.query('Select Id from ' + vlocity.namespace + "__GeneralSettings__c WHERE Name = 'RollbackDRChanges' LIMIT 1", function (err, result) {
          result.records[0][vlocity.namespace + '__Value__c'] = isRolledBack

          vlocity.jsForceConnection.sobject(vlocity.namespace + '__GeneralSettings__c').update(result.records[0], function (err, ret) {
            if (err || !ret.success) { return console.error(err, ret) }

            var totalTime = 0
            var totalCpuTime = 0

            async.eachSeries(new Array(TOTAL_TO_RUN), function (item, timingCallback) {
              var currentTime = Date.now()

              vlocity.jsForceConnection.apex.post('/' + vlocity.namespace + '/v2/DataRaptor/', body, function (err, result) {
                if (err) { return VlocityUtils.error(err) }

                var thisTime = (Date.now() - currentTime)

                VlocityUtils.log(dataRaptorName + ' - ' + ((isRolledBack === 'true') ? 'Old' : 'New') + ': ' + result.ACTUAL + ' CPU: ' + result.CPU)

                totalCpuTime += result.CPU
                totalTime += result.ACTUAL

                timingCallback()
              })
            }, function (err, result) {
              VlocityUtils.log(dataRaptorName + ' - Final Total: ' + totalTime + ' Final Avg: ' + (totalTime / TOTAL_TO_RUN) + ' CPU ' + (totalCpuTime / TOTAL_TO_RUN))
              seriesCallback()
            })
          })
        })
      }, function (err, result) {
        callback()
      })
    }
  })
}
