const shell = require('shelljs');

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

const _sourceConvert = async (rootdir, outputdir) => {
	return _run(` sf project convert source --root-dir "${rootdir}" --output-dir "${outputdir}"`);
}

const _mdapiDeploy = async (targetusername, deploydir) => {
	return _run(`sf project deploy start --metadata-dir "${deploydir}" --target-org "${targetusername}" -w -1 --verbose`);
}

const _orgDisplay = async (targetusername) => {
	return _run(`sf org display --target-org "${targetusername}"`);
}

const _sourceDeploy = async (targetusername,sourcePath) =>{
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

const run = async(command, options) => {
	if (command === 'source:convert') {
		return _sourceConvert(options.rootdir, options.outputdir);
	} else if (command === 'mdapi:deploy'){
		return _mdapiDeploy(options.targetusername, options.deploydir);
	} else if (command === 'org:display'){
		return _orgDisplay(options.targetusername);
	} else if (command === 'source:deploy'){
		return _sourceDeploy(options.targetusername,options.sourcepath);
	} else if (command == 'source:retrieve') {
		return _sourceRetrieve (options.targetusername,options.sourcePath,options.metadata);
	} else if (command == 'mdapi:listmetadata') {
		return _listMetadata(options.targetusername,metadatatype);
	}
}

module.exports = {
	run
}
