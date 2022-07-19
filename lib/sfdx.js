const shell = require('shelljs');

const _run = (command) => {
	command += ' --json';
	const exec = shell.exec(command, { silent: true });
	return { ...exec, stdout: JSON.parse(exec.stdout) }
}

const sourceConvert = async (rootdir, outputdir) => {
	return _run(`sfdx force:source:convert --rootdir "${rootdir}" --outputdir "${outputdir}"`);
}

const mdapiDeploy = async (deploydir) => {
	return _run(`sfdx force:mdapi:deploy --deploydir "${deploydir}" -w -1 --verbose`);
}

module.exports = {
	sourceConvert,
	mdapiDeploy
}