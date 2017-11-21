//include BaseUtilities.cls;

List<Id> productIds = new List<Id>();

for (Map<String, Object> obj : dataPackDataSet)
{
    if (obj.containsKey('Id') && ((Id)obj.get('Id')).getSObjectType() == Product2.SObjectType)
    {
        productIds.add((Id)obj.get('Id'));
    }
}

List<Id> epcProducts = new List<Id>();
List<Id> nonEpcProducts = new List<Id>();

for (Product2 prod : [Select Id, vlocity_namespace__ObjectTypeId__c from Product2 where Id in: productIds])
{
    if (prod.vlocity_namespace__ObjectTypeId__c == null)
    {
        nonEpcProducts.add(prod.Id);
    }
    else
    {
        epcProducts.add(prod.Id);
    }
}

if (epcProducts.size() > 0)
{
    Database.executeBatch(new vlocity_namespace.EPCProductAttribJSONBatchJob(epcProducts), 1);
}

if (nonEpcProducts.size() > 0)
{
    vlocity_namespace.ProductAttributeService.createProductAttributeJSON(nonEpcProducts);
}

