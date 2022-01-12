module.exports = async function (vlocity, currentContextData, jobInfo, callback) {
    var data = {
        "VlocityDataPackData": {
            "useVlocityTriggers": true,
            "status": "Complete",
            "processMultiple": true,
            "primaryDataPackType": "MultiPack",
            "primaryDataPackKey": "DataPackExportList",
            "maxDepth": -1,
            "isChunked": false,
            "ignoreAllErrors": false,
            "forceQueueable": false,
            "forceOldDataModel": null,
            "dataPacks": [
                {
                    "VlocityPrimarySourceId": "a0UR0000000CzoZMAS",
                    "VlocityPreviousPageKey": null,
                    "VlocityMultiPackParentKey": null,
                    "VlocityDepthFromPrimary": 0,
                    "VlocityDataPackType": "AttributeCategory",
                    "VlocityDataPackStatus": "Success",
                    "VlocityDataPackRelationshipType": "Sibling",
                    "VlocityDataPackRecords": [],
                    "VlocityDataPackParents": [],
                    "VlocityDataPackName": "AccountLevel",
                    "VlocityDataPackMessage": null,
                    "VlocityDataPackLabel": "Attribute Category",
                    "VlocityDataPackKey": "1af03fff14f91b92ab76995bff706d83",
                    "VlocityDataPackIsNotSupported": false,
                    "VlocityDataPackIsIncluded": true,
                    "VlocityDataPackData": {
                        "VlocityDataPackRelationshipType": "Sibling",
                        "VlocityDataPackKey": "1af03fff14f91b92ab76995bff706d83",
                        "VlocityDataPackLabel": "Attribute Category",
                        "VlocityDataPackType": "AttributeCategory",
                        "Id": "a0UR0000000CzoZMAS",
                        "%vlocity_namespace%__AttributeCategory__c": [
                            {
                                "Id": "a0UR0000000CzoZMAS",
                                "Name": "AccountLevel",
                                "LastViewedDate": "2021-05-28T08:38:36.000Z",
                                "LastReferencedDate": "2021-05-28T08:38:36.000Z",
                                "%vlocity_namespace%__ApplicableSubType__c": "Profile Attribute",
                                "%vlocity_namespace%__ApplicableTypes__c": "Account",
                                "%vlocity_namespace%__DisplayFilter__c": false,
                                "%vlocity_namespace%__DisplaySequence__c": 4,
                                "%vlocity_namespace%__IsActive__c": true,
                                "%vlocity_namespace%__IsUserAttributesCreatedPrivate__c": false,
                                "%vlocity_namespace%__LockedFlg__c": false,
                                "%vlocity_namespace%__UIControlType__c": "On-Off",
                                "%vlocity_namespace%__Attribute__c": [
                                    {
                                        "Id": "a0VR0000000DAsWMAW",
                                        "Name": "GoldStarAcct",
                                        "%vlocity_namespace%__AttributeCategoryId__c": {
                                            "%vlocity_namespace%__Code__c": null,
                                            "VlocityRecordSObjectType": "%vlocity_namespace%__AttributeCategory__c",
                                            "VlocityDataPackType": "VlocityMatchingKeyObject",
                                            "VlocityMatchingRecordSourceKey": "VlocityRecordSourceKey:a0UR0000000CzoZMAS"
                                        },
                                        "%vlocity_namespace%__ActiveFlg__c": true,
                                        "%vlocity_namespace%__AttributeCategoryName__c": "AccountLevel",
                                        "%vlocity_namespace%__AutoCode__c": "ATTRIBUTE-027",
                                        "%vlocity_namespace%__Code__c": "GoldStarAcct",
                                        "%vlocity_namespace%__Configurable__c": true,
                                        "%vlocity_namespace%__DisplaySequence__c": 1,
                                        "%vlocity_namespace%__ExcludeFromBasketCache__c": false,
                                        "%vlocity_namespace%__Filterable__c": true,
                                        "%vlocity_namespace%__IsCloneable__c": true,
                                        "%vlocity_namespace%__IsPrivate__c": false,
                                        "VlocityRecordSObjectType": "%vlocity_namespace%__Attribute__c",
                                        "VlocityDataPackType": "SObject",
                                        "VlocityRecordSourceKey": "VlocityRecordSourceKey:a0VR0000000DAsWMAW",
                                        "VlocityDataPackIsIncluded": true,
                                        "%vlocity_namespace%__OwnerId__c": "",
                                        "%vlocity_namespace%__UniqueNameField__c": ""
                                    }
                                ],
                                "VlocityRecordSObjectType": "%vlocity_namespace%__AttributeCategory__c",
                                "VlocityDataPackType": "SObject",
                                "VlocityRecordSourceKey": "VlocityRecordSourceKey:a0UR0000000CzoZMAS",
                                "VlocityDataPackIsIncluded": true,
                                "%vlocity_namespace%__ApplicableTypesFilter__c": "",
                                "%vlocity_namespace%__Code__c": "",
                                "%vlocity_namespace%__ColorCode__c": "",
                                "%vlocity_namespace%__Description__c": ""
                            }
                        ],
                        "VlocityDataPackIsIncluded": true
                    },
                    "VlocityDataPackAllRelationships": {
                        "444cc9326165b6aaf32f865dbaac162f": "Reference by Salesforce Id"
                    },
                    "DataPackAttachmentSize": 2929,
                    "DataPackAttachmentParentId": "0ncR0000000019JIAQ",
                    "DataPackAttachmentId": "00PR0000000KegaMAC",
                    "ActivationStatus": "NA"
                }
            ],
            "dataPackId": "0ncR0000000019JIAQ",
            "alreadyExportedKeys": [],
            "name": "AccountLevel",
            "version": 1
        },
        "name": "AccountLevel",
        "version": 1
    };

    var tempData = [JSON.stringify(data).replace(/%vlocity_namespace%/g, vlocity.namespace)];
    VlocityUtils.report('RunningJS');
    var result = await vlocity.datapacksutils.jsRemote(`${vlocity.namespace}.DRDataPackRunnerController`, 'runImport', tempData, `${vlocity.namespace}__DataPacksHome`);
    if (!result[0].result) {
        throw result[0].message;
    }
    VlocityUtils.log(result[0].result);
    tempData = [`{\"VlocityDataPackId\":\"${result[0].result.VlocityDataPackId}\",\"name\":\"AccountLevel\",\"version\":1}`];
    result = await vlocity.datapacksutils.jsRemote(`${vlocity.namespace}.DRDataPackRunnerController`, 'runImport', tempData, `${vlocity.namespace}__DataPacksHome`);
    VlocityUtils.log(result[0].result);
    if (result[0].result.Status !== 'Error') {
        result = await vlocity.datapacksutils.jsRemote(`${vlocity.namespace}.DRDataPackRunnerController`, 'runImport', tempData, `${vlocity.namespace}__DataPacksHome`);
        VlocityUtils.log(result[0].result);
        tempData = [`${result[0].result.VlocityDataPackId}`];
        result = await vlocity.datapacksutils.jsRemote(`${vlocity.namespace}.DRDataPackRunnerController`, 'getAllDataPackData', tempData, `${vlocity.namespace}__DataPacksHome`);
        VlocityUtils.log(result[0].result);
    } else {
        tempData = ['Import', `${result[0].result.VlocityDataPackId}`, [data.VlocityDataPackData.dataPacks[0].VlocityDataPackKey]];
        result = await vlocity.datapacksutils.jsRemote(`${vlocity.namespace}.DRDataPackRunnerController`, 'ignoreErrorForDataPacks', tempData, `${vlocity.namespace}__DataPacksHome`);
        VlocityUtils.log(result[0].result);
    }

    if (result[0].result.Status === 'Complete') {
        VlocityUtils.verbose('DataPack deployed successfully');
    } else {
        VlocityUtils.error('DataPack Deployment Failed');
    }

    if (callback) {
        callback();
    }
}
