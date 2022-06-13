
module.exports = async function(vlocity, currentContextData, jobInfo, callback) {

    let metadataToDataBindings = [{
        metadataQuery: "Select Id, DeveloperName from OmniUiCardConfig",
        dataQuery: "Select Id, Name, AuthorName, VersionNumber from OmniUiCard",
        keyFields: [ "Name", "AuthorName", "VersionNumber" ],
        type: "OmniUiCardConfig"
    },{
        metadataQuery: "Select Id, DeveloperName from OmniScriptConfig",
        dataQuery: "Select Id, Type, SubType, Language, VersionNumber from OmniProcess",
        keyFields: [ "Type", "SubType", "Language", "VersionNumber" ],
        type: "OmniScriptConfig"
    },{
        metadataQuery: "Select Id, DeveloperName from OmniIntegrationProcConfig",
        dataQuery: "Select Id, Type, SubType, Language, VersionNumber from OmniProcess",
        keyFields: [ "Type", "SubType", "Language", "VersionNumber" ],
        type: "OmniIntegrationProcConfig"
    },
    {
        metadataQuery: "Select Id, DeveloperName from OmniDataTransformConfig",
        dataQuery: "Select Id, Name, VersionNumber from OmniDataTransform",
        keyFields: [ "Name", "VersionNumber" ],
        type: "OmniDataTransformConfig"
    }];
    
    try {
        let allMetadataToDelete = [];
        for (let binding of metadataToDataBindings) {
            vlocity.jsForceConnection.version = "54.0";
            let foundMetadataComponents = await vlocity.jsForceConnection.tooling.query(binding.metadataQuery);

            if (foundMetadataComponents.records == 0) {
                continue;
            }

            foundMetadataComponents = foundMetadataComponents.records;

            let foundDataComponents = await vlocity.jsForceConnection.query(binding.dataQuery);

            foundDataComponents = foundDataComponents.records;
            let dataComponentKeys = [];
            
            for (let dataRecord of foundDataComponents) {
                let metadataKey = "";
                
                for (let key of binding.keyFields) {
                    if (metadataKey) {
                        metadataKey += "_";
                    }

                    metadataKey += dataRecord[key];
                }

                dataComponentKeys.push(metadataKey);
            }

            for (let metadataRecord of foundMetadataComponents) {
                if (!dataComponentKeys.includes(metadataRecord.DeveloperName)) {
                    allMetadataToDelete.push(metadataRecord);
                }
            }
        }

        let iterations = 0;

        while (allMetadataToDelete.length > 0 && iterations < 10) {
            iterations++;

            let failedMetadata = [];

            for (let metadataRecord of allMetadataToDelete) {
                try {
                    await vlocity.jsForceConnection.tooling.delete(metadataRecord.attributes.type, metadataRecord.Id);
                    VlocityUtils.log("Delete Success", metadataRecord.DeveloperName);
                } catch (e) {
                    failedMetadata.push(metadataRecord);
                    VlocityUtils.log("Delete Failed", metadataRecord.DeveloperName);
                }
            }

            allMetadataToDelete = failedMetadata;
        }

        
        
    } catch (e) {
        VlocityUtils.error(e);
    }
        
    
}