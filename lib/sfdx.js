const shell = require('shelljs');
const fs = require('fs');

// Gates the CWE-78 shell-escaping fix (W-24098246). Defaults to OFF (legacy double-quoted
// behavior) so existing workflows are unaffected until explicitly opted in; set jobInfo/CLI
// enableSecurityValidations to true to turn on single-quote escaping.
let enableSecurityValidations = false;
const setEnableSecurityValidations = (value) => {
    enableSecurityValidations = value === true;
}

// Wraps a value in single quotes for safe interpolation into a shell command string,
// escaping any embedded single quotes (CWE-78, W-24098246). Double-quoting (the style
// this file used previously) only suppresses word-splitting/globbing - it still allows
// $(), backticks, and an embedded " to break out. Single-quoting disables ALL shell
// metacharacter interpretation (;, $(), backticks, |, &&, etc.).
const shellEscapeArg = (value) => {
    if (!enableSecurityValidations) {
        return `"${String(value)}"`;
    }
    return `'${String(value).replace(/'/g, "'\\''")}'`;
}

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
	return useSfdxCli ? _run(`sfdx force:source:convert --rootdir ${shellEscapeArg(rootdir)} --outputdir ${shellEscapeArg(outputdir)}`) :
	_run(` sf project convert source --root-dir ${shellEscapeArg(rootdir)} --output-dir ${shellEscapeArg(outputdir)}`);
}

const _mdapiDeploy = async (targetusername, deploydir, useSfdxCli, wait = 33) => {
	return useSfdxCli ? _run(`sfdx force:mdapi:deploy --deploydir ${shellEscapeArg(deploydir)} --targetusername ${shellEscapeArg(targetusername)} -w ${wait} --verbose`) :
	_run(`sf project deploy start --metadata-dir ${shellEscapeArg(deploydir)} --target-org ${shellEscapeArg(targetusername)} --wait ${wait} --verbose`);
}

const _orgDisplay = async (targetusername) => {
	var orgInfo = _run(`sf org display --target-org ${shellEscapeArg(targetusername)}  --verbose`);

	// SF CLI >= 2.136.8 redacts accessToken from sf org display output.
	// Use the new dedicated command to retrieve the actual access token.
	// Note: 'sf org auth show-access-token' only exists in SF CLI >= 2.136.8,
	// but this block only triggers when the token is redacted (i.e., on >= 2.136.8).
	if (!orgInfo.accessToken || orgInfo.accessToken.includes('[REDACTED]')) {
		try {
			var authResult = _run(`sf org auth show-access-token --target-org ${shellEscapeArg(targetusername)} --no-prompt`);
			orgInfo.accessToken = authResult.accessToken;
		} catch (e) {
			VlocityUtils.error('Failed to retrieve access token via "sf org auth show-access-token". Please upgrade SF CLI to >= 2.136.8 or re-authenticate.', e.message || e);
			throw new Error('Unable to retrieve access token. Ensure SF CLI >= 2.136.8 is installed and run "sf org login web" to re-authenticate.');
		}
	}

	return orgInfo;
}

const _sourceDeploy = async (targetusername,sourcePath) =>{
	VlocityUtils.verbose('Source deploy called with:', { targetusername, sourcePath });
	if(isEmptyDir(sourcePath)) {
		VlocityUtils.verbose('Source path is empty, returning early');
		return {details: { componentSuccesses :[]}};
	}
	VlocityUtils.verbose('Source path is not empty, proceeding with deployment');
	return _run(`sf project deploy start --source-dir ${shellEscapeArg(sourcePath)} --target-org ${shellEscapeArg(targetusername)}`);
}

const _listMetadata = async (targetusername,metadatatype) => {
	return _run (`sf org list metadata --target-org ${shellEscapeArg(targetusername)} --metadata-type ${shellEscapeArg(metadatatype)}`)
}
const _sourceRetrieve = async (targetusername,sourcePath,metadata) =>{
	var cmd = `sf project retrieve start --target-org ${shellEscapeArg(targetusername)} `;
	if(sourcePath) cmd += `--source-dir ${shellEscapeArg(sourcePath)} `;
	if(metadata)  cmd += `--metadata ${shellEscapeArg(metadata)} `;
	return _run(cmd);
}
const _orgLogin = async (authFilePath) =>{
    return _run(`sf org login sfdx-url  --sfdx-url-file ${shellEscapeArg(authFilePath)}`);
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
		return _mdapiDeploy(options.targetusername, options.deploydir, options.useSfdxCli, options.wait);
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
	run,
	shellEscapeArg,
	setEnableSecurityValidations
}
