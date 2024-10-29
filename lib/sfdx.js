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
	_run(`sf project deploy start --metadata-dir "${deploydir}" --target-org "${targetusername}" -w 1 --verbose`);
}

const run = async(command, options) => {
	if (command === 'source:convert') {
		return _sourceConvert(options.rootdir, options.outputdir, options.useSfdxCli);
	} else if (command === 'mdapi:deploy'){
		return _mdapiDeploy(options.targetusername, options.deploydir, options.useSfdxCli);
	}
}

module.exports = {
	run
}
