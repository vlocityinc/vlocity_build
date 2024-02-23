const shell = require('shelljs');

const _run = (command) => {
	command += ' --json';
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
	VlocityUtils.report("stdout is ", stdout);
	return stdout.result;
}

const _sourceConvert = async (rootdir, outputdir) => {
	return _run(`sf force:source:convert --root-dir "${rootdir}" --output-dir "${outputdir}"`);
}

const _mdapiDeploy = async (targetusername, deploydir) => {
	return _run(`sf project deploy start --metadata-dir "${deploydir}" --target-org "${targetorg}" -w -1 --verbose`);
}

const _orgDisplay = async (targetusername) => {
	return _run(`sf org display --target-org "${targetusername}"`);
}

const run = async(command, options) => {
	if (command === 'source:convert') {
		return _sourceConvert(options.rootdir, options.outputdir);
	} else if (command === 'mdapi:deploy'){
		return _mdapiDeploy(options.targetusername, options.deploydir);
	} else if (command === 'org:display'){
		return _orgDisplay(options.targetusername);
	}
}

module.exports = {
	run
}
