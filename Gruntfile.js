
'use strict';
var loadProperties = require('./grunt/loadProperties.js');

var tasksToLoad = [ 'dataPacksJob' ];

module.exports = function(grunt) {
  grunt.log.oklns("Vlocity Build Tools");

  var properties = loadProperties(grunt);

  // Load grunt tasks automatically
  require('load-grunt-tasks')(grunt, {pattern: ['grunt-*', '!grunt-template-jasmine-istanbul']});

  grunt.initConfig({
    properties: properties
  });

  tasksToLoad.forEach(function(taskName) {
    var config = require('./grunt/' + taskName + 'Task.js')(grunt);
    if (config) {
      grunt.config.merge(config);
    }
  });

  grunt.registerTask("build-js", [ ]);
};
