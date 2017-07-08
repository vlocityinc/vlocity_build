
'use strict';
var loadProperties = require('./grunt/loadProperties.js');
var path = require('path');
var fs = require('fs');
var tasksToLoad = [ 'dataPacksJob' ];

module.exports = function(grunt) {
  grunt.log.oklns("Vlocity Build Tools");

  var properties = loadProperties(grunt);

  // at the moment grunt-notify does not support custom logos on windows
  // and as such we just copy over the grunt logo here 
  try {
    var defaultToastLogo = path.resolve(__dirname, './node_modules/grunt-notify/images/grunt-logo.png');
    var vlocityToastLogo = path.resolve(__dirname, './images/toast-logo.png');
    fs.createReadStream(vlocityToastLogo).pipe(fs.createWriteStream(defaultToastLogo));  
  } catch(err) {
    // we do not want to fail because we can't copy a logo
    grunt.log.warn("Error while copying logo");
  }

  // Load grunt tasks automatically
  require('load-grunt-tasks')(grunt, {pattern: ['grunt-*', '!grunt-template-jasmine-istanbul']});

  grunt.initConfig({
    properties: properties,
    // setup notify to use a proper title
    notify_hooks: {
      options: {
        title: "Vlocity deployment tools",
        success: true, 
        duration: 5
      }
    }
  });

  // We need to run notify_hooks to have our options loaded
  grunt.task.run('notify_hooks');

  tasksToLoad.forEach(function(taskName) {
    var config = require('./grunt/' + taskName + 'Task.js')(grunt);
    if (config) {
      grunt.config.merge(config);
    }
  });

  grunt.registerTask("build-js", [ ]);
};
