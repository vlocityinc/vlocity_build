Vlocity Build
===============
Vlocity Build is a command line tool to export and deploy Vlocity DataPacks in a source control friendly format through a YAML Manifest describing your project. Its primary goal is to enable Continuous Integration for Vlocity Metadata through source control. It is written as a Node.js module with a Grunt taskrunner.

Installation Instructions
-----------

#### Install Node.js  
Download and Install Node Version 8+ at:  
https://nodejs.org/  

This project will not work with Node Version 6.  

Use `node -v` to find out which version you are on.  

Inside the Git repository you have cloned run the following command:  
```bash   
npm install
grunt
```

If you receive an error related to grunt not existing run the following command:
```bash
npm install -g grunt-cli
```

Getting Started
------------
To begin, fill in the information in the build.properties file, or create your own property file.

sf.username: Salesforce Username  
sf.password: Salesforce Password  
vlocity.namespace: The namespace of the Vlocity Package. vlocity_ins, vlocity_cmt, or vlocity_ps  
vlocity.dataPackJob: The name of the Job being run.  

It is best to not rely on a single build.properties file and instead use named properties files for each org like `build_dev.properties` and `build_uat.properties`
**All commands support "-propertyfile filename.properties"**

#### Basic Grunt Commands
This tool is primarily meant to be used with Grunt.  
https://gruntjs.com/  

Use `grunt --help` to see all commands in the command line.

##### Primary Commands
`packDeploy`: Deploy all contents of a DataPacks Directory  
`packExport`: Export from a Salesforce org into a DataPack Directory  
`packExportSingle`: Export a Single DataPack by Id  

##### Troubleshooting Commands
`packContinue`: Continues a job that failed due to an error  
`packRetry`: Continues a Job retrying all deploy errors or re-running all export queries  

##### Additional Commands
`packGetDiffsAndDeploy`: Deploy only files that are modified compared to the target Org  
`packBuildFile`: Build a DataPacks Directory into a DataPack file   
`packExportAllDefault`: Export all DataPack Types to folders  
`runJavaScript`: Rebuild all DataPacks running JavaScript on each  
`packUpdateSettings`: Refreshes the DataPacks Settings to the version included in this project. Recommended only if you are on the latest Major version of the Vlocity Managed Package  
`runApex`: Runs Anonymous Apex specified in the option -apex in the /apex folder  

##### Running the Process
Grunt commands follow the syntax:  
```bash
grunt packExport
```

All commands support the following primary options:
| Option | Default | Description  | 
| ------ |----- | ------------- | 
| propertyfile | build.properties | The propertyfile used |
| job | none | The Job File used to define the project | 

You can use these properties with the following syntax
```bash
grunt -propertyfile MY_ORG.properties -job JOB_NAME packExport
```

As previously mentioned, it is best to not rely on a single build.properties file and instead use named properties files for each org like `build_dev.properties` and `build_uat.properties`

Additionally, when setting up Job Files you may split the Job definitions into groups of exports by functionality like `CRM.yaml` and `EPC.yaml`

Then the syntax for running grunt would become:
```bash
grunt -propertyfile build_dev.properties -job CRM packExport
grunt -propertyfile build_uat.properties -job CRM packDeploy
```

Setting Up Your Project
------------
Once you have your `build_dev.properties` file setup. You can test that you have successfully setup your project by running:

##### Quick test
```bash
grunt -propertyfile build_dev.properties -job Example packExport
```

This will Export a single DataRaptor and write it to a Local File:  
```
Creating file:  ./example_vlocity_build/DataRaptor/CreateAccount/CreateAccount_DataPack.json
```

##### Export
Once that completes successfully, you could initiate an export of all the data in you org with the following command:

```bash
grunt -propertyfile build_dev.properties -job AllDefault packExport
```

This will export data from the org specified in your `build_dev.properties` file and write it to the folder `example_vlocity_build`  

##### Data Quality
Once Exported it is very important to validate that your data is in state that is ready to be deployed. The Vlocity Build tool primarily relies on unique data in fields across the different objects to prevent duplicate data being uploaded.

