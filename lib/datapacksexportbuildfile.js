var yaml = require("js-yaml");
var fs = require("fs-extra");
var path  = require("path");
var stringify = require('fast-json-stable-stringify');

var DataPacksExportBuildFile = module.exports = function(vlocity) {
    this.vlocity = vlocity || {};
    this.currentExportFileData = {};
};

DataPacksExportBuildFile.prototype.addToExportBuildFile = function(jobInfo, dataPackData) {
    var self = this;

    if (!dataPackData || !dataPackData.dataPacks) {
        return;
    }

    dataPackData.dataPacks.forEach(function(dataPack) {
        if (dataPack.VlocityDataPackStatus == 'Success') {

            var copiedDataPack = JSON.parse(JSON.stringify(dataPack));

            if (!copiedDataPack.VlocityDataPackParents) {
                copiedDataPack.VlocityDataPackParents = [];
            }

            if (!copiedDataPack.VlocityDataPackAllRelationships) {
                copiedDataPack.VlocityDataPackAllRelationships = {};
            }

            var dataPackUniqueInfo = copiedDataPack.VlocityDataPackData.Id && copiedDataPack.VlocityDataPackRelationshipType != 'Pagination' ? copiedDataPack.VlocityDataPackData.Id : copiedDataPack.VlocityDataPackKey;

            if (!self.currentExportFileData[dataPackUniqueInfo]) {
                self.currentExportFileData[dataPackUniqueInfo] = copiedDataPack;
            } else {
                var existingDataPack = self.currentExportFileData[dataPackUniqueInfo];

                copiedDataPack.VlocityDataPackParents.forEach(function(parentKey) {
                    if (existingDataPack.VlocityDataPackParents.indexOf(parentKey) == -1) {
                        existingDataPack.VlocityDataPackParents.push(parentKey);
                    }
                });

                Object.keys(copiedDataPack.VlocityDataPackAllRelationships).forEach(function(relKey) {
                    existingDataPack.VlocityDataPackAllRelationships[relKey] = copiedDataPack.VlocityDataPackAllRelationships[relKey];
                });
            }
        }
    });
};
