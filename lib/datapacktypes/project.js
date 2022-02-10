var project = module.exports = function (vlocity) {
    this.vlocity = vlocity;
};

// function to validate project items to ensure valid itemId__c
project.prototype.preDeployDataPackCheck = async function (dataObj) {
    let projectItems = dataObj.dataPack.VlocityDataPackData['%vlocity_namespace%__Project__c'][0]['%vlocity_namespace%__ProjectItem__c'];
    if (!projectItems) {
        projectItems = [];
    }
    for (let projectItem of projectItems) {
        if (typeof projectItem['%vlocity_namespace%__ItemId__c'] === 'string' && (projectItem['%vlocity_namespace%__ItemId__c'].length > 18 || projectItem['%vlocity_namespace%__ItemId__c'].includes('%vlocity_namespace%'))) {
            if (dataObj.jobInfo.sourceKeyToRecordId[projectItem['%vlocity_namespace%__ItemId__c']]) {
                projectItem['%vlocity_namespace%__ItemId__c'] = dataObj.jobInfo.sourceKeyToRecordId[projectItem['%vlocity_namespace%__ItemId__c']];
            } else {
                let projectItemType = projectItem['%vlocity_namespace%__ItemType__c'];
                if (projectItemType === 'Test Procedure') {
                    projectItemType = 'Integration Procedure';
                }
                for (const obj of dataObj.jobInfo.queries) {
                    if (obj.VlocityDataPackType === projectItemType.split(" ").join("")) {
                        let query = obj.query.replace(/%vlocity_namespace%__/g, this.vlocity.namespacePrefix);
                        let additionalCondition = '';
                        if (projectItemType === 'Integration Procedure' || projectItemType === 'OmniScript') {
                            let arr = projectItem['%vlocity_namespace%__ItemId__c'].split('/');
                            additionalCondition = `${this.vlocity.namespace}__Type__c = '${arr[1]}' AND ${this.vlocity.namespace}__SubType__c = '${arr[2]}'`;
                        } else {
                            let name = projectItem['%vlocity_namespace%__ItemId__c'].split('/')[1];
                            additionalCondition = `Name = '${name}'`;
                        }

                        query += query.includes('WHERE') ? ` AND ${additionalCondition}` : ` Where ${additionalCondition} `;

                        let results = await this.vlocity.jsForceConnection.query(query);
                        if (results.records[0] && results.records[0].Id) {
                            projectItem['%vlocity_namespace%__ItemId__c'] = results.records[0].Id;
                        } else {
                            projectItem['%vlocity_namespace%__ItemId__c'] = '';
                        }
                        break;
                    }
                }
            }
        }
    }

    //To remove project items which has issue for referenced project items
    projectItems = projectItems.filter(projectItem => {
        return projectItem['%vlocity_namespace%__ItemId__c'];
    });
}

project.prototype.getAdditionalReferences = function (input) {
    let projectItems = input.currentData.VlocityDataPackData['%vlocity_namespace%__Project__c'][0]['%vlocity_namespace%__ProjectItem__c'] || [];
    if (!input.jobInfo.referencedSalesforceMetadata) {
        input.jobInfo.referencedSalesforceMetadata = [];
    }
    var self = this;
    projectItems.forEach(projectItem => {
        let itemKey = projectItem['%vlocity_namespace%__ItemType__c'] + '/' + projectItem.Name;
        if (!Object.keys(self.vlocity.datapacksjob.queryDefinitions).includes(itemKey.split('/')[0])
            && !input.jobInfo.referencedSalesforceMetadata.includes(itemKey)) {
            input.jobInfo.referencedSalesforceMetadata.push(itemKey);
        }
    });
}