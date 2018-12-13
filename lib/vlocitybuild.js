#!/usr/bin/env node
var vlocitycli = require('./vlocitycli.js');

(async function () {
  try {
    await vlocitycli.runCLI()
  } catch (e) {

  }
})()
