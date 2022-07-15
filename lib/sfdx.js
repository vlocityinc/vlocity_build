const shell = require('shelljs');

const _run = (command) => {
	command += ' --json';
	return shell.exec(command, { silent: true });
}

const sourceConvert = async (rootdir, outputdir) => {
	return _run(`sfdx force:source:convert --rootdir "${rootdir}" --outputdir "${outputdir}"`);
}

const mdapiDeploy = async (deploydir) => {
	return _run(`sfdx force:mdapi:deploy --deploydir "${deploydir}" -w 60 --soapdeploy --testlevel NoTestRun`);
}

module.exports = {
	sourceConvert,
	mdapiDeploy
}