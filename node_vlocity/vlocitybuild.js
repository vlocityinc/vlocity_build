#!/usr/bin/env node

var vlocity = require('./vlocitycli.js');

function oncomplete(result) {
    console.log(result);
};

new vlocity().runCLI(null, oncomplete, oncomplete);