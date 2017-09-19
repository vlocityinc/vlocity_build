var request = require('request');
var yaml = require('js-yaml');
var fs = require('fs-extra');
var path = require('path');
var notifier = require('node-notifier');

var node_vlocity = require('../node_vlocity/vlocity.js');

module.exports = function (grunt) {

    var dataPacksJobFolder = './dataPacksJobs';	

	function dataPacksJob(action, jobName, callback, skipUpload) {

	  	var properties = grunt.config.get('properties');
		var jobStartTime = Date.now();

	  	var vlocity = new node_vlocity({
          username: properties['sf.username'], 
          password: properties['sf.password'], 
          vlocityNamespace: properties['vlocity.namespace'],
          verbose: grunt.option('verbose'),
          loginUrl: properties['sf.loginUrl']
      	});

      	grunt.log.writeln('DataPacks Job Started - ' + jobName + ' Org: ' + properties['sf.username']);

      	if (properties['vlocity.dataPacksJobFolder']) {
      		dataPacksJobFolder = properties['vlocity.dataPacksJobFolder'];
      	}
      	
      	var dataPacksJobsData = {};
      	var queryDefinitions;

		try {
		    queryDefinitions = yaml.safeLoad(fs.readFileSync(dataPacksJobFolder + '/QueryDefinitions.yaml', 'utf8'));
		} catch (e) {
		    //console.log(e);
		}

		var dataPackFolderExists;

		try {
	      	fs.readdirSync(dataPacksJobFolder).filter(function(file) {
	      		try {
	      			var fileName = file.substr(0,file.indexOf('.'));
	      			dataPacksJobsData[fileName] = yaml.safeLoad(fs.readFileSync(dataPacksJobFolder + '/' + file, 'utf8'));

	      			dataPacksJobsData[fileName].QueryDefinitions = queryDefinitions;
	      		} catch (e1) { 
	      			//console.log(e1);
	      		}
	    	});
		} catch (e2) {
			console.log('No DataPacksJob Folder Found: ' + dataPacksJobFolder);
		}

	    if (dataPacksJobsData[jobName]) {
		    if (dataPacksJobsData[jobName].projectPath && properties[dataPacksJobsData[jobName].projectPath]) {
		    	dataPacksJobsData[jobName].projectPath = properties[dataPacksJobsData[jobName].projectPath];
		    }

		    if (dataPacksJobsData[jobName].projectPath) {
		    	dataPacksJobsData[jobName].projectPath = grunt.template.process(dataPacksJobsData[jobName].projectPath, {data: properties});
		    }

		    if (!dataPacksJobsData[jobName].projectPath) {
		    	dataPacksJobsData[jobName].projectPath = dataPacksJobFolder;
		    }

			if (grunt.option('query') && grunt.option('type')) {
				dataPacksJobsData[jobName].queries = [{
					query: grunt.option('query'),
	      			VlocityDataPackType: grunt.option('type')
				}];
			}

            if (action == 'ExportSingle' && grunt.option('type') && grunt.option('id')) {
                dataPacksJobsData[jobName].queries = null;
                dataPacksJobsData[jobName].manifest = {};
                dataPacksJobsData[jobName].manifest[grunt.option('type')] = [ grunt.option('id') ];

                if (grunt.option('depth') != null) {
                     dataPacksJobsData[jobName].maxDepth = parseInt(grunt.option('depth'));
                }

                action = 'Export';
            }
            
	    	vlocity.datapacksjob.runJob(dataPacksJobsData, jobName, action,
	    		function(result) {
					notifier.notify({
			            title: 'Vlocity deployment tools',
						message: 'Success - ' + jobName + '\n'+
								 'Job executed in ' + ((Date.now() - jobStartTime)  / 1000).toFixed(0) + ' second(s)',						
						icon: path.join(__dirname, '..', 'images', 'toast-logo.png'), 
						sound: true
					}, function (err, response) {
						grunt.log.ok('DataPacks Job Success - ' + action + ' - ' + jobName);
						callback(result);
					});
				},						
		    	function(result) {
					notifier.notify({
			            title: 'Vlocity deployment tools',
						message: 'Failed - ' + jobName + '\n'+
								 'Job executed in ' + ((Date.now() - jobStartTime)  / 1000).toFixed(0) + ' second(s)',						
						icon: path.join(__dirname, '..', 'images', 'toast-logo.png'), 
						sound: true
					}, function (err, response) {
						grunt.fatal('DataPacks Job Failed - ' + action + ' - ' + jobName + ' Errors: \n' + result.errorMessage);
						callback(result);
					});
			}, skipUpload);
	    } else {
	    	grunt.log.error('DataPacks Job Not Found - ' + jobName);
            callback(jobName);
	    }
	}

	function runTaskForAllJobFiles(taskName, callback) {
        var dataPacksJobsData = {};
        var properties = grunt.config.get('properties');

		if (properties['vlocity.dataPacksJobFolder']) {
      		dataPacksJobFolder = properties['vlocity.dataPacksJobFolder'];
      	}

      	try {

	        fs.readdirSync(dataPacksJobFolder).filter(function(file) {
	            try {
	                var fileName = file.substr(0,file.indexOf('.'));
	                if (!/ReadMe-Example|QueryDefinitions/.test(fileName)) {
	     				dataPacksJobsData[fileName] = yaml.safeLoad(fs.readFileSync(dataPacksJobFolder + '/' + file, 'utf8'));;
	                }
	            } catch (e) {
	                //console.log(e);
	            }
	        });

	        var countDown = Object.keys(dataPacksJobsData).length;

	        Object.keys(dataPacksJobsData).forEach(function(job, index) {
	            grunt.log.ok('Kicking off ' + index + ' job');
	            dataPacksJob(taskName, job, function(error) {

	            	if (error) {
	            		grunt.fail.warn(taskName + ': Failed');
	            	}
	                countDown--;
	                if (countDown === 0) {
	                    grunt.log.ok(taskName + ': All files successfully completed');
	                    callback();
	                    return;
	                }
	                grunt.log.ok(taskName + ': ' + countDown + ' Remaining');
	            }, true);
	        })
	    } catch (e) {
	    	console.log('Job Failed With Exception: ' + e.stack);
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

    grunt.registerTask('packExportSingle', 'Export a Single DataPack for this Job', function() {
        
        var done = this.async();

        dataPacksJob('ExportSingle', grunt.option('job'), function() {
            done();
        });
    });

	grunt.registerTask('packBuildFile', 'Run a DataPacks Job', function() {
		
		var done = this.async();		

		dataPacksJob('BuildFile', grunt.option('job'), function() {
		  	done();
		});
	});

	grunt.registerTask('packAllExport', 'Run a DataPacks Job', function() {
        
        var done = this.async();

        runTaskForAllJobFiles('Export', function() {
        	done();
        });
    });

    grunt.registerTask('packAllDeploy', 'Run a DataPacks Job', function() {
        
        var done = this.async();

        runTaskForAllJobFiles('Deploy', function() {
        	done();
        });
    });

    grunt.registerTask('packAllBuildFiles', 'Run a DataPacks Job', function() {
        
        var done = this.async();

        runTaskForAllJobFiles('BuildFile', function() {
        	done();
        });
    });

	grunt.registerTask('packExpandFile', 'Run a DataPacks Job', function() {
		
		var done = this.async();		

		dataPacksJob('ExpandFile', grunt.option('job'), function() {
		  	done();
		});
	});

    grunt.registerTask('packGetDiffs', 'Run a DataPacks Job', function() {
        
        var done = this.async();        

        dataPacksJob('GetDiffs', grunt.option('job'), function() {
            done();
        });
    });

    grunt.registerTask('packGetDiffsAndDeploy', 'Run a DataPacks Job that Exports all Diffs then Deploys only the Changed DataPacks', function() {
        
        var done = this.async();        

        dataPacksJob('GetDiffsAndDeploy', grunt.option('job'), function() {
            done();
        });
    });

    grunt.registerTask('packRetry', 'Continue Running a DataPacks Job Resetting Errors to Ready', function() {
        
        var done = this.async();        

        dataPacksJob('Retry', grunt.option('job'), function() {
            done();
        });
    });

	grunt.registerTask('packContinue', 'Run a DataPacks Job', function() {
		
		var done = this.async();		

		dataPacksJob('Continue', grunt.option('job'), function() {
		  	done();
		});
	});

    grunt.registerTask('runJavaScript', 'Run JavaScript', function() {
        var done = this.async();        

        dataPacksJob('JavaScript', grunt.option('job'), function() {
            done();
        });
    });

    grunt.registerTask('runApex', 'Run a DataPacks Job', function() {
        var self = this;

        var done = this.async();

        var properties = grunt.config.get('properties');
        
        var vlocity = new node_vlocity({
          username: properties['sf.username'], 
          password: properties['sf.password'], 
          vlocityNamespace: properties['vlocity.namespace'],
          verbose: grunt.option('verbose'),
          loginUrl: properties['sf.loginUrl']
        });

        vlocity.checkLogin(function(res) {
            vlocity.jsForceConnection.tooling.sobject('DebugLevel').find({ DeveloperName: "SFDC_DevConsole" }).execute(function(err, debugLevel) {

                var thirtyMinutesLater = new Date();
                thirtyMinutesLater.setMinutes(thirtyMinutesLater.getMinutes() + 30);
                var thirtyMinutesLaterString = thirtyMinutesLater.toISOString();

                vlocity.jsForceConnection.tooling.sobject('TraceFlag').create({
                    TracedEntityId: vlocity.jsForceConnection.userInfo.id,
                    DebugLevelId: debugLevel[0].Id,
                    ExpirationDate: thirtyMinutesLaterString,
                    LogType: 'DEVELOPER_LOG'
                }, function(err, res) {
                    console.log(res);

                    if (err) { 
                        console.error(err); 
                    }
        
                    vlocity.datapacksutils.runApex('.', 'test.cls', {}, function() {

                        vlocity.jsForceConnection.query("Select Id from ApexLog where Operation LIKE '%executeAnonymous' ORDER BY Id DESC LIMIT 1", function(err, res) {

                            vlocity.jsForceConnection.request("/services/data/v37.0/tooling/sobjects/ApexLog/" + res.records[0].Id + "/Body/", function(err, logBody) {

                                if (err) { 
                                    console.error('err', err); 
                                }

                                var allLoggingStatments = [];

                                logBody.split("\n").forEach(function(line) {
                                    var vPerfIndex = line.indexOf('VPERF');

                                    if (vPerfIndex > -1) {
                                        allLoggingStatments.push(line);
                                    }
                                });

                                console.log(allLoggingStatments);

                                done();  
                            });
                        });
                    });
                });
            });
        });
    });

  	return dataPacksJob;
};
