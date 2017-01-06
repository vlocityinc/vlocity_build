var request = require('request');
var yaml = require('js-yaml');
var fs = require('fs-extra');

var node_vlocity = require('../node_vlocity/vlocity.js');

var notify = require('../node_modules/grunt-notify/lib/notify-lib');

module.exports = function (grunt) {

    var dataPacksJobFolder = './dataPacksJobs';

	function dataPacksJob(action, jobName, callback, skipUpload) {

	  	var properties = grunt.config.get('properties');
	  	
	  	var vlocity = new node_vlocity({
          username: properties['sf.username'], 
          password: properties['sf.password'], 
          vlocityNamespace: properties['vlocity.namespace'],
          verbose: grunt.option('verbose'),
          loginUrl: properties['sf.loginUrl']
      	});

      	grunt.log.writeln('DataPacks Job Started - ' + jobName + ' Org: ' + properties['sf.username']);

      	var dataPacksJobsData = {};

      	fs.readdirSync(dataPacksJobFolder).filter(function(file) {

      		console.log(file);

      		try {
      			var fileName = file.substr(0,file.indexOf('.'));
      			dataPacksJobsData[fileName] = yaml.safeLoad(fs.readFileSync(dataPacksJobFolder + '/' + file, 'utf8'));
      		} catch (e) { 
      			//console.log(e);
      		}
    	});

	    if (dataPacksJobsData[jobName]) {
		    if (dataPacksJobsData[jobName].projectPath && properties[dataPacksJobsData[jobName].projectPath]) {
		    	dataPacksJobsData[jobName].projectPath = properties[dataPacksJobsData[jobName].projectPath];
		    }

		    if (dataPacksJobsData[jobName].projectPath) {
		    	dataPacksJobsData[jobName].projectPath = grunt.template.process(dataPacksJobsData[jobName].projectPath, {data: properties});
		    }

			if (grunt.option('query') && grunt.option('type')) {
				dataPacksJobsData[jobName].queries = [{
					query: grunt.option('query'),
	      			VlocityDataPackType: grunt.option('type')
				}];
			}

	    	vlocity.datapacksjob.runJob(dataPacksJobsData, jobName, action,
	    		function(result) {
	    			grunt.log.ok('DataPacks Job Success - ' + action + ' - ' + jobName);
	 
					notify({
			            title: 'DataPacks',
			            message: 'Success - ' + jobName
			          });
                    callback();
		    	},
		    	function(result) {
			    	grunt.log.error('DataPacks Job Failed - ' + action + ' - ' + jobName + ' - ' + result.errorMessage);

			    	notify({
			            title: 'DataPacks',
			            message: 'Failed - ' + jobName
			         });
                    callback(result);
			}, skipUpload);
	    } else {
	    	grunt.log.error('DataPacks Job Not Found - ' + jobName);
            callback(jobName);
	    }
	}

	grunt.registerTask('packDeploy', 'Run a DataPacks Job', function() {
		
		var done = this.async();		

		dataPacksJob('Deploy', grunt.option('job'), function() {
		  	done();
		});
	});

	grunt.registerTask('packExport', 'Run a DataPacks Job', function() {
		
		var done = this.async();

		dataPacksJob('Export', grunt.option('job'), function() {
		  	done();
		});
	});

	grunt.registerTask('packBuildFile', 'Run a DataPacks Job', function() {
		
		var done = this.async();		

		dataPacksJob('BuildFile', grunt.option('job'), function() {
		  	done();
		});
	});

    grunt.registerTask('packAllBuildFiles', 'Run a DataPacks Job', function() {
        
        var done = this.async();

        var dataPacksJobsData = {};

        fs.readdirSync(dataPacksJobFolder).filter(function(file) {
            try {
                var fileName = file.substr(0,file.indexOf('.'));
                if (!/ReadMe-Example/.test(fileName)) {
                    dataPacksJobsData[fileName] = yaml.safeLoad(fs.readFileSync(dataPacksJobFolder + '/' + file, 'utf8'));
                }
            } catch (e) {
                //console.log(e);
            }
        });

        var countDown = Object.keys(dataPacksJobsData).length;

        Object.keys(dataPacksJobsData).forEach(function(job, index) {
            grunt.log.ok('Kicking off ' + index + ' job');
            dataPacksJob('BuildFile', job, function() {
                countDown--;
                if (countDown === 0) {
                    grunt.log.ok('All files built successfully');
                    done();
                    return;
                }
                grunt.log.ok(countDown + ' packs left to build');
            }, true);
        })
    });

	grunt.registerTask('packExpandFile', 'Run a DataPacks Job', function() {
		
		var done = this.async();		

		dataPacksJob('ExpandFile', grunt.option('job'), function() {
		  	done();
		});
	});

  	return dataPacksJob;
};