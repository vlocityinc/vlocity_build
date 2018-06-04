#!/usr/bin/env node

var vlocity = require('./vlocitycli.js');

function oncomplete(result) {
    if (VlocityUtils.quiet) {
        return;
    }
    console.log(result);
}

function onerror(result) {
    process.exitCode = 1;
    if (VlocityUtils.quiet) {
        return;
    }
    console.log(result);
}

new vlocity().runCLI(null, oncomplete, onerror);