##### Deploy
To deploy the data you run the following command.
```bash
grunt -propertyfile build_uat.properties -job AllDefault packDeploy
```

##### Errors
Generally errors will be due to missing or incorrect references to other objects. Often times these missing references will be due to data that is missing the Unique Global Keys that tie reocrds together in the DataPacks system. You can fix missing GlobalKeys by running the following command:
```bash
grunt -propertyfile build_uat.properties runApex AllGlobalKeysBatch.cls
```

However, when you are attempting to migrate data from one org to another where both orgs have missing GlobalKeys, but existing data that should not be duplicated, a different strategy may need to be used to produce GlobalKeys that match between orgs.

##### Validation
Ultimately the best validation for a deploy will be testing the functionality directly in the org. However, another way to see any very clear potential issues is to see if recently deployed data matches exactly what was just exported. 

You can run the following command to check the current local data against the data that exists in the org you deployed to:
```bash
grunt -propertyfile build_uat.properties -job AllDefault packGetDiffs
```

This will provide a list of files that are different locally than in the org. In the future more features will be added to view the actual diffs.

The Job File
------------
The files defining Jobs can be placed in the dataPacksJobs folder or in the folder for your project. They are YAML files which specify what will happen when the job is run. They are similar to a Salesforce package.xml file, however they also contain additional options for the job when it is run.  

#### dataPacksJobs/Example.yaml  
```yaml
projectPath: ./example_vlocity_build 
expansionPath: datapacks
queries: 
  - VlocityDataPackType: DataRaptor 
    query: Select Id from %vlocity_namespace%__DRBundle__c LIMIT 1
```

This file would be run with the following command:  
```bash
grunt -job Example packExport
```

It will Export a single DataRaptor and write it to a Local File:  
```
 Creating file:  ./example_vlocity_build/DataRaptor/CreateAccount/CreateAccount_DataPack.json
```

Additionally, all the default queries can be found in the file dataPacksJobs/QueryDefinitions.yaml and can be referenced in the Job File with the syntax shown in the next example.

#### dataPacksJobs/AllDefault.yaml
This is a much more complex example file with all the currently recommended default settings. It includes running Anonymous Apex code before and after certain deploy steps. The details of each setting are explained later on in this documentation.
```yaml
projectPath: ./example_vlocity_build
expansionPath: .
buildFile: AllDataPacks.resource
preStepApex:
  Deploy: 
    VlocityUITemplate: DeactivateTemplatesAndLayouts.cls
    VlocityUILayout: DeactivateTemplatesAndLayouts.cls
postStepApex:
  Deploy: 
    Product2: EPCProductJSONUpdate.cls      
queries:
  - AttributeAssignmentRule
  - AttributeCategory
  - CalculationMatrix
  - ContextAction
  - ContextDimension
  - ContextScope
  - ContractType
  - DataRaptor
  - DocumentClause
  - DocumentTemplate
  - EntityFilter
  - IntegrationProcedure
  - ItemImplementation
  - ManualQueue
  - ObjectClass
  - ObjectContextRule
  - ObjectLayout
  - OmniScript
  - OrchestrationDependencyDefinition
  - OrchestrationItemDefinition
  - OrchestrationPlanDefinition
  - PriceList
  - Pricebook2
  - PricingVariable
  - Promotion
  - QueryBuilder
  - Rule
  - StoryObjectConfiguration
  - System
  - TimePlan
  - TimePolicy
  - UIFacet
  - UISection
  - VlocityAction
  - VlocityFunction
  - VlocityPicklist
  - VlocitySearchWidgetSetup
  - VlocityStateModel
  - VlocityUILayout
  - VlocityUITemplate
  - VqMachine
  - VqResource
delete: true
activate: true
compileOnBuild: true
maxDepth: -1
continueAfterError: true
defaultMaxParallel: 10
exportPacksMaxSize: 10
useAllRelationships: false
supportHeadersOnly: true
supportForceDeploy: true
```

DataPack Job Files Additional Details
------------

**For a full example file with notes see dataPacksJobs/ReadMeExample.yaml**

