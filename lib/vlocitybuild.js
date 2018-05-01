#!/usr/bin/env node

var vlocity = require('./vlocitycli.js');

function oncomplete(result) {
    VlocityUtils.log(result);
}

function onerror(result) {
    VlocityUtils.log(result);
    process.exitCode = 1;
}

new vlocity().runCLI(null, oncomplete, onerror);