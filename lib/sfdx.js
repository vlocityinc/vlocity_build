const shell = require('shelljs');
const fs = require('fs');

const _run = (command) => {
	command += ' --json';
	VlocityUtils.report("Command to be executed is ",command);
	const exec = shell.exec(command, { env: { ...process.env, FORCE_COLOR: 0 }, silent: true });
	let stdout;

	try {
		stdout = JSON.parse(exec.stdout);
	}catch(e) {
		throw new Error('Error parsing stdout', { cause: e });
	}

	if (stdout.status == 1){
		const error = new Error(`Command responded with error: ${command}`);
		throw Object.assign(error , { stdout });
	}

	if (exec.code === 1){
		const error = new Error(`Process error while running: ${command}`);
		throw Object.assign(error , { stderr: exec.stderr, code: exec.code });
	}

	return stdout.result;
}

const _sourceConvert = async (rootdir, outputdir, useSfdxCli) => {
	return useSfdxCli ? _run(`sfdx force:source:convert --rootdir "${rootdir}" --outputdir "${outputdir}"`) : 
	_run(` sf project convert source --root-dir "${rootdir}" --output-dir "${outputdir}"`);
}

const _mdapiDeploy = async (targetusername, deploydir, useSfdxCli) => {
	return useSfdxCli ? _run(`sfdx force:mdapi:deploy --deploydir "${deploydir}" --targetusername "${targetusername}" -w -1 --verbose`) :
	_run(`sf project deploy start --metadata-dir "${deploydir}" --target-org "${targetusername}" --verbose`);
}

const _orgDisplay = async (targetusername) => {
	return _run(`sf org display --target-org "${targetusername}"  --verbose`);
}

const _sourceDeploy = async (targetusername,sourcePath) =>{
	VlocityUtils.verbose('Source deploy called with:', { targetusername, sourcePath });
	if(isEmptyDir(sourcePath)) {
		VlocityUtils.verbose('Source path is empty, returning early');
		return {details: { componentSuccesses :[]}};
	}
	VlocityUtils.verbose('Source path is not empty, proceeding with deployment');
	return _run(`sf project deploy start --source-dir "${sourcePath}" --target-org "${targetusername}"`);
}

const _listMetadata = async (targetusername,metadatatype) => {
	return _run (`sf org list metadata --target-org "${targetusername}" --metadata-type "${metadatatype}"`)
}
const _sourceRetrieve = async (targetusername,sourcePath,metadata) =>{
	var cmd = `sf project retrieve start --target-org "${targetusername}" `;
	if(sourcePath) cmd += `--source-dir "${sourcePath}" `;
	if(metadata)  cmd += `--metadata "${metadata}" `;
	return _run(cmd);
}
const _orgLogin = async (authFilePath) =>{
    return _run(`sf org login sfdx-url  --sfdx-url-file ${authFilePath}`);
}

function isEmptyDir(path) {  
    try {
      VlocityUtils.verbose('Checking if directory is empty:', path);
      const directory =  fs.opendirSync(path)
      const entry =  directory.readSync()
       directory.closeSync()

      const isEmpty = entry === null;
      VlocityUtils.verbose('Directory empty check result:', isEmpty, 'First entry:', entry ? entry.name : 'null');
      return isEmpty
    } catch (error) {
      VlocityUtils.error('Error checking if directory is empty:', path, error);
      return false
    }
}

const run = async(command, options) => {
	if (command === 'source:convert') {
		return _sourceConvert(options.rootdir, options.outputdir, options.useSfdxCli);
	} else if (command === 'mdapi:deploy'){
		return _mdapiDeploy(options.targetusername, options.deploydir, options.useSfdxCli);
	} else if (command === 'org display'){
		return _orgDisplay(options.targetusername);
	} else if (command === 'source:deploy'){
		return _sourceDeploy(options.targetusername,options.sourcepath);
	} else if (command == 'source:retrieve') {
		return _sourceRetrieve (options.targetusername,options.sourcePath,options.metadata);
	} else if (command == 'mdapi:listmetadata') {
		return _listMetadata(options.targetusername,metadatatype);
	} else if(command =='org login') {
        return _orgLogin(options.authfilepath);
    }
}

module.exports = {
	run
}
