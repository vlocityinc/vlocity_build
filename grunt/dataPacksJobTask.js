var yaml = require('js-yaml');
var fs = require('fs-extra');
var path = require('path');
var notifier = require('node-notifier');
var async = require('async');

var node_vlocity = require('../node_vlocity/vlocity.js');

module.exports = function (grunt) {

    function getVlocity() {
        var properties = grunt.config.get('properties');
        var jobStartTime = Date.now();

        var username = grunt.option('sf.username') ? grunt.option('sf.username') : properties['sf.username'];

        var password = grunt.option('sf.password') ? grunt.option('sf.password') : properties['sf.password'];

        var namespace = grunt.option('vlocity.namespace') ? grunt.option('vlocity.namespace') : properties['vlocity.namespace'];

        var loginUrl = grunt.option('sf.loginUrl') ? grunt.option('sf.loginUrl') : properties['sf.loginUrl'];

        var sessionId = grunt.option('sf.sessionId') ? grunt.option('sf.sessionId') : properties['sf.sessionId'];

        var instanceUrl = grunt.option('sf.instanceUrl') ? grunt.option('sf.instanceUrl') : properties['sf.instanceUrl'];

        var vlocity = new node_vlocity({
          username: username, 
          password: password, 
          vlocityNamespace: namespace,
          loginUrl: loginUrl,
          sessionId: sessionId,
          instanceUrl: instanceUrl,
          verbose: grunt.option('verbose')
        });

        return vlocity;
    }

	function dataPacksJob(action, jobName, callback, testData) {
        var jobStartTime = Date.now();

        var vlocity = getVlocity();

        var properties = grunt.config.get('properties');

        var dataPacksJobFolder = grunt.option('vlocity.dataPacksJobFolder') ? grunt.option('vlocity.dataPacksJobFolder') : properties['vlocity.dataPacksJobFolder'];

        if (!dataPacksJobFolder || testData) {
            dataPacksJobFolder = './dataPacksJobs'; 
        }

      	grunt.log.writeln('DataPacks Job Started - ' + jobName + ' Org: ' + vlocity.username);

      	var dataPacksJobsData = {};
      	var queryDefinitions;

		try {
		    queryDefinitions = yaml.safeLoad(fs.readFileSync('./dataPacksJobs/QueryDefinitions.yaml', 'utf8'));
		} catch (e) {
		    console.log(e);
		}

		var dataPackFolderExists;

		try {
	      	fs.readdirSync(dataPacksJobFolder).filter(function(file) {
	      		try {
                    if (file.indexOf('.yaml') != -1) {
    	      			var fileName = file.substr(0, file.indexOf('.'));
    	      			dataPacksJobsData[fileName] = yaml.safeLoad(fs.readFileSync(dataPacksJobFolder + '/' + file, 'utf8'));
                        
    	      			dataPacksJobsData[fileName].QueryDefinitions = queryDefinitions;
                    }
	      		} catch (jobError) { 
	      			console.log('Error loading Job File ' + file, jobError);
	      		}
	    	});
		} catch (e2) {
			console.log('No DataPacksJob Folder Found: ' + dataPacksJobFolder);
		}

        try {
    	    if (dataPacksJobsData[jobName]) {
                // This allows specifying a path as a property
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

                if (action == 'ExportSingle') {

                    var dataPackType;
                    var dataPackId;

                    if (grunt.option('type') && grunt.option('id')) {
                        dataPackType = grunt.option('type');
                        dataPackId = grunt.option('id');
                    } else if (testData) {
                        dataPackType = testData.dataPackType;
                        dataPackId = testData.dataPackId;
                    } else {
                        console.log('No Export Data Specified');
                        return callback(jobName);
                    }

                    dataPacksJobsData[jobName].queries = null;
                    dataPacksJobsData[jobName].manifest = {};
                    dataPacksJobsData[jobName].manifest[dataPackType] = [ dataPackId ];

                    action = 'Export';
                }

                if (action == 'ExportAllDefault' && queryDefinitions) {
                    dataPacksJobsData[jobName].queries = Object.keys(queryDefinitions);
                    dataPacksJobsData[jobName].ignoreQueryErrors = true;

                    action = 'Export';
                }

                if (grunt.option('depth') != null) {
                    dataPacksJobsData[jobName].maxDepth = parseInt(grunt.option('depth'));
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
    						grunt.fail.fatal('DataPacks Job Failed - ' + action + ' - ' + jobName + '\nErrors:\n' + result.errorMessage);
    						callback(result);
    					});
    			});
    	    } else {
    	    	grunt.log.error('DataPacks Job Not Found - ' + jobName);
                callback(jobName);
    	    }
        } catch (e) {
            console.log(e)
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
	                if (!/QueryDefinitions/.test(fileName)) {
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
	
    grunt.registerTask('packExport', 'Export all DataPacks', function() {
        
        var done = this.async();

        dataPacksJob('Export', grunt.option('job'), function() {
            done();
        });
    });

    grunt.registerTask('packExportSingle', 'Export a Single DataPack', function() {
        
        var done = this.async();

        dataPacksJob('ExportSingle', grunt.option('job'), function() {
            done();
        });
    });

    grunt.registerTask('packExportAllDefault', 'Export All DataPack Types defined in QueryDefinitions', function() {
        
        var done = this.async();

        dataPacksJob('ExportAllDefault', grunt.option('job'), function() {
            done();
        });
    });

    grunt.registerTask('packAllExport', 'Run Export for all Jobs in vlocity.dataPacksJobFolder', function() {
        
        var done = this.async();

        runTaskForAllJobFiles('Export', function() {
            done();
        });
    });

	grunt.registerTask('packDeploy', 'Deploy all DataPacks', function() {
        
        var done = this.async();        

        dataPacksJob('Deploy', grunt.option('job'), function() {
            done();
        });
    });

    grunt.registerTask('packAllDeploy', 'Run Deploy for all Jobs in vlocity.dataPacksJobFolder', function() {
        
        var done = this.async();

        runTaskForAllJobFiles('Deploy', function() {
            done();
        });
    });

    grunt.registerTask('packGetDiffs', 'Find all Diffs in Org Compared to Local Files', function() {
        
        var done = this.async();        

        dataPacksJob('GetDiffs', grunt.option('job'), function() {
            done();
        });
    });

    grunt.registerTask('packGetDiffsAndDeploy', 'Find all Diffs then Deploy only the Changed DataPacks', function() {
        
        var done = this.async();        

        dataPacksJob('GetDiffsAndDeploy', grunt.option('job'), function() {
            done();
        });
    });

	grunt.registerTask('packBuildFile', 'Build a DataPack File from all DataPacks', function() {
		
		var done = this.async();		

		dataPacksJob('BuildFile', grunt.option('job'), function() {
		  	done();
		});
	});

    grunt.registerTask('packAllBuildFiles', 'Build a DataPack File for all Jobs in vlocity.dataPacksJobFolder', function() {
        
        var done = this.async();

        runTaskForAllJobFiles('BuildFile', function() {
            done();
        });
    });
   
    grunt.registerTask('packRetry', 'Continue Running a DataPacks Job Resetting Errors to Ready', function() {
        
        var done = this.async();        

        dataPacksJob('Retry', grunt.option('job'), function() {
            done();
        });
    });

	grunt.registerTask('packContinue', 'Continue a DataPack Job', function() {
		
		var done = this.async();		

		dataPacksJob('Continue', grunt.option('job'), function() {
		  	done();
		});
	});

    grunt.registerTask('runTestJob', 'Test of Primary Commands - Makes real changes to the Org', function() {
        
        var done = this.async();

        fs.removeSync('./test/testJobRunning');
        fs.copySync('./test/testJobData', './test/testJobRunning');

        var commands = [
                            'Deploy', 
                            'GetDiffs',
                            'Export',
                            'ExportSingle',
                            'GetDiffsAndDeploy', 
                            'BuildFile',
                            'JavaScript' 
                        ];

        if (grunt.option('test')) {
            commands = [ grunt.option('test') ];
        }

        var allElapsed = {};

        async.eachSeries(commands, function(command, callback) {

            grunt.log.ok('Testing: ' + command);
            var currentTime = Date.now();

            var testData = { dataPackType: 'VlocityUILayout', dataPackId: 'datapacktest-layout' };

            dataPacksJob(command, 'TestJob', function(jobInfo) {
                var hasErrors = false;

                if (!jobInfo.currentStatus || Object.keys(jobInfo.currentStatus).length == 0) {
                    grunt.log.error('No Status Found');
                    hasErrors = true;
                } else {
                    Object.keys(jobInfo.currentStatus).forEach(function(dataPackKey) {
                        if (command == 'BuildFile' || command =='JavaScript') {
                            if (jobInfo.currentStatus[dataPackKey] != 'Added') {
                                grunt.log.error(dataPackKey, jobInfo.currentStatus[dataPackKey]);
                                hasErrors = true;
                            }
                        } else if (jobInfo.currentStatus[dataPackKey] != 'Success'){
                            grunt.log.error(dataPackKey, jobInfo.currentStatus[dataPackKey]);
                            hasErrors = true;
                        }
                    });
                }

                if (jobInfo.hasErrors || hasErrors) {
                    grunt.fail.fatal('Test Failed');
                }

                allElapsed[command] = Math.floor((Date.now() - currentTime) / 1000);

                callback();
            }, testData);
        }, function(err, result) {

            commands.forEach(function(command) {
                grunt.log.ok(command + ': ' + allElapsed[command] + 's');
            });

            fs.removeSync('./test/testJobRunning');
            
            done();
        });
    });

    grunt.registerTask('runJavaScript', 'Run JavaScript on all DataPacks in the Project then recreate the files', function() {
        var done = this.async();        

        dataPacksJob('JavaScript', grunt.option('job'), function() {
            done();
        });
    });

    grunt.registerTask('packUpdateSettings', 'Update the DataPack Settings in your Org', function() {
        var done = this.async();

        var vlocity = getVlocity();

        var dataPacksJobsData = {
            UpdateSettings: {

              projectPath: './DataPackSettings',
              delete: true,
              defaultMaxParallel: 10,
              preJobApex: { Deploy: 'ResetDataPackMappings.cls' }
            }
          };

        vlocity.datapacksjob.runJob(dataPacksJobsData, 'UpdateSettings', 'Deploy',
                function(result) {
                    notifier.notify({
                        title: 'Vlocity deployment tools',
                        message: 'Configuration Updated',                      
                        icon: path.join(__dirname, '..', 'images', 'toast-logo.png'), 
                        sound: true
                    }, function (err, response) {
                        grunt.log.ok('Configuration Updated');
                        done();
                    });
                },                      
                function(result) {
                    notifier.notify({
                        title: 'Vlocity deployment tools',
                        message: 'Configuration Update Failed',                      
                        icon: path.join(__dirname, '..', 'images', 'toast-logo.png'), 
                        sound: true
                    }, function (err, response) {
                        grunt.fatal('Configuration Update Failed \nErrors:\n' + result.errorMessage);
                        done();
                    });
        });
    });

    grunt.registerTask('runApex', 'Run Anonymous Apex specified by option -apex', function() {
        var self = this;

        var done = this.async();

        var vlocity = getVlocity();
    
        vlocity.checkLogin(function(res) {

            var apexClass = grunt.option('apex');

            var folder = './apex';

            if (grunt.option('folder')) {
                folder = grunt.option('folder');
            }

            return vlocity.datapacksutils.runApex(folder, apexClass, [])
            .then(function(result) { 
                console.log('result', result);
                done(); 
            });
        });
    });

  	return dataPacksJob;
};
