// CURRENT_DATA_PACKS_CONTEXT will be replaced with:
// 1. The Manifest being exported
// 2. The Query results being exported
// 3. A Summary of the DataPack data being imported
List<Object> dataSetObjects = (List<Object>)JSON.deserializeUntyped('CURRENT_DATA_PACKS_CONTEXT_DATA');

List<Map<String, Object>> dataPackDataSet = new List<Map<String, Object>>();

for (Object obj : dataSetObjects)
{
	if (obj != null)
	{
		dataPackDataSet.add((Map<String, Object>)obj);
	}
}