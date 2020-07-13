
var fs = require('fs-extra');

var StaticResources = module.exports = function(vlocity) {
    this.vlocity = vlocity;
};

StaticResources.generateHashCodeData = async function(input) {
	try {
		var dataPack = input.dataPack;
		var fileHash = { };

		var filesArray = JSON.parse(dataPack.SFDXData);

		filesArray.forEach(file => {
			fileHash[file.filePath] = fs.readFileSync(file.originalFilePath).toString('base64');
		});

		return fileHash;
	} catch (e) {
		VlocityUtils.error('Children Export Error', e);
	}

	return null;
}