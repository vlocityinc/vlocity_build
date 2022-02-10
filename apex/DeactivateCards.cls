//include BaseUtilities.cls;

List < String > allCardsNames = new List < String > ();

for (Map < String, Object > obj : dataPackDataSet)
{
	if (obj.get('VlocityRecordSObjectType') == 'vlocity_namespace__VlocityCard__c') {
		allCardsNames.add((String)obj.get('Name'));
	}
}


List < OmniUiCard > cards =[SELECT Id, Name, IsActive FROM OmniUiCard WHERE Name in : allCardsNames AND IsActive = true];

for (OmniUiCard temp : cards)
{
	temp.IsActive = false;
}

if (cards.size() > 0) {
	update cards;
}