var request = require("request");
var yaml = require("js-yaml");
var fs = require("fs-extra");
var path  = require("path");
var stringify = require('json-stable-stringify');
var unidecode = require('unidecode'); 

var DataPacksExportBuildFile = module.exports = function(vlocity) {
    var self = this;
    self.vlocity = vlocity || {};
    self.utils = self.vlocity.datapacksutils;
};

DataPacksExportBuildFile.prototype.resetExportBuildFile = function(jobInfo) {

   fs.outputFileSync(jobInfo.projectPath + '/' + jobInfo.exportBuildFile, stringify([], { space: 4 }), 'utf8');
};

DataPacksExportBuildFile.prototype.addToExportBuildFile = function(jobInfo, dataPackData) {
    var self = this;

    if (!self.currentExportFileData) {
        self.currentExportFileData = JSON.parse(fs.readFileSync(jobInfo.projectPath + '/' + jobInfo.exportBuildFile, 'utf8'));
    }

    dataPackData.dataPacks.forEach(function(dataPack) {
        if (dataPack.VlocityDataPackStatus == 'Success' && jobInfo.addedToExportBuildFile.indexOf(dataPack.VlocityDataPackKey) == -1) {
            self.currentExportFileData.push(dataPack);
            jobInfo.addedToExportBuildFile.push(dataPack.VlocityDataPackKey)
        }
    });

    fs.outputFileSync(jobInfo.projectPath + '/' + jobInfo.exportBuildFile, stringify(self.currentExportFileData, { space: 4 }), 'utf8');
};
