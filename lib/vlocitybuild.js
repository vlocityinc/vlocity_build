#!/usr/bin/env node

var vlocity = require('./vlocitycli.js');

function oncomplete(result) {
    process.exitCode = 0;
    if (VlocityUtils.quiet) {
        return;
    }
    console.log(result);
}

function onerror(result) {
    if (VlocityUtils.quiet) {
        return;
    }
    console.log(result);
}

process.exitCode = 1;
new vlocity().runCLI(null, oncomplete, onerror);