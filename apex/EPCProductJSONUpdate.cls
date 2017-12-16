//include BaseUtilities.cls;

List<Id> productIds = new List<Id>();

for (Map<String, Object> obj : dataPackDataSet)
{
    if (obj.containsKey('Id') && ((Id)obj.get('Id')).getSObjectType() == Product2.SObjectType)
    {
        productIds.add((Id)obj.get('Id'));
    }
}

if (productIds.size() > 0)
{
    Database.executeBatch(new vlocity_namespace.EPCProductAttribJSONBatchJob(epcProducts), 1);
}