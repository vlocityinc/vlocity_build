VlocityUtils = {
    showLoggingStatements: true,
    fullLog: '',
    namespace: ''
};

VlocityUtils.log = function() {
    VlocityUtils.output(console.log, arguments);
}

VlocityUtils.error = function() {
    VlocityUtils.output(console.error, arguments);
}

VlocityUtils.fatal = function() {
    VlocityUtils.output(console.error, arguments);

    throw arguments;
}

VlocityUtils.output = function(loggingMethod, message) {
    message = Object.values(message).join(' ') + '\x1b[0m';

    if (VlocityUtils.namespace == '') {
        message = message.replace(/%vlocity_namespace%__/g, '').replace(/%vlocity_namespace%/g, '');
    } else {
        message = message.replace(/%vlocity_namespace%/g, VlocityUtils.namespace);
    }
    
    if (VlocityUtils.showLoggingStatements) {
        loggingMethod(message);
    }

    VlocityUtils.fullLog += message + '\n';
}