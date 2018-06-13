# Vlocity Build
--------

Vlocity Build is a command line tool to export and deploy Vlocity DataPacks in a source control friendly format through a YAML Manifest describing your project. Its primary goal is to enable Continuous Integration for Vlocity Metadata through source control. It is written as a Node.js Command Line Tool.

## Table of Contents
* [Installation Instructions](#installation-instructions)
* [Getting Started](#getting-started)
* [Step by Step Guide](#step-by-step-guide)
  * [Simple Export](#simple-export)
  * [Simple Deploy](#simple-deploy)
  * [Org to Org Migration](#org-to-org-migration)
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

## Install Node.js
Download and Install Node at:

https://nodejs.org/

This project requires Node Version 8+.

Use `node -v` to find out which version you are on.

## Install Vlocity Build
You can install and use this project without cloning the repo using the following commands:
```bash
npm install --global https://github.com/vlocityinc/vlocity_build
vlocity help
```

This should show a list of all available commands confirming that the project has been setup successfully. You can now run this command from any folder.

# Getting Started
------------
To begin, create your own property files for your Source and Target Salesforce Orgs with the following:
```java
sf.username = < Salesforce Username >
sf.password = < Salesforce Password + Security Token >
sf.loginUrl = < https://login.salesforce.com or https://test.salesforce.com for Sandbox >
```
When you (or your CI/CD server) is behind a proxy you can specify the proxy URL with a Username and password by adding the below line to your property file:
```java
sf.httpProxy: http://[<Proxy server Username>:<Proxy server Password>@]<Proxy hostname>[:<Proxy Port>]
```

Additionally there is support for OAuth style information sent through the command line or property file:
```bash
vlocity packExport -sf.authToken <authToken> -sf.instanceUrl <instanceUrl> -sf.sessionId <sessionId>
```

It is best to not rely on a single build.properties file and instead use named properties files for each org like `build_source.properties` and `build_target.properties`

## Running the Process
Commands follow the syntax:
```bash
vlocity packExport -propertyfile <filepath> -job <filepath>
```
## Property File
The propertyfile is used to provide the credentials of the org you will connect to. It will default to build.properties if no file is specified.

## Job File
The Job File used to define the project location and the various settings for running a DataPacks Export / Deploy.

# Step by Step Guide
------------
Once you have your `build_source.properties` file setup, you can get started with mirgation with the following: 

## Simple Export
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
VlocityDataPackType >> DataRaptor  
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

## Simple Deploy
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
## Org to Org Migration
When Exporting and Deploying between two Orgs use the following action plan:  
1. Create Property Files for each Org. `build_source.properties` and `build_target.properties`  
2. Create a Job File which identifies your projectPath and the queries for the DataPack Types you would like to export. To export the Vlocity Product Catalog, use the following EPC.yaml file:
```yaml
projectPath: vlocity
queries:
  - AttributeCategory
  - CalculationProcedure
  - ContextAction
  - ContextDimension
  - ContextScope
  - EntityFilter
  - ObjectClass
  - ObjectContextRule
  - ObjectLayout
  - Pricebook2
  - PriceList
  - PricingVariable
  - Product2
  - Promotion
  - Rule
  - TimePlan
  - TimePolicy
  - UIFacet
  - UISection
  - VlocityFunction
  - VlocityPicklist
```
3. Ensure High Data Quality in the Source Org by running:   
`vlocity -propertyfile build_source.properties -job EPC.yaml runJavaScript -js cleanData.js`  
4. Update your DataPack Settings in the source Org to the latest in the Vlocity Build Tool by running:  
`vlocity -propertyfile build_source.properties -job EPC.yaml packUpdateSettings`  
This step will deliver changes to the DataPack settings outside the Vlocity Managed Package installation flow and should be run after upgrading/installing the package or on new Sandbox orgs.  
5. Run the Export:  
`vlocity -propertyfile build_source.properties -job EPC.yaml packExport`  
6. If you encounter any Errors during Export please evaluate their importance. Any error during export points to potential errors during deploy. See the [troubleshooting](#troubleshooting) section of this document for more details on fixing errors. Once errors are fixed, run the following to re-export any failed data:  
`vlocity -propertyfile build_source.properties -job EPC.yaml packRetry`  
If your Export fails midway through due to conenction issues, you can also the following to pick the export back up where it left off:  
`vlocity -propertyfile build_source.properties -job EPC.yaml packContinue` 
7. Ensure High Data Quality in the Target Org by running:  
`vlocity -propertyfile build_target.properties -job EPC.yaml runJavaScript -js cleanData.js`  
8. Ensure your Vlocity Metadata is high quality by running:  
`vlocity -propertyfile build_target.properties -job EPC.yaml refreshProject` 
This command helps fix any broken references in the project.  
9. Update the DataPack Settings in the Target Org:  
`vlocity -propertyfile build_target.properties -job EPC.yaml packUpdateSettings`
10. Run the deploy:  
`vlocity -propertyfile build_target.properties -job EPC.yaml packDeploy`
11. If you encounter any Errors during deploy they must be fixed. But first, evaluate whether the error has been mitigated by later uploads of missing data. Run:  
`vlocity -propertyfile build_target.properties -job EPC.yaml packRetry`  
Which will retry the failed DataPacks, often fixing errors due to issues in the order of deploy or Salesforce Governor limits. `packRetry` should be run until the error count stops going down after each run. See the [troubleshooting](#troubleshooting) section of this document for more details on fixing errors.

### Summary of Org to Org Migration
All together the commands are:
```bash
# Source Org
vlocity -propertyfile build_source.properties -job EPC.yaml runJavaScript -js cleanData.js
vlocity -propertyfile build_source.properties -job EPC.yaml packUpdateSettings
vlocity -propertyfile build_source.properties -job EPC.yaml packExport

# Target Org
vlocity -propertyfile build_target.properties -job EPC.yaml runJavaScript -js cleanData.js
vlocity -propertyfile build_target.properties -job EPC.yaml refreshProject
vlocity -propertyfile build_target.properties -job EPC.yaml packUpdateSettings
vlocity -propertyfile build_target.properties -job EPC.yaml packDeploy
vlocity -propertyfile build_target.properties -job EPC.yaml packRetry
```

### New Sandbox Orgs
If you have recently installed the Vlocity Managed Package or created a Sandbox Org that is not a Full Copy Sandbox and have done *no* development this Salesforce Org, you should run the following command to load all the default Vlocity Metadata:
```bash
vlocity -propertyfile build_target.properties --nojob packUpdateSettings refreshVlocityBase
```
This will install the Base UI Templates, CPQ Base Templates, EPC Default Objects and any other default data delivered through Vlocity DataPacks. This command should only be run if the Org was not previously used for Vlocity Development.

# The Job File
------------
A Job File is similar to a Salesforce package.xml file, however it also includes runtime options like the maximum number of concurrent API calls running.  

**The Default Job Settings will automatically be used if not explicitly specified in your file, and it is best to not add settings to the file unless you want to change them from the defaults.**

The Job File's primary settings that you should define is specifying the folder that you would like to use to contain your project.
```yaml
projectPath: ../myprojectPath 
```

The projectPath can be the absolute path to a folder or the relative path from where you run the vlocity command.  

## What will be Exported?
By default, all data will be exported from the org when running the `packExport` command. To narrow the exported data, you can define any Salesforce SOQL query that returns the Id of records you would like to export.
```yaml
queries:
  - VlocityDataPackType: DataRaptor
    query: Select Id from %vlocity_namespace%__DRBundle__c where Name LIKE '%Migration' LIMIT 1
```

This query will export a DataRaptor Vlocity DataPack by querying the SObject table for DataRaptor `DRBundle__c` and even supports the `LIMIT 1` and `LIKE` syntax. 

## Example Job File
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

## Predefined vs Explicit Queries
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

## Query All
Running `packExport` with no queries defined in your Job File will export all the predefined queries for each type. If you do have some special queires defined, you can also run: `packExportAllDefault` to specify running all the default queries.

# Troubleshooting
------------

## Data Quality
Once Exported it is very important to validate that your data is in state that is ready to be deployed. The Vlocity Build tool primarily relies on unique data in fields across the different objects to prevent duplicate data being uploaded.

## Errors
Generally errors will be due to missing or incorrect references to other objects. 
```
Error >> DataRaptor --- GetProducts --- Not Found
Error >> VlocityUITemplate --- ShowProducts --- Not Found
```

This "VlocityUITemplate --- ShowProducts --- Not Found" error during Export means that something, likely an OmniScript, has a reference to a VlocityUITemplate that is not currently Active or does not exist in the org as a VlocityUITemplate. In some cases the VlocityUITemplate for an OmniScript can actually be included inside the Visualforce Page in which the OmniScript is displayed. In that case, this error can be completely ignored. The DataRaptor Not Found means that likely someone deleted or changed the name of the DataRaptor being referenced without updating the OmniScript using it.

Errors occurring during Export will likely result in Errors during deploy. But not always. Errors during Deploy will occur when a Salesforce Id reference is not found in the target system:  
`Deploy Error >> Product2/02d3feaf-a390-2f57-a08c-2bfc3f9b7333 --- iPhone --- No match found for vlocity_cmt__ProductChildItem__c.vlocity_cmt__ChildProductId__c - vlocity_cmt__GlobalKey__c=db65c1c5-ada4-7952-6aa5-8a6b2455ea02
`

In this Error the Product being deployed is the iPhone with Global Key `02d3feaf-a390-2f57-a08c-2bfc3f9b7333` and the error is stating that one of the Product Child Items could not find the referenced product with Global Key `db65c1c5-ada4-7952-6aa5-8a6b2455ea02`. This means the other Product must also be deployed. 

Additionally, Deploys will run all of the Triggers associated with Objects during their import. As there are various rules across the Vlocity Data Model, sometimes errors will occur due to attempts to create what is considered "bad data". These issues must be fixed on a case by case basis.

Some errors are related to potential data quality issues:
`Product2/adac7afa-f741-80dd-9a69-f8a5aa61eb56 >> IPhone Charger - Error - Product you are trying to add is missing a Pricebook Entry in pricebook >>2018 Pricebook<< Please add product to pricebook and try again`

While not clear from the wording, this error indicates that one of the Child Products being added to this Product will potentially cause issues because the Child Product is not in the 2018 Pricebook. To workaround this issue it is most simple to disable temporarily disable the listed Pricebook. This error is generally caused by a cascading failure and can also be solved by deploying the listed pricebook on its own with the command:

`vlocity packDeploy -manifest '["Pricebook2/2018 Pricebook"]'`

Some errors are related to conflicting data. For Attribute Category Display Sequence you will receive the following:

`Error >> AttributeCategory/Product_Attributes --- Product Attributes --- duplicate value found: <unknown> duplicates value on record with id: <unknown>`

This error means that a Unique field on the Object is a duplicate of an existing Unique field value. Unfortunately it does not always provide the actual Id. Update the display sequence value for an existing Attribute Category objects in Target Org.

Records with the same Display Sequence can be found via SOQL query: 

Select Id, Name from %vlocity_namespace%__AttributeCategory__c 
where %vlocity_namespace%__DisplaySequence__c = %DisplaySequence__c from DataPack.json file%

## Cleaning Bad Data
This tool includes a script to help find and eliminate "bad data". It can be run with the following command:
```bash
vlocity -propertyfile <propertyfile> -job <job> runJavaScript -js cleanData.js
```

This will run Node.js script that Adds Global Keys to all SObjects missing them, and deletes a number of Stale data records that are missing data to make them useful. 

## External Ids and Global Keys 
Most objects being deployed have a field or set of fields used to find unique records like an External Id in Salesforce. For many Vocity Objects this is the Global Key field. If a Deploy finds 1 object matching the Global Key then it will overwrite that object during deploy. If it finds more than 1 then it will throw an error:  
`
Deploy Error >> Product2/02d3feaf-a390-2f57-a08c-2bfc3f9b7333 --- iPhone --- Duplicate Results found for Product2 WHERE vlocity_cmt__GlobalKey__c=02d3feaf-a390-2f57-a08c-2bfc3f9b7333 - Related Ids: 01t1I000001ON3qQAG,01t1I000001ON3xQAG
`

This means that Duplicates have been created in the org and the data must be cleaned up. 

While there are protections against missing or duplicate Global Keys the logic is often in triggers which may have at points been switched off, and sometimes applies to data that may have existed before the Vlocity Package was installed. 

You can fix missing GlobalKeys by running the following command which will start a set of Batch Jobs to add Global Keys to any Objects which are missing them:
```bash
vlocity -propertyfile <propertyfile> -job <job> runJavaScript -js cleanData.js
```
This will run Node.js script that Adds Global Keys to all SObjects missing them, and deletes a number of Stale data records that are missing data to make them useful. 

However, when you are attempting to migrate data from one org to another where both orgs have missing GlobalKeys, but existing data that should not be duplicated, a different strategy may need to be used to produce GlobalKeys that match between orgs.

## Validation
Ultimately the best validation for a deploy will be testing the functionality directly in the org. However, another way to see any very clear potential issues is to see if recently deployed data matches exactly what was just exported. 

You can run the following command to check the current local data against the data that exists in the org you deployed to:
```bash
vlocity -propertyfile build_uat.properties -job Example.yaml packGetDiffs
```

This will provide a list of files that are different locally than in the org. In the future more features will be added to view the actual diffs.

# All Commands
-----------

## Primary  
`packExport`: Export from a Salesforce org into a DataPack Directory  
`packExportSingle`: Export a Single DataPack by Id  
`packExportAllDefault`: Export All Default DataPacks as listed in Supported Types Table  
`packDeploy`: Deploy all contents of a DataPacks Directory  

## Troubleshooting 
`packContinue`: Continues a job that failed due to an error  
`packRetry`: Continues a Job retrying all deploy errors or re-running all export queries  

## Additional 
`packGetDiffsAndDeploy`: Deploy only files that are modified compared to the target Org  
`packGetDiffs`: Find all Diffs in Org Compared to Local Files   
`packBuildFile`: Build a DataPacks Directory into a DataPack file   
`runJavaScript`: Rebuild all DataPacks running JavaScript on each or run a Node.js Script   
`packUpdateSettings`: Refreshes the DataPacks Settings to the version included in this project. Recommended only if you are on the latest Major version of the Vlocity Managed Package  
`runApex`: Runs Anonymous Apex specified in the option -apex at the specified path or in the /apex folder  
`packGetAllAvailableExports`: Get list of all DataPacks that can be exported  
`refreshVlocityBase`: Deploy and Activate the Base Vlocity DataPacks included in the Managed Package  

## Example Commands

### packExport
`packExport` will retrieve all Vlocity Metadata from the org as Vlocity DataPacks as defined in the Job File and write them to the local file system in a Version Control friendly format.   
```bash
vlocity -propertyfile <filepath> -job <filepath> packExport
```

### packExportSingle
`packExportSingle` will export a single DataPack and all its dependencies. It also supports only exporting the single DataPack with no dependencies by setting the depth.  
```bash
vlocity -propertyfile <filepath> -job <filepath> packExportSingle -type <VlcoityDataPackType> -id <Salesforce Id> -depth <Integer>
```

Max Depth is optional and a value of 0 will only export the single DataPack. Max Depth of 1 will export the single DataPack along with its first level depedencies.

### packExportAllDefault
`packExportAllDefault` will retrieve all Vlocity Metadata instead of using the Job File definition.  
```bash
vlocity -propertyfile <filepath> -job <filepath> packExportAllDefault
```

### packDeploy
`packDeploy` will deploy all contents in the projectPath of the Job File to the Salesforce Org.  
```bash
vlocity -propertyfile <filepath> -job <filepath> packDeploy
```

### packContinue
`packContinue` can be used to resume the job that was running before being cancelled or if there was an unexpected error. It will work for Export or Deploy.
```bash
vlocity -propertyfile <filepath> -job <filepath> packContinue
```

### packRetry
`packRetry` can be used to restart the job that was previously running and will additionally set all Errors back to Ready to deployed again.  
```bash
vlocity -propertyfile <filepath> -job <filepath> packRetry
```

### packGetDiffs
`packGetDiffs` will provide a list of files that are different locally than in the org. In the future more features will be added to view the actual diffs.
```bash
vlocity -propertyfile <filepath> -job <filepath> packGetDiffs
```

### packGetDiffsAndDeploy
`packGetDiffsAndDeploy` will first find all files that are different locally than in the target Org, and then will deploy only the DataPacks that have changed or are new. 
```bash
vlocity -propertyfile <filepath> -job <filepath> packGetDiffsAndDeploy
```
While this may take longer than doing an actual deploy, it is a great way to ensure that you are not updating items in your org more than necessary.

# Advanced Job File Settings
------------
The Job File has a number of additonal runtime settings that can be used to define your project and aid in making Exports / Deploys run successfully. However, the Default settings should only be modified to account for unique issues in your Org. 

## Basic  
```yaml
projectPath: ../my-project # Where the project will be contained. Use . for this folder. 
                           # The Path is always relative to where you are running the vlocity command, 
                           # not this yaml file

expansionPath: datapack-expanded # The Path relative to the projectPath to insert 
                                 # the expanded files. Also known as the DataPack Directory 
                                 # in this Doecumentation
```

## Export 
Exports can be setup as a series of queries or a manifest. 

## Export by Queries
Queries support full SOQL to get an Id for each DataPackType. You can have any number of queries in your export. SOQL Queries can use `%vlocity_namespace%__` to be namespace independent or the namespace of your Vlocity Package can be used.
```yaml
queries:
  - DataRaptor
  - VlocityDataPackType: VlocityUITemplate
    query: Select Id from %vlocity_namespace%__VlocityUITemplate__c where Name LIKE 'campaign%'
```    

**Export by Predefined Queries is the recommened approach for defining your Project and you can mix the predefined and explicit queries as shown above**

## Export Results 
The primary use of this tool is to write the results of the Export to the local folders at the expansionPath. There is a large amount of post processing to make the results from Salesforce as Version Control friendly as possible. 

Additionally, an Export Build File can be created as part of an Export. It is a single file with all of the exported DataPack Data in it with no post processing. 
```yaml
exportBuildFile: AllDataPacksExported.json
```

This file is not Importable to a Salesforce Org through the DataPacks API, but could be used to see the full raw output from a Salesforce Org. Instead, use the BuildFile task to create an Importable file.

## Advanced: Export by Manifest
The manifest defines the Data used to export. Not all types will support using a manifest as many types are only unique by their Id. VlocityDataPackTypes that are unique by name will work for manifest. These are limited to: DataRaptor, VlocityUITemplate, VlocityCard
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

## Advanced: Export Individual SObject Records
You can export individual SObjects by using the VlocityDataPackType SObject. This will save each SObject as its own file. 

```bash
vlocity packExport -type SObject -query "SELECT Id from PricebookEntry WHERE Id in ('01u0a00000I4ON2AAN', '01u0a00000I4ON2AAN')"
```

This will export the PricebookEntries into a folder called SObject_PricebookEntry.

This method is also very good for adding Custom Settings to Version Control, however it requires creating Matching Key Records for your Custom Setting. See [Creating Custom Matching Keys](#creating-custom-matching-keys) for more information on Matching Keys. You can specify a Custom Setting in your job file as follows:

```yaml
queries: 
  - VlocityDataPackType: SObject
    query: Select Id from MyCustomSetting__c
```

This will export the MyCustomSetting__c records into a folder called SObject_MyCustomSetting.

## BuildFile  
This specifies a File to create from the DataPack Directory. It could then be uploaded through the DataPacks UI in a Salesforce Org.
```yaml
buildFile: ProductInfoPhase3.json 
```

## Anonymous Apex  
Vlocity has identified the Anonymous Apex that should run during most Deploys. It is not necessary to change these settings unless you want to change the default behavior. Currently the Vlocity Templates and Vlocity Cards will be deactivated before Deploy, and Products will have their Attribute JSON Generated after Deploy. 

Anonymous Apex will run before and After a Job by job type and before each step of a Deploy. Available types are Import, Export, Deploy, BuildFile, and ExpandFile. Apex files live in vlocity_build/apex. You can include multiple Apex files with "//include FileName.cls;" in your .cls file.
```yaml
preJobApex:
  Deploy: DeactivateTemplatesAndLayouts.cls  
```

With this default setting, the Apex Code in DeativateTemplatesAndLayouts.cls will run before the deploy to the org. In this case it will Deactivate the Vlocity Templates and Vlocity UI Layouts (Cards) associated with the Deploy. See Advanced Anonymous Apex for more details.

## Additional Options 
The Job file additionally supports some Vlocity Build based options and the options available to the DataPacks API. All Options can also be passed in as Command Line Options with `-optionName <value>` or `--optionName` for Boolean values.

## Job Options 
| Option | Description | Type  | Default |
| ------------- |------------- |----- | -----|
| activate | Will Activate everything after it is imported / deployed | Boolean | false |
| addSourceKeys | Generate Global / Unique Keys for Records that are missing this data. Improves ability to import exported data | Boolean | false |
| buildFile | The target output file from packBuildFile | String | AllDataPacks.json |
| defaultMaxParallel | The number of parallel processes to use for export | Integer | 1 |
| compileOnBuild  | Compiled files will not be generated as part of this Export. Primarily applies to SASS files currently | Boolean | false |
| continueAfterError | Don't end vlocity job on error | Boolean | false |
| delete | Delete the VlocityDataPack__c file on finish | Boolean | true |
| exportPacksMaxSize | Split DataPack export once it reaches this threshold | Integer | null | 
| expansionPath | Secondary path after projectPath to expand the data for the Job | String | . |
| ignoreAllErrors | Ignore Errors during Job. *It is recommeneded to NOT use this setting.* | Boolean | false |
| manifestOnly | If true, an Export job will only save items specifically listed in the manifest | Boolean | false |
| maxDepth | The max distance of Parent or Children Relationships from initial data being exported | Integer | -1 |
| maximumDeployCount | The maximum number of items in a single Deploy. Setting this to 1 combined with using preStepApex can allow Deploys that act against a single DataPack at a time | Integer | 1000 |
| processMultiple | When false each Export or Import will run individually | Boolean | true |
| supportForceDeploy | Attempt to deploy DataPacks which have not had all their parents successfully deployed | Boolean | false |
| supportHeadersOnly | Attempt to deploy a subset of data for certain DataPack types to prevent blocking due to Parent failures | Boolean | false |
| useAllRelationships | Determines whether or not to store the _AllRelations.json file which may not generate consistently enough for Version Control. Recommended to set to false. | Boolean | true |

## Vlocity Build Options
| Option | Description | Type  | Default |
| ------------- |------------- |----- | -----|
| apex | Apex Class to run with the runApex command | String | none |
| folder | Path to folder containing Apex Files when using the runApex command | String | none |
| javascript | Path to javascript file to run when using the runJavaScript command | String | none |
| json | Output the result of the Job as JSON Only. Used in CLI API applications | Boolean | false |
| json-pretty | Output the result of the Job as more readable JSON Only. Used in CLI API applications | Boolean | false |
| job | Path to job file | String | none |
| manifest | JSON of VlocityDataPackKeys to be processed | JSON | none | 
| nojob | Run command without specifying a Job File. Will use all default settings | Boolean | false |
| propertyfile | Path to propertyfile which can also contain any Options | String | build.properties |
| query | SOQL Query used for packExportSingle command | String | none |
| queryAll | Query all default types. Overrides any project settings | Boolean | false |
| quiet | Don't log any output | Boolean | false |
| sandbox | Set sf.loginUrl to https://test.salesforce.com | Boolean | false | 
| sf.accessToken | Salesforce Access Token when using OAuth info | String | none |
| sf.instanceUrl | Salesforce Instance URL when using OAuth info | String | none |
| sf.loginUrl | Salesforce Login URL when sf.username + sf.password | String | https://login.salesforce.com |
| sf.password | Salesforce password + security token when using sf.username | String | none |
| sf.sessionId | Salesforce Session Id when using OAuth info | String | none |
| sf.username | Salesforce username when using sf.password | String | none |
| type | DataPack Type used for packExportSingle command | String | none |
| verbose | Show additional logging statements | Boolean | false |
| version | Show Vlocity Build Tool Version | Boolean | false |

# Supported DataPack Types
These types are what would be specified when creating a Query or Manifest for the Job. 

| VlocityDataPackType | All SObjects |
| ------------- |-------------| 
| Attachment | Attachment |
| AttributeAssignmentRule | AttributeAssignmentRule__c |
| AttributeCategory | AttributeCategory__c<br>Attribute__c |
| CalculationMatrix | CalculationMatrix__c<br>CalculationMatrixVersion__c<br>CalculationMatrixRow__c |
| CalculationProcedure | CalculationProcedure__c<br>CalculationProcedureVersion__c<br>CalculationProcedureStep__c |
| Catalog | Catalog__c<br>CatalogRelationship__c<br>CatalogProductRelationship__c |
| ContextAction | ContextAction__c |
| ContextDimension | ContextDimension__c<br>ContextMapping__c<br>ContextMappingArgument__c |
| ContextScope | ContextScope__c |
| ContractType | ContractType__c<br>ContractTypeSetting__c |
| DataRaptor | DRBundle__c<br>DRMapItem__c |
| Document<br>(Salesforce Standard Object) | Document |
| DocumentClause | DocumentClause__c |
| DocumentTemplate | DocumentTemplate__c<br>DocumentTemplateSection__c<br>DocumentTemplateSectionCondition__c |
| EntityFilter | EntityFilter__c<br>EntityFilterCondition__c<br>EntityFilterMember__c<br>EntityFilterConditionArgument__c |
| IntegrartionProcedure | OmniScript__c<br>Element__c |
| ItemImplementation | ItemImplementation__c |
| ManualQueue | ManualQueue__c |
| ObjectClass | ObjectClass__c<br>ObjectFieldAttribute__c<br>AttributeBinding__c<br>AttributeAssignment__c |
| ObjectContextRule<br>(Vlocity Object Rule Assignment) | ObjectRuleAssignment__c |
| ObjectLayout | ObjectLayout__c<br>ObjectFacet__c<br>ObjectSection__c<br>ObjectElement__c |
| OmniScript | OmniScript__c<br>Element__c |
| OrchestrationDependencyDefinition | OrchestrationDependencyDefinition__c |
| OrchestrationItemDefinition | OrchestrationItemDefinition__c |
| OrchestrationPlanDefinition | OrchestrationPlanDefinition__c |
| Pricebook2<br>(Salesforce Standard Object) | Pricebook2<br>PricebookEntry |
| PriceList | PriceList__c<br>PriceListEntry__c<br>PricingElement__c<br>PricingVariable__c<br>PricingVariableBinding__c |
| PricingVariable | PricingVariable__c |
| Product2<br>(Salesforce Standard Object) | Product2<br>PricebookEntry(In the Standard Pricebook)<br>AttributeAssignment__c<br>ProductChildItem__c<br>OverrideDefinition__c<br>ProductConfigurationProcedure__c<br>ProductRelationship__c<br>ProductEligibility__c<br>ProductAvailability__c<br>DecompositionRelationship__c<br>OrchestrationScenario__c | 
| Promotion | Promotion__c<br>PromotionItem__c |
| QueryBuilder | QueryBuilder__c<br>QueryBuilderDetail__c |
| Rule | Rule__c<br>RuleVariable__c<br>RuleAction__c<br>RuleFilter__c |
| StoryObjectConfiguration<br>(Custom Setting) | StoryObjectConfiguration__c |
| System | System__c<br>SystemInterface__c |
| TimePlan | TimePlan__c |
| TimePolicy | TimePolicy__c |
| UIFacet | UIFacet__c |
| UISection | UISection__c |
| VlocityAction | VlocityAction__c |
| VlocityAttachment | VlocityAttachment__c |
| VlocityCard | VlocityCard__c |
| VlocityFunction | VlocityFunction__c<br>VlocityFunctionArgument__c |
| VlocityPicklist | Picklist__c<br>PicklistValue__c |
| VlocitySearchWidgetSetup<br>(Vlocity Interaction Launcher) | VlocitySearchWidgetSetup__c<br>VlocitySearchWidgetActionsSetup__c |
| VlocityStateModel | VlocityStateModel__c<br>VlocityStateModelVersion__c<br>VlocityState__c<br>VlocityStateTransition__c |
| VlocityUILayout | VlocityUILayout__c |
| VlocityUITemplate | VlocityUITemplate__c |
| VqMachine<br>(Vlocity Intelligence Machine) | VqMachine__c<br>VqMachineResource__c |
| VqResource<br>(Vlocity Intelligence Resource) | VqResource__c<br>Attachment<br>AttributeAssignment__c |


# Advanced
---------------------

## Anonymous Apex and JavaScript
In order to make the Anonymous Apex part reusable, you can include multiple Apex files with "//include FileName.cls;" in your .cls file. This allows you to write Utility files that can be reused. The BaseUtilities.cls file includes an additional feature that will send the data as a JSON to your Anonymous Apex.

### Namespace
In Anonymous apex vlocity_namespace will be replaced with the vlocity.namespace from the propertyfile.

### BaseUtilities.cls 
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

### PreJobApex
Pre Job Apex can run Anonymous Apex before the DataPack Job starts. While it is possible to use the CURRENT_DATA_PACKS_CONTEXT_DATA described above, for large projects it will be over the 32000 character limit for Anonymous Apex. 

### preJobApex vs preStepApex
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
    query: Select Id from %vlocity_namespace%__VlocityUITemplate__c where Name LIKE 'campaign%' 
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
### Creating Custom Matching Keys
DataPacks uses a Custom Metadata Object called a Vlocity Matching Key to define the uniqnueness of any SObject. Matching Keys contain the following fields:  

| Name | API Name | Description |   
| --- | --- | --- |    
| Matching Key Fields | MatchingKeyFields__c | Comma Separated list of Field API Names that define Uniqueness |  
| Vlocity Matching Key Name | Name | Name of the Matching Key |  
| Label | Label | Label of the Matching Key |  
| Object API Name | ObjectAPIName__c | Full API Name of the SObject |  
| Matching Key Object | MatchingKeyObject__c | Full API Name of the SObject |  
| Return Key Field | ReturnKeyField__c | Always "Id" for DataPacks |  
| Composite Unique Field | CompositeUniqueFieldName__c | Leave empty - Reserved for future use |  

Create these keys if you want to support connections between SObject Id fields that are not already supported by DataPacks, or if you would like to change the Vlocity Default for any SObject. Matching Keys created outside the Managed Package will always override ones contained inside (Post Vlocity v15).

For Custom Settings `MatchingKeyFields__c` should always be `Name`.

### Current Matching Keys
| Object API Name | Matching Key Fields |       
| --- | --- |   
| %vlocity_namespace%__Attribute__c  |  %vlocity_namespace%__Code__c |  
| %vlocity_namespace%__AttributeAssignment__c  | %vlocity_namespace%__ObjectId__c, %vlocity_namespace%__AttributeId__c, %vlocity_namespace%__IsOverride__c |  
| %vlocity_namespace%__AttributeAssignmentRule__c  | Name |  
| %vlocity_namespace%__AttributeCategory__c  |  %vlocity_namespace%__Code__c |  
| %vlocity_namespace%__CalculationMatrix__c  |  Name |  
| %vlocity_namespace%__CalculationMatrixVersion__c  |  %vlocity_namespace%__VersionNumber__c, %vlocity_namespace%__CalculationMatrixId__c |  
| %vlocity_namespace%__CalculationProcedure__c | Name |  
| %vlocity_namespace%__CalculationProcedureVersion__c | %vlocity_namespace%__VersionNumber__c, %vlocity_namespace%__CalculationProcedureId__c |  
| %vlocity_namespace%__Catalog__c | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__CatalogProductRelationship__c | %vlocity_namespace%__CatalogId__c, %vlocity_namespace%__Product2Id__c |  
| %vlocity_namespace%__CatalogRelationship__c | %vlocity_namespace%__ChildCatalogId__c, %vlocity_namespace%__ParentCatalogId__c |  
| %vlocity_namespace%__ContextAction__c | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__ContextDimension__c | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__ContextScope__c | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__ContractType__c | Name |  
| %vlocity_namespace%__ContractTypeSetting__c | Name, %vlocity_namespace%__ContractTypeId__c |  
| %vlocity_namespace%__DocumentClause__c | Name |  
| %vlocity_namespace%__DocumentTemplate__c | %vlocity_namespace%__ExternalID__c |  
| %vlocity_namespace%__DRBundle__c | Name |  
| %vlocity_namespace%__DRMapItem__c | %vlocity_namespace%__MapId__c |  
| %vlocity_namespace%__Element__c | %vlocity_namespace%__OmniScriptId__c, Name |  
| %vlocity_namespace%__EntityFilter__c | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__InterfaceImplementation__c | Name |  
| %vlocity_namespace%__InterfaceImplementationDetail__c | %vlocity_namespace%__InterfaceId__c, Name |  
| %vlocity_namespace%__ObjectClass__c | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__ObjectContextRule | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__ObjectLayout__c | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__OfferingProcedure__c | Name |  
| %vlocity_namespace%__Picklist__c | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__PicklistValue__c | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__PriceList__c | %vlocity_namespace%__Code__c |  
| %vlocity_namespace%__PriceListEntry__c | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__PricingElement__c | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__PricingVariable__c | %vlocity_namespace%__Code__c |  
| %vlocity_namespace%__ProductChildItem__c | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__ProductConfigurationProcedure__c | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__ProductRelationship__c | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__Promotion__c | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__PromotionItem__c | %vlocity_namespace%__ProductId__c, %vlocity_namespace%__PromotionId__c |  
| %vlocity_namespace%__PublicProgram__c | Name |  
| %vlocity_namespace%__QueryBuilder__c | Name |  
| %vlocity_namespace%__Rule__c | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__StoryObjectConfiguration__c | Name |  
| %vlocity_namespace%__TimePlan__c | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__TimePolicy__c | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__UIFacet__c | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__UISection__c | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__VlocityAction__c | Name |  
| %vlocity_namespace%__VlocityAttachment__c | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__VlocityCard__c | Name, %vlocity_namespace%__Author__c, %vlocity_namespace%__Version__c |  
| %vlocity_namespace%__VlocityFunction__c | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__VlocityFunctionArgument__c | %vlocity_namespace%__GlobalKey__c |  
| %vlocity_namespace%__VlocitySearchWidgetActionsSetup__c | %vlocity_namespace%__VlocityActionId__c, %vlocity_namespace%__VlocitySearchWidgetSetupId__c, %vlocity_namespace%__ActionType__c |  
| %vlocity_namespace%__VlocitySearchWidgetSetup__c | Name |  
| %vlocity_namespace%__VlocityState__c | Name, %vlocity_namespace%__DTPStateModelName__c |  
| %vlocity_namespace%__VlocityStateModel__c | %vlocity_namespace%__ObjectAPIName__c, %vlocity_namespace%__FieldAPIName__c, %vlocity_namespace%__TypeFieldName__c, %vlocity_namespace%__TypeFieldValue__c |  
| %vlocity_namespace%__VlocityStateModelVersion__c | %vlocity_namespace%__VersionNumber__c, %vlocity_namespace%__StateModelId__c |  
| %vlocity_namespace%__VlocityUILayout__c | Name, %vlocity_namespace%__Version__c, %vlocity_namespace%__Author__c |  
| %vlocity_namespace%__VlocityUITemplate__c | Name, %vlocity_namespace%__Author__c, %vlocity_namespace%__Version__c |  
| %vlocity_namespace%__VqMachine__c | Name |  
| %vlocity_namespace%__VqMachineResource__c | %vlocity_namespace%__VqMachineId__c, %vlocity_namespace%__VqResourceId__c |  
| %vlocity_namespace%__VqResource__c | Name |  
| Document | DeveloperName |  
| Pricebook2 | Name |  
| PricebookEntry | Product2Id, Pricebook2Id, CurrencyIsoCode |  
| Product2 | %vlocity_namespace%__GlobalKey__c |  
| RecordType | DeveloperName, SobjectType |  
| User | Email |  

### CLI API
The Command Line API can also return JSON formatted output and accept some inputs as JSON. The primary input JSON would be the Manifest which can be passed in as:
```bash
vlocity packExport -manifest '["OmniScript/MACD_Move_English"]'
```

The tool will return JSON is sent the argument `--json` or `--json-pretty` and will return a JSON in the format of
```json
{
  "action": "Export",
  "message": "VlocityUITemplate --- SelectAssetToMove.html --- Not Found",
  "records": [
    {
        "VlocityDataPackDisplayLabel": "MACD Move English",
        "VlocityDataPackKey": "OmniScript/MACD_Move_English",
        "VlocityDataPackStatus": "Success",
        "VlocityDataPackType": "OmniScript"
    }
  ],
  "status": "error"
}    
```

Where each record contains the VlocityDataPackKey that was Exported / Deployed, and the Export / Deploy will be limited to only VlocityDataPackKeys passed in as part of the manifest if it is supplied. 

A Deploy will always only include the `-manifest` keys, however for an Export it will be defauly include dependencies unless `-maxDepth 0` is used as an argument.

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
    vlocity_namespace__DRMapItem__c:
      FilterFields: 
        - vlocity_namespace__UpsertKey__c
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
 
