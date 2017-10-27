delete [ SELECT Id FROM vlocity_namespace__DRBundle__c WHERE vlocity_namespace__Type__c = 'Migration'];

vlocity_namespace.CorePostInstallClass.runDev2ProdInserts();