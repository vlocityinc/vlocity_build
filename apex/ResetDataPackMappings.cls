List<vlocity_namespace__DRBundle__c> allMigrationBundlesToDelete = new List<vlocity_namespace__DRBundle__c>(); 

Set<String> allBundleNames = new Set<String>();

for (vlocity_namespace__DRBundle__c bundle : [ SELECT Id, Name FROM vlocity_namespace__DRBundle__c WHERE vlocity_namespace__Type__c = 'Migration']) 
{
	if (allBundleNames.contains(bundle.Name)) 
	{
		allMigrationBundlesToDelete.add(bundle);
	}

	allBundleNames.add(bundle.Name);
}

if (allMigrationBundlesToDelete.size() > 0) 
{
	delete allMigrationBundlesToDelete;
}

vlocity_namespace.CorePostInstallClass.runDev2ProdInserts();