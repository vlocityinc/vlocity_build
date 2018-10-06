List<vlocity_namespace__AttributeAssignment__c> toDelete = new List<vlocity_namespace__AttributeAssignment__c>();

Set<Id> allIds = new Set<Id>();
Set<Schema.SObjectType> types = new Set<Schema.SObjectType>();

for (vlocity_namespace__AttributeAssignment__c att : [ SELECT vlocity_namespace__ObjectId__c FROM vlocity_namespace__AttributeAssignment__c ])
{
    try 
    {
        Schema.SObjectType objType = ((Id)att.vlocity_namespace__ObjectId__c).getSObjectType();

        if (objType != null) 
        {
            types.add(objType);
            allIds.add((Id)att.vlocity_namespace__ObjectId__c);
        }
        else 
        {
           toDelete.add(att);
        }
    }
    catch (Exception e)
    {
        System.debug(e);

        toDelete.add(att);
    }
}

Set<Id> allFoundIds = new Set<Id>();

for (Schema.SObjectType objType : types)
{
    for (SObject obj : Database.query('SELECT Id FROM ' + objType))
    {
        allFoundIds.add(obj.Id);
    }
}

Set<Id> allDeletedIds = new Set<Id>();

for (vlocity_namespace__AttributeAssignment__c att : [ SELECT vlocity_namespace__ObjectId__c FROM vlocity_namespace__AttributeAssignment__c ])
{
    if (!allFoundIds.contains((Id)att.vlocity_namespace__ObjectId__c))
    {
        toDelete.add(att);
        allDeletedIds.add(att.Id);
    }
}

delete [ SELECT Id FROM vlocity_namespace__OverrideDefinition__c WHERE vlocity_namespace__OverriddenAttributeAssignmentId__c in :allDeletedIds OR vlocity_namespace__OverridingAttributeAssignmentId__c in :allDeletedIds ];

delete toDelete;