const shell = require('shelljs');

const _run = (command) => {
	command += ' --json';
	const exec = shell.exec(command, { silent: true });
	let stdout;

	try {
		stdout = JSON.parse(exec.stdout);
	}catch(e) {
		throw new Error('Error parsing stdout', { cause: e });
	}

	if(stdout.status == 1){
		const error = new Error(`Command responded with error: ${command}`);
		throw Object.assign(error , { stdout });
	}

	if(exec.stderr || exec.code === 1){
		const error = new Error(`Process error while running: ${command}`);
		throw Object.assign(error , { stderr: exec.stderr, code: exec.code });
	}

	return stdout.result;
}

const _sourceConvert = async (rootdir, outputdir) => {
	return _run(`sfdx force:source:convert --rootdir "${rootdir}" --outputdir "${outputdir}" -u "${options.targetusername}"`);
}

const _mdapiDeploy = async (targetusername, deploydir) => {
	return _run(`sfdx force:mdapi:deploy --deploydir "${deploydir}" --targetusername "${targetusername}" -w -1 --verbose`);
}

const run = async(command, options) => {
	if (command === 'source:convert') {
		return _sourceConvert(options.rootdir, options.outputdir, options.targetusername);
	} else if (command === 'mdapi:deploy'){
		return _mdapiDeploy(options.targetusername, options.deploydir);
	}
}

module.exports = {
	run
}