List<vlocity_namespace__DRBundle__c> allMigrationBundlesToDelete = new List<vlocity_namespace__DRBundle__c>(); 

Set<String> allBundleNames = new Set<String>();

vlocity_namespace__TriggerSetup__c xomTriggers = vlocity_namespace__TriggerSetup__c.getInstance('XOM.EnableXOMTriggers');
Boolean xomTriggersOn = xomTriggers != null && xomTriggers.vlocity_namespace__IsTriggerOn__c == true;

if (xomTriggersOn)
{
    xomTriggers.vlocity_namespace__IsTriggerOn__c = false;
    update xomTriggers;
}

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

if (xomTriggersOn)
{
    xomTriggers.vlocity_namespace__IsTriggerOn__c = true;
    update xomTriggers;
}