#### Settings 
##### Basic  
```yaml
projectPath: ../my-project # Where the project will be contained. Use . for this folder. The Path is always relative to the vlocity_build folder, not this yaml file
expansionPath: datapack-expanded # The Path relative to the projectPath to insert the expanded files. Also known as the DataPack Directory in this Doecumentation
```

##### Export 
Exports can be setup as a series of queries or a manifest. 

##### Export by Queries
Queries support full SOQL to get an Id for each DataPackType. You can have any number of queries in your export. SOQL Queries can use %vlocity_namespace%__ to be namespace independent or the namespace of your Vlocity Package can be used.

```yaml
queries:
  - VlocityDataPackType: VlocityUITemplate
    query: Select Id from %vlocity_namespace%__VlocityUITemplate__c where Name LIKE 'campaign%'
```    

**Export by Queries is the recommened approach for defining your Project**

##### Export by Manifest
The manifest defines the Data used to export. Not all types will support using a manifest as many types are only unique by their Id. VlocityDataPackTypes that are unique by name will work for manifest. These are limited to: DataRaptor, VlocityUITemplate, VlocityCard, 

```yaml
manifest: 
  VlocityCard:
    - Campaign-Story 
  OmniScript: 
    - Type: Insurance 
      Sub Type: Billing 
      Language: English
```

**Due to the limitation that not all DataPackTypes support the manifest format. It is best to use the Export by Queries syntax**

##### Export Results 
The primary use of this tool is to write the results of the Export to the local folders at the expansionPath. There is a large amount of post processing to make the results from Salesforce as Version Control friendly as possible. 

Additionally, an Export Build File can be created as part of an Export. It is a single file with all of the exported DataPack Data in it with no post processing. 
```yaml
exportBuildFile: AllDataPacksExported.json
```
This file is not Importable to a Salesforce Org through the DataPacks API, but could be used to see the full raw output from a Salesforce Org. Instead, use the BuildFile task to create an Importable file.

##### BuildFile  
This specifies a File to create from the DataPack Directory. It could then be uploaded through the DataPacks UI in a Salesforce Org.
```yaml
buildFile: ProductInfoPhase3.json 
```

##### Export Single
You can export a single DataPack and all its dependencies with packExportSingle. It also supports only exporting the single DataPack with no dependencies by setting the depth.
```bash
grunt -job JOB_NAME packExportSingle -type DATA_PACK_TYPE -id SALESFORCE_ID -depth MAX_DEPTH
```
Max Depth is optional and a value of 0 will only export the single DataPack. Max Depth of 1 will export the single DataPack along with its first level depedencies.

##### Anonymous Apex  
You can run Anonymous Apex before and After a Job by job type and before each step of a Deploy. Available types are Import, Export, Deploy, BuildFile, and ExpandFile. Apex files live in vlocity_build/apex. You can include multiple Apex files with "//include FileName.cls;" in your .cls file.

```yaml
preJobApex:
  Deploy: DeactivateTemplatesAndLayouts.cls  
```

With this setting, the Apex Code in DeativateTemplatesAndLayouts.cls will run before the deploy to the org. In this case it will Deactivate the Vlocity Templates and Vlocity UI Layouts (Cards) associated with the Deploy. See Advanced Anonymous Apex for more details.

##### Additional Options 
The Job file additionally supports some Vlocity Build based options and the options available to the DataPacks API.

##### Vlocity Build 
| Option | Description | Type  | Default |
| ------------- |------------- |----- | -----|
| compileOnBuild  | Compiled files will not be generated as part of this Export. Primarily applies to SASS files currently | Boolean | false |
| manifestOnly | If true, an Export job will only save items specifically listed in the manifest |   Boolean | false |
| delete | Delete the VlocityDataPack__c file on finish   |    Boolean | true |
| activate | Will Activate everything after it is imported / deployed | Boolean | false |
| maximumDeployCount | The maximum number of items in a single Deploy. Setting this to 1 combined with using preStepApex can allow Deploys that act against a single DataPack at a time | Integer | 1000
| defaultMaxParallel | The number of parallel processes to use for export | Integer | 1
| exportPacksMaxSize | Split DataPack export once it reaches this threshold | Integer | null | 
| continueAfterError | Don't end grunt job on error | Boolean | false |
| supportForceDeploy | Attempt to deploy DataPacks which have not had all their parents successfully deployed | Boolean | false |
| supportHeadersOnly | Attempt to deploy a subset of data for certain DataPack types to prevent blocking due to Parent failures | Boolean | false |
| addSourceKeys | Generate Global / Unique Keys for Records that are missing this data. Improves ability to import exported data | Boolean | false |
| useAllRelationships | Determines whether or not to store the _AllRelations.json file which may not generate consistently enough for Version Control. Recommended to set to false. | Boolean | true |

