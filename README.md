Initial Setup  

Install Homebrew (Mac Only)  
ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"
More Info: http://brew.sh/  

Install Apache Ant
http://ant.apache.org/manual/install.html  

Install Node.js  
https://nodejs.org/  

Use the following commands:  
brew install nvm  

mkdir ~/.nvm  
export NVM_DIR="$HOME/.nvm"  
. "$(brew --prefix nvm)/nvm.sh"  
nvm install v4.3  
nvm use 4.3  
npm rebuild node-sass  

To begin, fill in the information in the build.properties file, or create your own property file.

sf.username: Salesforce Username  
sf.password: Salesforce Password  
vlocity.namespace: The namespace of the Vlocity Package. vlocity_ins, vlocity_cmt, or vlocity_ps  
vlocity.dataPackJob: The name of the Job being run.  


To run a DataPack Job through Ant use the following:  
"ant packDeploy" - Deploy the files specified in the Job  
or  
"ant packExport" - Export from the org to the local file system  

Also supports "-propertyfile filename.properties"

To run a DataPack job through Grunt use the following:  
grunt -job JOB_FILE_NAME ACTION_NAME

The supported ACTION_NAMEs are as follow:  
packDeploy: Deploy all contents of folder in expansionPath  
packImport: Import contents of file in buildFile  
packExport: Export from all queries and manifest  
packBuildFile: Build the buildFile from the expansionPath data  
packExpandFile: Create the contents of folders in expansionPath from the buildFile  

The files defining Jobs can be found in the dataPacksJobs folder.  

For a complete job definition see dataPacksJobs/ReadMe-Example.yaml which includes detailed information on each property.




