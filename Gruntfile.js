'use strict';

var vlocitycli = require('./lib/vlocitycli.js');
module.exports = function(grunt) {
    grunt.log.oklns("Vlocity Build Tools");

    Object.keys(VLOCITY_COMMANDLINE_COMMANDS).forEach(function(task) {

        grunt.registerTask(task, VLOCITY_COMMANDLINE_COMMANDS[task].description, function() {
            var done = this.async();

            new vlocitycli().runCLI([task], function(result) {
                grunt.log.ok(result);
                done();
            }, function(result) {
                grunt.fatal(result);
                done();
            });
        });
    });

    grunt.registerTask('default', 'There is no Default task defined for this Project', function() {
        console.log('Use', '\x1b[32m', 'grunt --help', '\x1b[0m', 'to see a full list of commands');
    });
};