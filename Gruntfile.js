
'use strict';
var loadProperties = require('./grunt/loadProperties.js');
var tasksToLoad = [ 'dataPacksJob' ];

module.exports = function(grunt) {
  grunt.log.oklns("Vlocity Build Tools");

  var properties = loadProperties(grunt);

  grunt.initConfig({
    properties: properties
  });

  tasksToLoad.forEach(function(taskName) {
    var config = require('./grunt/' + taskName + 'Task.js')(grunt);
    if (config) {
      grunt.config.merge(config);
    }
  });

  grunt.registerTask('default', 'There is no Default task defined for this Project', function() {
    console.log('Use','\x1b[32m', 'grunt --help', '\x1b[0m', 'to see a full list of commands');
  });
};
