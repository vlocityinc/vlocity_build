var stringify = require('json-stable-stringify');

VlocityUtils = {
    showLoggingStatements: true,
    fullLog: '',
    namespace: '',
    verboseLogging: false,
    performance: false,
    startTime: Date.now(),
    silence: false,
    quiet: false
};

VlocityUtils.log = function() {
    VlocityUtils.output(console.log, '\x1b[0m', arguments);
}

VlocityUtils.report = function() {
    VlocityUtils.output(console.log, '\x1b[36m', arguments);
}

VlocityUtils.success = function() {
    VlocityUtils.output(console.log, '\x1b[32m', arguments);
}

VlocityUtils.warn = function() {
    VlocityUtils.output(console.log, '\x1b[33m', arguments);
}

VlocityUtils.error = function() {
    VlocityUtils.output(console.error, '\x1b[31m', arguments);
}

VlocityUtils.fatal = function() {
    VlocityUtils.output(console.error, '\x1b[31m', arguments);

    throw arguments;
}

VlocityUtils.verbose = function() {
    if (VlocityUtils.verboseLogging) {
        VlocityUtils.output(console.log, '\x1b[0m', arguments);
    }
}

VlocityUtils.getTime = function() {
    var elapsedTime = (Date.now() - VlocityUtils.startTime) / 1000;

    return Math.floor((elapsedTime / 60)) + 'm ' + Math.floor((elapsedTime % 60)) + 's';
}

VlocityUtils.output = function(loggingMethod, color, messageArray) {
    if (VlocityUtils.quiet || (VlocityUtils.silence && !VlocityUtils.verboseLogging)) return;

    if (!messageArray) {
        return;
    }

    var newMessage = color + ' ' + (messageArray ? messageArray[0] : '');

    for (var i = 1; i < messageArray.length; i++) {
        if (i == 1) {
            newMessage += ' >>\x1b[0m ';
        }
        if (typeof messageArray[i] == 'object') {
            newMessage += stringify(messageArray[i], { space: 4});
        } else {
            newMessage += messageArray[i];
        }

        if ((i - 1) != messageArray.length) {
            newMessage += ' ';
        }
    }
    
    if (VlocityUtils.namespace == '') {
        newMessage = newMessage.replace(/%vlocity_namespace%__/g, '').replace(/%vlocity_namespace%/g, '');
    } else {
        newMessage = newMessage.replace(/%vlocity_namespace%/g, VlocityUtils.namespace);
    }
    
    if (VlocityUtils.showLoggingStatements) {
        loggingMethod((VlocityUtils.performance ? VlocityUtils.getTime() + ':' : ''), newMessage, '\x1b[0m');
    }

    VlocityUtils.fullLog += newMessage + '\n';
}