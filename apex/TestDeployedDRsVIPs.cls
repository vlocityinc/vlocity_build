String Acct1Id = '';
List < Account > accts =[SELECT Id, Name FROM Account WHERE Name = 'VBT_TestAutomation1'];
if (accts.size() > 0) {
    Acct1Id = accts[0].Id;
    Contact[] contacts = [SELECT Id, Name FROM Contact WHERE AccountId = : Acct1Id];
    if (contacts.isEmpty()) {
        upsert(new Contact(FirstName = 'VBT_', LastName = 'TestAutomation', AccountId = accts[0].Id));
    }
} else {
    Account newAcct = (new Account(Name = 'VBT_TestAutomation1'));
    upsert newAcct;
    upsert(new Contact(FirstName = 'VBT', LastName = 'TestAutomation', AccountId = newAcct.Id));
    Acct1Id = newAcct.Id;
    upsert(new Account(Name = 'VBT_TestAutomation2'));
    upsert(new Account(Name = 'VBT_TestAutomation3'));
}

vlocity_namespace.DRProcessResult result = vlocity_namespace.DRGlobal.processObjectsJSON('{"Name":"TestAuto"}', 'datapacktest_Extract');
List < Object > outputDr1 = (List < Object >)result.convertToMap().get('returnResultsData');
System.assertEquals(outputDr1.size(), 2);
System.assert(JSON.serialize(outputDr1[0]).contains('VBT_TestAutomation1'));
System.assert(JSON.serialize(outputDr1[1]).contains('VBT_TestAutomation2'));

result = vlocity_namespace.DRGlobal.processObjectsJSON('{"Name":"TestAuto"}', 'datapacktest_Turbo');
String outputDrTurbo = JSON.serialize(result.convertToMap());
System.assert(outputDrTurbo.contains('VBT TestAutomation'));
System.assert(outputDrTurbo.contains(Acct1Id));


Map < String, Object > ipOutput = (Map < String, Object >) vlocity_namespace.IntegrationProcedureService.runIntegrationService('DataPackTest_DRExtractWithInput', new Map < String, Object > { 'Name' => 'TestAuto' }, new Map < String, Object > ());
System.assertEquals((String)ipOutput.get('accountId'), Acct1Id);
System.assertEquals((String)ipOutput.get('accountName'), 'VBT_TestAutomation1');
System.assertEquals((String)ipOutput.get('firstName'), 'VBT');
System.assertEquals((String)ipOutput.get('lastName'), 'TestAutomation');