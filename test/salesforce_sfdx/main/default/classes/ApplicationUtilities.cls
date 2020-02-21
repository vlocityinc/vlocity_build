public with sharing abstract class ApplicationUtilities 
{
    public static Boolean useVlocityTriggers = true;
    
    private static String plainNamespace = null;
    private static String namespacePrefix = null;
    private static String namespaceDotNotation = null; 
    private static String namespaceURLFormat = null;
     
    public static String getNamespace()
    {   	
        if (plainNamespace == null)
        {
            String withDotNotation = ApplicationUtilities.class.getName();  
        
            if (withDotNotation.contains('.'))
            {
                plainNamespace = withDotNotation.substringBefore('.');
            }
            else
            {
                plainNamespace = ''; 
            }
        }
        return plainNamespace;   
    }
    
    public static String getNameSpacePrefix() 
    {
        if (namespacePrefix == null)
        {
            namespacePrefix = String.isNotBlank(getNamespace()) ? getNamespace() + '__' : '';
        }

        return namespacePrefix;   
    }

    public static String getNamespaceDotNotation()
    {
        if (namespaceDotNotation == null)
        {
            namespaceDotNotation = String.isNotBlank(getNamespace()) ? getNamespace() + '.' : '';
        }

        return namespaceDotNotation;   
    }

    public static String getNamespaceURLFormat()
    {
        if (namespaceURLFormat == null)
        {
            if (String.isNotBlank(getNamespace()))
            {
                 namespaceURLFormat = getNamespace().replace('_', '-');
            }
            else
            {
                namespaceURLFormat = ''; 
            }
        }

        return namespaceURLFormat;   
    }

}