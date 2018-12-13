module.exports = function (vlocity, dataPackData, jobInfo) {
  [ '%vlocity_namespace%__VlocityCard__c',
    '%vlocity_namespace%__VlocityUITemplate__c',
    '%vlocity_namespace%__VlocityUILayout__c' ].forEach(function (SObjectType) {
    if (dataPackData.VlocityDataPackData && dataPackData.VlocityDataPackData[SObjectType]) {
      dataPackData.VlocityDataPackData[SObjectType].forEach(function (dataPack) {
        if (!dataPack['%vlocity_namespace%__Author__c']) {
          dataPack['%vlocity_namespace%__Author__c'] = 'Custom'
        }
      })
    }
  })
}
