
void setTemplatesActiveStatus(Boolean status)
{
  	List<vlocity_namespace__VlocityUITemplate__c> layouts = [SELECT Id, Name, Active__c FROM vlocity_namespace__VlocityUITemplate__c];

    for (vlocity_namespace__VlocityUITemplate__c layout : layouts)
    {
    	layout.Active__c = status;
    }

    update layouts;
}