
String vlocityNamespace = 'vlocity_namespace';

if (String.isNotBlank(vlocityNamespace)) {
    vlocityNamespace += '__';
}

List<String> typesWithGlobalKey = new List<String>{
 
    vlocityNamespace + 'ContextAction__c',
    vlocityNamespace + 'ContextDimension__c',
    vlocityNamespace + 'ContextScope__c',
    vlocityNamespace + 'EntityFilter__c',
    vlocityNamespace + 'ObjectClass__c',
    vlocityNamespace + 'ObjectElement__c',
    vlocityNamespace + 'ObjectFacet__c',
    vlocityNamespace + 'ObjectFieldAttribute__c',
    vlocityNamespace + 'ObjectLayout__c',
    vlocityNamespace + 'ObjectRuleAssignment__c',
    vlocityNamespace + 'ObjectSection__c',
    vlocityNamespace + 'OrchestrationDependencyDefinition__c',
    vlocityNamespace + 'OrchestrationItemDefinition__c',
    vlocityNamespace + 'OrchestrationPlanDefinition__c',
    vlocityNamespace + 'Picklist__c',
    vlocityNamespace + 'PicklistValue__c',
    vlocityNamespace + 'PriceListEntry__c',
    vlocityNamespace + 'PricingElement__c',
    'Product2',
    vlocityNamespace + 'ProductChildItem__c',
    vlocityNamespace + 'ProductConfigurationProcedure__c',
    vlocityNamespace + 'ProductRelationship__c',
    vlocityNamespace + 'Promotion__c',
    vlocityNamespace + 'Rule__c',
    vlocityNamespace + 'TimePlan__c',
    vlocityNamespace + 'TimePolicy__c',
    vlocityNamespace + 'UIFacet__c',
    vlocityNamespace + 'UISection__c',
    vlocityNamespace + 'VlocityFunctionArgument__c',
    vlocityNamespace + 'VlocityFunction__c'
};

for (String sobjType : typesWithGlobalKey) 
{
    try 
    {
        if (Database.countQuery('SELECT count() FROM ' + sobjType + ' WHERE ' + vlocityNamespace + 'GlobalKey__c = null') > 0)
        {
            Database.executeBatch(new vlocity_namespace.GenerateMatchingGlobalKeyBatch(
                sobjType, 
                new List<String>{  }, 
                vlocityNamespace + 'GlobalKey__c',
                false,
                new Map<String, Object>()), 1);
        }
    }
    catch (Exception e)
    {
        // Likely due to the Type not Existing 
        // Will ignore incase of mismatched Package Versions with newer objects
        System.debug(e);
    }
}