##### DataPacks API
| Option | Description | Type  | Default |
| ------------- |------------- |----- | -----|
| ignoreAllErrors | Ignore Errors during Job | Boolean | false |
| maxDepth | The max distance of Parent or Children Relationships from initial data being exported | Integer | -1 |
| processMultiple | When false each Export or Import will run individually | Boolean | true |

Supported DataPack Types
-----------------------
These types are what would be specified when creating a Query or Manifest for the Job. 

#### Supported for General Audiences
| VlocityDataPackType | SObject | Label |
| ------------- |-------------| ----- | 
| Attachment | Attachment | Attachment | 
| AttributeAssignmentRule | AttributeAssignmentRule__c | Attribute Assignment Rule | 
| AttributeCategory | AttributeCategory__c | Attribute Category | 
| CalculationMatrix | CalculationMatrix__c | Calculation Matrix | 
| CalculationProcedure | CalculationProcedure__c | Calculation Procedure | 
| ContextAction | ContextAction__c | Context Action | 
| ContextDimension | ContextDimension__c | Vlocity Context Dimension | 
| ContextScope | ContextScope__c | Context Scope | 
| ContractType | ContractType__c | Contract Type | 
| DataRaptor | DRBundle__c | DataRaptor Interface | 
| Document | Document | Document (Salesforce Standard Object) | 
| DocumentClause | DocumentClause__c | Document Clause | 
| DocumentTemplate | DocumentTemplate__c | Document Template | 
| EntityFilter | EntityFilter__c | Entity Filter | 
| ItemImplementation | ItemImplementation__c | Item Implementation | 
| ManualQueue | ManualQueue__c | Manual Queue | 
| ObjectClass | ObjectClass__c | Object Layout | 
| ObjectContextRule | ObjectRuleAssignment__c | Vlocity Object Rule Assignment | 
| ObjectLayout | ObjectLayout__c | Object Layout | 
| OmniScript | OmniScript__c | OmniScript | 
| OrchestrationDependencyDefinition | OrchestrationDependencyDefinition__c | Orchestration Dependency Definition | 
| OrchestrationItemDefinition | OrchestrationItemDefinition__c | Orchestration Item Definition | 
| OrchestrationPlanDefinition | OrchestrationPlanDefinition__c | OrchestrationPlanDefinition__c | 
| Pricebook2 | Pricebook2 | Pricebook (Salesforce Standard Object) | 
| PriceList | PriceList__c | Price List | 
| PricingVariable | PricingVariable__c | Pricing Variable | 
| Product2 | Product2 | Product (Salesforce Standard Object) | 
| Promotion | Promotion__c | Promotion | 
| QueryBuilder | QueryBuilder__c | Query Builder | 
| Rule | Rule__c | Rule | 
| StoryObjectConfiguration | StoryObjectConfiguration__c | Story Object Configuration (Custom Setting) | 
| System | System__c | System | 
| TimePlan | TimePlan__c | Time Plan | 
| TimePolicy | TimePolicy__c | Time Policy | 
| UIFacet | UIFacte__c | UI Facet | 
| UISection | UISection__c | UI Section | 
| VlocityAction | VlocityAction__c | Vlocity Action | 
| VlocityAttachment | VlocityAttachment__c | Vlocity Attachment | 
| VlocityCard | VlocityCard__c | Vlocity Card | 
| VlocityFunction | VlocityFunction__c | Vlocity Function | 
| VlocityPicklist | Picklist__c | Vlocity Picklist | 
| VlocitySearchWidgetSetup | VlocitySearchWidgetSetup__c | Vlocity Interaction Launcher | 
| VlocityStateModel | VlocityStateModel__c | Vlocity State Model | 
| VlocityUILayout | VlocityUILayout__c | Vlocity UI Layout | 
| VlocityUITemplate | VlocityUITemplate__c | Vlocity UI Template | 
| VqMachine | VqMachine__c | Vlocity Intelligence Machine | 
| VqResource | VqResource__c | Vlocity Intelligence Resource | 

