var jsforce = require('jsforce')

var jsForceConnection = new jsforce.Connection({
  loginUrl: process.argv[4] ? process.argv[4] : 'https://login.salesforce.com'
})

var username = process.argv[2]
var password = process.argv[3]

jsForceConnection.login(username, password, function (err, res) {
  if (err) {
    console.error(err)
    return false
  }

  jsForceConnection.metadata.read('Profile', ['Admin'], function (err, metadata) {
    if (err) { console.error(err) }

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
        console.log('Setting Record Type Visible: ' + recordType.recordType)

        recordType.visible = 'true'

        if (!hasDefault[type]) {
          console.log('Setting Record Type Default: ' + recordType.recordType)
          recordType.default = 'true'
          hasDefault[type] = recordType.recordType
        }

        metadataUpdated.recordTypeVisibilities.push(recordType)
      }
    })

    jsForceConnection.metadata.update('Profile', metadataUpdated, function (err, results) {
      if (err) { console.error(err) }

      console.log('Full Name: ', JSON.stringify(results))
    })
  })
})
