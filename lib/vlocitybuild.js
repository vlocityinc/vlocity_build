#!/usr/bin/env node

var vlocity = require('./vlocitycli.js');

function oncomplete(result) {
    console.log(result);
};

function onerror(result) {
    console.log(result);
    process.exit(1);
};

new vlocity().runCLI(null, oncomplete, onerror);