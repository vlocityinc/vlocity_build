const VlocityUtils = require('./vlocityutils')

module.exports = function (vlocity, currentContextData, jobInfo, callback) {
  var profiles = jobInfo.AdminProfiles || [ 'Admin' ]

  vlocity.jsForceConnection.metadata.read('Profile', ['Admin'], function (err, metadata) {
    if (err) { VlocityUtils.error(err) }

    var metadataUpdated = {
      'fullName': 'Admin',
      'fieldPermissions': metadata.fieldPermissions,
      'tabVisibilities': [],
      'recordTypeVisibilities': []
    }

    metadataUpdated.fieldPermissions.forEach(function (field) {
      field.editable = 'true'
      field.readable = 'true'
    })

    metadata.tabVisibilities.forEach(function (tab) {
      if (tab.tab.indexOf('__') !== -1) {
        tab.visibility = 'DefaultOn'
        metadataUpdated.tabVisibilities.push(tab)
      }
    })

    var hasDefault = {}

    metadata.recordTypeVisibilities.forEach(function (recordType) {
      var type = recordType.recordType.substring(0, recordType.recordType.indexOf('.'))

      if (recordType.default === 'true') {
        hasDefault[type] = recordType.recordType
      }
    })

    metadata.recordTypeVisibilities.forEach(function (recordType) {
      var type = recordType.recordType.substring(0, recordType.recordType.indexOf('.'))

      if (recordType.recordType.indexOf('MobilePhone') === -1 && recordType.visible === 'false') {
        VlocityUtils.log('Setting Record Type Visible: ' + recordType.recordType)

        recordType.visible = 'true'

        if (!hasDefault[type]) {
          VlocityUtils.log('Setting Record Type Default: ' + recordType.recordType)
          recordType.default = 'true'
          hasDefault[type] = recordType.recordType
        }

        metadataUpdated.recordTypeVisibilities.push(recordType)
      }
    })
    var allUpdatedProfiles = []

    profiles.forEach(function (profileName) {
      var profile = JSON.parse(JSON.stringify(metadataUpdated))

      profile.fullName = profileName

      allUpdatedProfiles.push(profile)
    })

    vlocity.jsForceConnection.metadata.update('Profile', allUpdatedProfiles, function (err, results) {
      if (err) { VlocityUtils.error(err) }

      VlocityUtils.log('Full Name: ', JSON.stringify(results))

      callback()
    })
  })
}
