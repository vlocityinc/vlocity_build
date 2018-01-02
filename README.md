# Vlocity Build
--------

Vlocity Build is a command line tool to export and deploy Vlocity DataPacks in a source control friendly format through a YAML Manifest describing your project. Its primary goal is to enable Continuous Integration for Vlocity Metadata through source control. It is written as a Node.js Command Line Tool.

### Table of Contents
* [Installation Instructions](#installation-instructions)
* [Getting Started](#getting-started)
* [Step by Step Guide](#step-by-step-guide)
    * [Export](#export)
    * [Deploy](#deploy)
* [The Job File](#the-job-file)
  * [Example Job File](#example-job-file)
* [Troubleshooting](#troubleshooting)
* [All Commands](#all-commands)
  * [Example Commands](#example-commands)
* [Advanced Job File Settings](#advanced-job-file-settings)
* [Supported DataPack Types](#supported-datapack-types)
* [Advanced](#advanced)

# Installation Instructions
-----------

#### Install Node.js  
Download and Install Node at:  
https://nodejs.org/  

This project requires Node Version 8+.  

Use `node -v` to find out which version you are on.  

Inside the Git repository you have cloned run the following command:  
```bash   
npm install
npm link
vlocity help
```

This should show a list of all available commands confirming that the project has been setup successfully.

Getting Started
------------
To begin, create your own property files for your Source and Target Salesforce Orgs with the following:
```java
sf.username: <Salesforce Username>  
sf.password: <Salesforce Password>  
```

It is best to not rely on a single build.properties file and instead use named properties files for each org like `build_source.properties` and `build_target.properties`

##### Running the Process
Commands follow the syntax:  
```bash
vlocity packExport -propertyfile <filepath> -job <filepath>
```
#### Property File
The propertyfile is used to provide the credentials of the org you will connect to. It will default to build.properties if no file is specified.

#### Job File
The Job File used to define the project location and the various settings for running a DataPacks Export / Deploy.

Step by Step Guide
------------
Once you have your `build_source.properties` file setup, you can get started with mirgation with the following: 

##### Export
Example.yaml shows the most Simple Job File that can be used to setup a project:
```yaml
projectPath: ./example_vlocity_build 
queries: 
  - VlocityDataPackType: DataRaptor 
    query: Select Id from %vlocity_namespace%__DRBundle__c where Name = 'DataRaptor Migration' LIMIT 1
```

Run the following command to export this Job File:
```bash
vlocity -propertyfile build_source.properties -job dataPacksJobs/Example.yaml packExport
```

Which will produce the following output:
```
Salesforce Org >> source_org@vlocity.com  
VlocityDataPackType >>DataRaptor  
Query >> Select Id from vlocity_cmt__DRBundle__c where Name = 'DataRaptor Migration' LIMIT 1  
Records >> 1  
Query Total >> 1  
Initializing Project  
Exporting >> DataRaptor a191N000012pxsYQAQ  
Creating file >> example_vlocity_build/DataRaptor/DataRaptor-Migration/DataRaptor-Migration_DataPack.json  
Salesforce Org >> source_org@vlocity.com   
Current Status >> Export    
Successful >> 1  
Errors >> 0  
Remaining >> 0  
Elapsed Time >> 0m 5s  
Salesforce Org >> source_org@vlocity.com    
Export success:  
1 Completed  
```

This has exported data from the org specified in your `build_source.properties` file and written it to the folder `example_vlocity_build` specified in the `Example.yaml` file found at `dataPacksJobs/Example.yaml`

##### Deploy
To deploy the data you just exported run the following command:  
```bash
vlocity -propertyfile build_target.properties -job Example.yaml packDeploy
```

Which will produce the following output:
```
Salesforce Org >> target_org@vlocity.com  
Current Status >> Deploy   
Adding to Deploy >> DataRaptor/DataRaptor Migration - DataRaptor-Migration
Deploy Success >> DataRaptor/DataRaptor Migration - DataRaptor-Migration
Salesforce Org >> target_org@vlocity.com   
Current Status >> Deploy    
Successful >> 1  
Errors >> 0  
Remaining >> 0  
Elapsed Time >> 0m 4s  
Salesforce Org >> target_org@vlocity.com   
```

The Job File
------------
A Job File is similar to a Salesforce package.xml file, however it also includes runtime options like the maximum number of concurrent API calls running.   

**The Default Job Settings will automatically be used if not explicitly specified in your file, and it is best to not add settings to the file unless you want to change them from the defaults.**

The Job File's primary settings that you should define is specifying the folder that you would like to use to contain your project.  
```yaml
projectPath: ../myprojectPath 
```

The projectPath can be the absolute path to a folder or the relative path from where you run the vlocity command.  

#### What will be Exported?
By default, all data will be exported from the org when running the `packExport` command. To narrow the exported data, you can define any Salesforce SOQL query that returns the Id of records you would like to export. 
```yaml
queries: 
  - VlocityDataPackType: DataRaptor 
    query: Select Id from %vlocity_namespace%__DRBundle__c where Name LIKE '%Migration' LIMIT 1
```

This query will export a DataRaptor Vlocity DataPack by querying the SObject table for DataRaptor "DRBundle__c" and even supports the "LIMIT 1" and "LIKE" syntax. 

### Example Job File
#### dataPacksJobs/Example.yaml  
```yaml
projectPath: ./example_vlocity_build 
queries: 
  - VlocityDataPackType: DataRaptor 
    query: Select Id from %vlocity_namespace%__DRBundle__c LIMIT 1
```

When creating your own Job File, the **only** setting that is very important is the projectPath which specifies where the DataPacks files will be written.

All other settings will use the Default Project Settings.  

By Default, all DataPack Types will be Exported when running packExport, so to override the Export data, it is possible to use predefined queries, or write your own.

#### Predefined vs Explicit Queries
Vlocity has defined full queries for all Supported DataPack Types which will export all currently Active Vlocity Metadata. **This is the most simple way to define your own Job File queries.**

To Export All DataRaptors and OmniScripts from the Org use: 
```yaml
projectPath: ./myprojectPath    
queries:
  - DataRaptor
  - OmniScript
```
This predefined syntax is defined in dataPacksJobs/QueryDeifnitions.yaml and will load the following explicit queries:
```yaml
queries:
  - VlocityDataPackType: DataRaptor
    query: Select Id, Name from %vlocity_namespace%__DRBundle__c where %vlocity_namespace%__Type__c != 'Migration'
  - VlocityDataPackType: OmniScript
    query: Select Id, %vlocity_namespace%__Type__c,  %vlocity_namespace%__SubType__c, %vlocity_namespace%__Language__c from %vlocity_namespace%__OmniScript__c where %vlocity_namespace%__IsActive__c
    = true AND %vlocity_namespace%__IsProcedure__c = false
```

The WHERE clauses show that these Queries will Export all DataRaptors that are not internal Vlocity Configuration Data and all Active OmniScripts.

When Exporting, the DataPacks API will additionally export all dependencies of the Vlocity DataPacks which are being exported. So Exporting just the OmniScripts from an Org will also bring in all referenced DataRaptors, VlocityUITemplates, etc, so that the OmniScript will be fully usable once deployed.

#### Query All
Running `packExport` with no queries defined in your Job File will export all the predefined queries for each type. If you do have some special queires defined, you can also run: `packExportAllDefault` to specify running all the default queries.

# Troubleshooting
------------

##### Data Quality
Once Exported it is very important to validate that your data is in state that is ready to be deployed. The Vlocity Build tool primarily relies on unique data in fields across the different objects to prevent duplicate data being uploaded.

##### Errors
Generally errors will be due to missing or incorrect references to other objects. 
```
Error >> DataRaptor --- GetProducts --- Not Found
Error >> VlocityUITemplate --- ShowProducts --- Not Found
```

This "VlocityUITemplate --- ShowProducts --- Not Found" error during Export means that something, likely an OmniScript, has a reference to a VlocityUITemplate that is not currently Active or does not exist in the org as a VlocityUITemplate. In some cases the VlocityUITemplate for an OmniScript can actually be included inside the Visualforce Page in which the OmniScript is displayed. In that case, this error can be completely ignored. The DataRaptor Not Found means that likely someone deleted or changed the name of the DataRaptor being referenced without updating the OmniScript using it.

Errors occurring during Export will likely result in Errors during deploy. But not always. Errors during Deploy will occur when a Salesforce Id reference is not found in the target system:
```
Deploy Error >> Product2/02d3feaf-a390-2f57-a08c-2bfc3f9b7333 --- iPhone --- No match found for vlocity_cmt__ProductChildItem__c.vlocity_cmt__ChildProductId__c - vlocity_cmt__GlobalKey__c=db65c1c5-ada4-7952-6aa5-8a6b2455ea02
```

In this Error the Product being deployed is the iPhone with Global Key `02d3feaf-a390-2f57-a08c-2bfc3f9b7333` and the error is stating that one of the Product Child Items could not find the referenced product with Global Key `db65c1c5-ada4-7952-6aa5-8a6b2455ea02`. This means the other Product must also be deployed. 

Additionally, Deploys will run all of the Triggers associated with Objects during their import. As their are various rules across the Vlocity Data Model, sometimes errors will occur due to attempts to create what is considered "bad data". These issues must be fixed on a case by case basis.

##### Cleaning Bad Data
This tool includes a script to help find and eliminate "bad data". It can be run with the following command:
```bash
vlocity -propertyfile <propertyfile> -job <job> runJavaScript -js cleanData.js
```

This will run Node.js script that Adds Global Keys to all SObjects missing them, and deletes a number of Stale data records that are missing data to make them useful. 

##### External Ids and Global Keys 
Most objects being deployed have a field or set of fields used to find unique records like an External Id in Salesforce. For many Vocity Objects this is the Global Key field. If a Deploy finds 1 object matching the Global Key then it will overwrite that object during deploy. If it finds more than 1 then it will throw an error:
```
Deploy Error >> Product2/02d3feaf-a390-2f57-a08c-2bfc3f9b7333 --- iPhone --- Duplicate Results found for Product2 WHERE vlocity_cmt__GlobalKey__c=02d3feaf-a390-2f57-a08c-2bfc3f9b7333 - Related Ids: 01t1I000001ON3qQAG,01t1I000001ON3xQAG
```

This means that Duplicates have been created in the org and the data must be cleaned up. 

While there are protections against missing or duplicate Global Keys the logic is often in triggers which may have at points been switched off, and sometimes applies to data that may have existed before the Vlocity Package was installed. 

You can fix missing GlobalKeys by running the following command which will start a set of Batch Jobs to add Global Keys to any Objects which are missing them:
```bash
vlocity -propertyfile <propertyfile> -job <job> runApex -apex AllGlobalKeysBatch.cls
```

However, when you are attempting to migrate data from one org to another where both orgs have missing GlobalKeys, but existing data that should not be duplicated, a different strategy may need to be used to produce GlobalKeys that match between orgs.

##### Validation
Ultimately the best validation for a deploy will be testing the functionality directly in the org. However, another way to see any very clear potential issues is to see if recently deployed data matches exactly what was just exported. 

You can run the following command to check the current local data against the data that exists in the org you deployed to:
```bash
vlocity -propertyfile build_uat.properties -job Example.yaml packGetDiffs
```

This will provide a list of files that are different locally than in the org. In the future more features will be added to view the actual diffs.

# All Commands
-----------

##### Primary  
`packExport`: Export from a Salesforce org into a DataPack Directory  
`packExportSingle`: Export a Single DataPack by Id  
`packExportAllDefault`: Export All Default DataPacks as listed in Supported Types Table  
`packDeploy`: Deploy all contents of a DataPacks Directory  

##### Troubleshooting 
`packContinue`: Continues a job that failed due to an error  
`packRetry`: Continues a Job retrying all deploy errors or re-running all export queries  

##### Additional 
`packGetDiffsAndDeploy`: Deploy only files that are modified compared to the target Org
`packGetDiffs`: Find all Diffs in Org Compared to Local Files   
`packBuildFile`: Build a DataPacks Directory into a DataPack file   
`runJavaScript`: Rebuild all DataPacks running JavaScript on each or run a Node.js Script   
`packUpdateSettings`: Refreshes the DataPacks Settings to the version included in this project. Recommended only if you are on the latest Major version of the Vlocity Managed Package  
`runApex`: Runs Anonymous Apex specified in the option -apex at the specified path or in the /apex folder  
`packGetAllAvailableExports`: Get list of all DataPacks that can be exported  
`refreshVlocityBase`: Deploy and Activate the Base Vlocity DataPacks included in the Managed Package  

### Example Commands

##### packExport
`packExport` a will retrieve all Vlocity Metadata from the org as Vlocity DataPacks as defined in the Job File and write them to the local file system in a Version Control friendly format.   
```bash
vlocity -propertyfile <filepath> -job <filepath> packExport
```

##### packExportSingle
`packExportSingle` will export a single DataPack and all its dependencies. It also supports only exporting the single DataPack with no dependencies by setting the depth.  
```bash
vlocity -propertyfile <filepath> -job <filepath> packExportSingle -type <VlcoityDataPackType> -id <Salesforce Id> -depth <Integer>
```

Max Depth is optional and a value of 0 will only export the single DataPack. Max Depth of 1 will export the single DataPack along with its first level depedencies.

##### packExportAllDefault
`packExportAllDefault` will retrieve all Vlocity Metadata instead of using the Job File definition.  
```bash
vlocity -propertyfile <filepath> -job <filepath> packExportAllDefault
```

##### packDeploy
`packDeploy` will deploy all contents in the projectPath of the Job File to the Salesforce Org.  
```bash
vlocity -propertyfile <filepath> -job <filepath> packDeploy
```

##### packContinue
`packContinue` can be used to resume the job that was running before being cancelled or if there was an unexpected error. It will work for Export or Deploy.
```bash
vlocity -propertyfile <filepath> -job <filepath> packContinue
```

##### packRetry
`packRetry` can be used to restart the job that was previously running and will additionally set all Errors back to Ready to deployed again.  
```bash
vlocity -propertyfile <filepath> -job <filepath> packRetry
```

##### packGetDiffs
`packGetDiffs` will provide a list of files that are different locally than in the org. In the future more features will be added to view the actual diffs.
```bash
vlocity -propertyfile <filepath> -job <filepath> packGetDiffs
```

##### packGetDiffsAndDeploy
`packGetDiffsAndDeploy` will first find all files that are different locally than in the target Org, and then will deploy only the DataPacks that have changed or are new. 
```bash
vlocity -propertyfile <filepath> -job <filepath> packGetDiffsAndDeploy
```
While this may take longer than doing an actual deploy, it is a great way to ensure that you are not updating items in your org more than necessary.

## Advanced Job File Settings
------------
The Job File has a number of additonal runtime settings that can be used to define your project and aid in making Exports / Deploys run successfully. However, the Default settings should only be modified to account for unique issues in your Org. 

##### Basic  
```yaml
projectPath: ../my-project # Where the project will be contained. Use . for this folder. The Path is always relative to where you are running the vlocity command, not this yaml file
expansionPath: datapack-expanded # The Path relative to the projectPath to insert the expanded files. Also known as the DataPack Directory in this Doecumentation
```

##### Export 
Exports can be setup as a series of queries or a manifest. 

##### Export by Queries
Queries support full SOQL to get an Id for each DataPackType. You can have any number of queries in your export. SOQL Queries can use %vlocity_namespace%__ to be namespace independent or the namespace of your Vlocity Package can be used.
```yaml
queries:
  - DataRaptor
  - VlocityDataPackType: VlocityUITemplate
    query: Select Id from %vlocity_namespace%__VlocityUITemplate__c where Name LIKE 'campaign%'
```    

**Export by Predefined Queries is the recommened approach for defining your Project and you can mix the predefined and explicit queries as shown above**

##### Export Results 
The primary use of this tool is to write the results of the Export to the local folders at the expansionPath. There is a large amount of post processing to make the results from Salesforce as Version Control friendly as possible. 

Additionally, an Export Build File can be created as part of an Export. It is a single file with all of the exported DataPack Data in it with no post processing. 
```yaml
exportBuildFile: AllDataPacksExported.json
```

This file is not Importable to a Salesforce Org through the DataPacks API, but could be used to see the full raw output from a Salesforce Org. Instead, use the BuildFile task to create an Importable file.

##### Advanced: Export by Manifest
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

##### BuildFile  
This specifies a File to create from the DataPack Directory. It could then be uploaded through the DataPacks UI in a Salesforce Org.
```yaml
buildFile: ProductInfoPhase3.json 
```

##### Anonymous Apex  
Vlocity has identified the Anonymous Apex that should run during most Deploys. It is not necessary to change these settings unless you want to change the default behavior. Currently the Vlocity Templates and Vlocity Cards will be deactivated before Deploy, and Products will have their Attribute JSON Generated after Deploy. 

Anonymous Apex will run before and After a Job by job type and before each step of a Deploy. Available types are Import, Export, Deploy, BuildFile, and ExpandFile. Apex files live in vlocity_build/apex. You can include multiple Apex files with "//include FileName.cls;" in your .cls file.
```yaml
preJobApex:
  Deploy: DeactivateTemplatesAndLayouts.cls  
```

With this default setting, the Apex Code in DeativateTemplatesAndLayouts.cls will run before the deploy to the org. In this case it will Deactivate the Vlocity Templates and Vlocity UI Layouts (Cards) associated with the Deploy. See Advanced Anonymous Apex for more details.

##### Additional Options 
The Job file additionally supports some Vlocity Build based options and the options available to the DataPacks API. All Options can also be passed in as Command Line Options with `-optionName <value>` or `--optionName` for Boolean values.

##### Vlocity Build 
| Option | Description | Type  | Default |
| ------------- |------------- |----- | -----|
| compileOnBuild  | Compiled files will not be generated as part of this Export. Primarily applies to SASS files currently | Boolean | false |
| manifestOnly | If true, an Export job will only save items specifically listed in the manifest | Boolean | false |
| delete | Delete the VlocityDataPack__c file on finish | Boolean | true |
| activate | Will Activate everything after it is imported / deployed | Boolean | false |
| maximumDeployCount | The maximum number of items in a single Deploy. Setting this to 1 combined with using preStepApex can allow Deploys that act against a single DataPack at a time | Integer | 1000
| defaultMaxParallel | The number of parallel processes to use for export | Integer | 1
| exportPacksMaxSize | Split DataPack export once it reaches this threshold | Integer | null | 
| continueAfterError | Don't end vlocity job on error | Boolean | false |
| supportForceDeploy | Attempt to deploy DataPacks which have not had all their parents successfully deployed | Boolean | false |
| supportHeadersOnly | Attempt to deploy a subset of data for certain DataPack types to prevent blocking due to Parent failures | Boolean | false |
| addSourceKeys | Generate Global / Unique Keys for Records that are missing this data. Improves ability to import exported data | Boolean | false |
| useAllRelationships | Determines whether or not to store the _AllRelations.json file which may not generate consistently enough for Version Control. Recommended to set to false. | Boolean | true |
| buildFile | The target output file from packBuildFile | String | AllDataPacks.json |

##### DataPacks API
| Option | Description | Type  | Default |
| ------------- |------------- |----- | -----|
| ignoreAllErrors | Ignore Errors during Job. *It is recommeneded to NOT use this setting.* | Boolean | false |
| maxDepth | The max distance of Parent or Children Relationships from initial data being exported | Integer | -1 |
| processMultiple | When false each Export or Import will run individually | Boolean | true |

# Supported DataPack Types
-----------------------
These types are what would be specified when creating a Query or Manifest for the Job. 

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
| OrchestrationPlanDefinition | OrchestrationPlanDefinition__c | Orchestration Plan Definition | 
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

# Advanced
---------------------

## Anonymous Apex and JavaScript
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

#### Pre and Post Job JavaScript
Like Pre and Post Job Apex you can also run JavaScript against the project with the preJobJavaScript, postJobJavaScript in tyour Job File. 

Your JavaScript file should implement:
```javascript
/**
 * 
 * @param {object} vlocity - This is the vlocity.js object. You can use vlocity.jsForceConnection for access to the current JSForce Session.
 * 
 * @param {object} currentContextData - For preJobJavaScript this is null. For postJobJavaScript this will be a full list of records processed during the job.
 * 
 * @param {object} jobInfo - This is the entire job state
 * 
 * @param {function} callback - Callback - Must be called
 */ 

module.exports = function(vlocity, currentContextData, jobInfo, callback) {
  // Your Code Here
});
```

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

### Overriding DataPack Settings
It is possible to change the settings that are used to define the behavior of each DataPack is Imported, Deployed, and written to the files. Settings overrides are added inside the Job File definition with the following syntax which is also found in the actual `lib/datapacksexpandeddefinition.yaml`:
```yaml
OverrideSettings:
  DataPacks:
    Product2:
      SupportParallel: false
  SObjects:
    Product2:
      FilterFields:
      - AttributeMetadata__c
      - ImageId__c
      - JSONAttribute__c
      FolderName:
      - GlobalKey__c
      JsonFields:
      - CategoryData__c
      SourceKeyDefinition:
      - GlobalKey__c
      UnhashableFields:
      - JSONAttribute__c
      - CategoryData__c
      - IsConfigurable__c    
```

In this case the settings for Product2 include:
`SupportParallel: false` meaning that Product2 DataPacks do not support being uploaded in parallel due to record locking issues on the Standard Pricebook Entry.
```yaml
FilterFields:
- AttributeMetadata__c
- ImageId__c
- JSONAttribute__c 
```

Filter Fields describes fields that will be removed from the JSON before writing to the file system. This is generally due to them being or containing Salesforce Id's that cannot be replaced during export and are not Version Control friendly. 
```yaml
FolderName:
- GlobalKey__c 
```

Folder Name is the field which contains the name of the folder where the Product2 will be written. This is seperate from the file name as the folder must be unique, but the file should be readable. In most cases the Folder Name is the Global / Unique Key for the Object such that it should never change no matter what else changes in the object. 
```yaml
JsonFields:
- CategoryData__c
```

JsonFields is a list of fields on the SObject which should be written as formatted JSON as opposed to a String when writing to a file. 

The following full list of settings are supported:

| Setting | Type | Default | Description | 
| --- | --- | --- | --- | 
| SortFields | Array | "Hash" | The fields used to sort lists of SObjects to make the sort as consistent as possible.<br/>**Valid Values:** Fields on the SObject (ie Name, Type__c, etc) | 
| DoNotExpand | Boolean | false | Skip expanding the DataPack into Multiple Files. |
| FilterFields | Array | none | Fields to remove before writing to files.<br/>**Valid Values:** Fields on SObject | 
| FileName | Array | Name | Fields used to create the File Names for an SObject.<br/>**Valid Values:** Fields on SObject or "_String" to add a Literal | 
| SourceKeyFields | Array | Name | Fields used to build the readable key for a single SObject <br/>**Valid Values:**  Fields on SObject or "_String" to add a Literal |
| SourceKeyGenerationFields | Array | none | Fields used to Generate a new Source Key when addSourceKeys: true<br/>**Valid Values:** Fields on SObject |
| MatchingSourceKeyDefinition | Array | none | Fields used to build the readable key for a single SObject when it is a Matching Key node.<br/>**Valid Values:** Fields on SObject or "_String" to add a Literal | 
| FolderName | Array | Name | Fields used to create the Folder Name for an SObject.<br/>**Valid Values:** Fields on SObject or "_String" to add a Literal | 
| FileType | String | json | Field or String used to determine the File Type when creating a file.<br/>**Valid Values:** Fields on SObject or a string for a literal | 
| JsonFields | String | none | JsonFields is a list of fields on the SObject which should be written as formatted JSON as opposed to a String when writing to a file.<br/>**Valid Values:** Fields on SObject | 
| ReplacementFields | Object | none | Fields that should be replaced with values from other fields.<br/>**Valid Values:** Key is Target Field - Value is Field to Replace with or "_String" for literals | 
| NonUnique | Boolean | false | Declares that an SObject's data will always be created new during Deploy and will never be referenced by other objects and therefore does not need to keep extra metadata
| PaginationSize | Integer | 1000 | Declares that an SObject should Paginate during Deploy
| RemoveNullValues | Boolean | false | Delete all null values from JSON. Similar to NonUnique it will be created new, but can be referenced by other Objects
| UnhashableFields | Array | none | Fields that should not be used for Checking Diffs as they are largely informational.<br/>**Valid Values:** Fields on SObject | 
| SupportParallel | Boolean | true | Turn on / off parallel processing when Deploying the DataPack Type. Necessary when Master-Detail Parent might be shared with other DataPacks
| MaxDeploy | Integer | 50 | Specify the maximum number of DataPacks which should be uploaded in a single transaction
| HeadersOnly | Boolean | false | Support uploading only the top level SObject in the DataPack. Good for potentially fixing circular reference issues
| ExportGroupSize | Integer | 5 | Specify the maximum number of DataPacks which should be Exported in a single transaction. Potentially large DataPacks like Matrix or Attachments could be set to 1 if necessary
 