Advanced Anonymous Apex
---------------------
In order to make the Anonymous Apex part reusable, you can include multiple Apex files with "//include FileName.cls;" in your .cls file. This allows you to write Utility files that can be reused. The BaseUtilities.cls file includes an additional feature that will send the data as a JSON to your Anonymous Apex.

#### Namespace
In Anonymous apex vlocity_namespace will be replaced with the vlocity.namespace from the propertyfile.

#### BaseUtilities.cls 
```java
List<Object> dataSetObjects = (List<Object>)JSON.deserializeUntyped('CURRENT_DATA_PACKS_CONTEXT_DATA');

List<Map<String, Object>> dataPackDataSet = new List<Map<String, Object>>();

for (Object obj : dataSetObjects)
{
  if (obj != null)
  {
    dataPackDataSet.add((Map<String, Object>)obj);
  }
}
```
The token CURRENT_DATA_PACKS_CONTEXT_DATA will be replaced with JSON data and converted into a List<Map<String, Object>> with data depending on the type of setting and type of job being run.

#### PreJobApex
Pre Job Apex can run Anonymous Apex before the DataPack Job starts. While it is possible to use the CURRENT_DATA_PACKS_CONTEXT_DATA described above, for large projects it will be over the 32000 character limit for Anonymous Apex. 

#### preJobApex vs preStepApex
preStepApex will send only the DataPack context data for the currently running API call. For Deploys, this means that instead of Deactivating all Templates and Layouts for an entire project before beginning a full deploy, using the same provided DeactivateTemplatesAndLayouts.cls as preStepApex, the target Salesforce Org will be minimally impacted as each Template or Card will only be Deactivated while it is being deployed. Best when combined with the maximumDeployCount of 1. 

postStepApex can be used to run any compilation steps in Apex that are not automatically run inside triggers. EPCProductJSONUpdate.cls is recommended to be run when Deploying Products.

##### Export by Manifest
If Exporting with a Manifest, each JSON Object will be one entry in the Manifest in the form of:
```yaml
manifest:
  VlocityCard: 
    - Campaign-Story 
```
```json
{
    "VlocityDataPackType": "VlocityCard",
    "Id": "Campaign-Story"
}
```
"Id" is the default JSON key in the Manifest, but Manifests also support YAML Key/Value pair syntax:
```yaml
manifest: 
  OmniScript: 
    - Type: Insurance 
      SubType: Billing
      Language: English
```
Which becomes:
```json
{
    "VlocityDataPackType": "VlocityCard",
    "Type": "Insurance",
    "SubType": "Billing",
    "Language": "English"
}
```
##### Export by Queries
For a Query, each result from the Query will be a JSON Object with the appropriate DataPack Type.
```yaml
queries: 
  - VlocityDataPackType: VlocityUITemplate 
    query: Select Id from %vlocity_namespace%__VlocityUITemplate__c where Name LIKE 'campaign%' # SOQL 
```
Becomes:
```json
{
    "VlocityDataPackType": "VlocityUITemplate",
    "Id": "01r61000000DeTeAAN",
}
```
##### Deploy
Before a Deploy, each JSON Object will be a small amount of information about the Object. By default it is the Name of the Object. For a VlocityUILayout it would be:
```json
{
    "VlocityDataPackType": "VlocityUILayout",
    "Name": "Campaign-Story"
}
```
In the DeactivateTemplatesAndLayouts.cls this Name is used to Deactivate the Layouts that are pending for Deploy.
#### PostJobApex Replacement Format
Post Job Apex runs after the Job completes successfully.
##### Deploy
After a Deploy the Ids of every record deployed will be in the JSON Object List. This may be too much data for Anonymous Apex for large deploys.
```json
{
    "Id": "01r61000000DeTeAAN"
}
```
