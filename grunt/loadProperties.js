'use strict';
var path = require('path');
var fs = require('fs');
var _ = require('lodash');
var properties = require ('properties');


module.exports = function(grunt) {
  var basedir = process.env.PWD;

  if (!basedir) {
    basedir = process.cwd();
  }

  function loadProperties(file, returnNullOnFail) {
    try {
      if (fs.statSync(file)) {
        return properties.parse(grunt.file.read(file));
      }
    } catch (e) {
      grunt.log.errorlns('Could not load properties file from ' + file);
      grunt.verbose.errorlns(e);
      if (returnNullOnFail) {
        return null;
      }
    }
    return {};
  }

  function loadEnvProperties() {
    return _.defaults({}, process.env);
  }

  function loadBuildProperties() {
    if (grunt.option('propertyfile')) {
      grunt.verbose.writelns('Loading custom property file from: ' + grunt.option('propertyfile'));
      return loadProperties(grunt.option('propertyfile'), true);
    } else if (fs.statSync(path.join(basedir, 'build.properties'))) {
      return loadProperties(path.join(basedir, 'build.properties'), true);
    } else {
      return {};
    }
  }

  var buildProperties = {};
  if (grunt.option('simple')) {
    buildProperties['grunt.vloc.simpleMode'] = !!grunt.option('simple');
  }
  _.defaults(buildProperties, loadEnvProperties());

  if (!buildProperties['sf.username']) {
    var props = loadBuildProperties();
    if (!props) {
      grunt.log.errorlns('No propertyfile selected. Please create a \"build.properties\" file following the template provided in template.build.properties. Or specify a -propertyfile.');
      return;
    } else {
      _.defaults(buildProperties, props);
    }
  }

  return buildProperties;
};