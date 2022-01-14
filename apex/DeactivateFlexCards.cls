//include BaseUtilities.cls;

List<String> allFlexCardNames = new List<String>();

for (Map<String, Object> obj : dataPackDataSet)
{
	if (obj.get('VlocityRecordSObjectType') == 'OmniUiCard')
	{
		allFlexCardNames.add((String)obj.get('Name'));
	}

}

List<OmniUiCard> flexCards = [SELECT Id, Name, IsActive FROM OmniUiCard WHERE Name in :allFlexCardNames AND IsActive = true];

for (OmniUiCard temp : flexCards)
{
	temp.IsActive = false;
}

if (flexCards.size() > 0)
{
	update flexCards;
}
