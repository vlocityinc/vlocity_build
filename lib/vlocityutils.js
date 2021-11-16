const PluginManager = require('runtime-plugin-manager-clone').PluginManager;
const path = require('path');

VlocityUtils = {
    showLoggingStatements: true,
    fullLog: [],
    namespace: '',
    verboseLogging: false,
    performance: false,
    startTime: Date.now(),
    silence: false,
    quiet: false,
    simpleLogging: false,
    noErrorLogging: false
};

VlocityUtils.log = function() {
    VlocityUtils.ipcsubtext(arguments);
    VlocityUtils.output(console.log, '\x1b[0m', arguments);
}

VlocityUtils.report = function() {
    VlocityUtils.ipcsubtext(arguments);
    VlocityUtils.output(console.log, '\x1b[36m', arguments);
}

VlocityUtils.success = function() {
    VlocityUtils.ipcsubtext(arguments);
    VlocityUtils.output(console.log, '\x1b[32m', arguments);
}

VlocityUtils.warn = function() {
    VlocityUtils.ipcsubtext(arguments);
    VlocityUtils.output(console.log, '\x1b[33m', arguments);
}

VlocityUtils.error = function() {
    VlocityUtils.ipcsubtext(arguments);
    VlocityUtils.output(console.warn, '\x1b[31m', arguments);
}

VlocityUtils.fatal = function() {
    VlocityUtils.output(console.warn, '\x1b[31m', arguments);

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

let ipcRendererSingleton;

VlocityUtils.getIPCRenderer = function() {

    if (ipcRendererSingleton === undefined) {
        if ('electron' in process.versions) {
            ipcRendererSingleton = require('electron').ipcRenderer;
        } else {
            ipcRendererSingleton = false;
        }
    }

    return ipcRendererSingleton;
}

VlocityUtils.milestone = function(message, subtext) {
    var ipcRenderer = VlocityUtils.getIPCRenderer();
    if (ipcRenderer) {
        ipcRenderer.send("ipc-log-message", { message: message });

        if (subtext) {
            ipcRenderer.send("ipc-log-subtext", { message: subtext });
        }
    } else {
        VlocityUtils.output(console.log, '\x1b[0m', arguments);
    }
}

VlocityUtils.ipcsubtext = function(messageArray) {

    var ipcRenderer = VlocityUtils.getIPCRenderer();
    if (ipcRenderer && !VlocityUtils.quiet) {
        
        var message = '';

        for (var i = 0; i < messageArray.length; i++) {
            message += messageArray[i] + ' ';
        }

        ipcRenderer.send("ipc-log-subtext", { message: message });
    }
}

VlocityUtils.output = function(loggingMethod, color, messageArray) {
    if (VlocityUtils.quiet || (VlocityUtils.silence && !VlocityUtils.verboseLogging)) return;

    if (!messageArray) {
        return;
    }

    if (VlocityUtils.noErrorLogging) {
        loggingMethod = console.log;
    }

    var neutralColor = '\x1b[0m';

    if (VlocityUtils.simpleLogging) {
        color = '';
        neutralColor = '';
    }

    var logSeperator = '>> ' + neutralColor;

    var newMessage;

    for (var i = 0; i < messageArray.length; i++) {

        if (i == 0) {
            newMessage = color + ' ';
        }

        if (i == 1) {
            newMessage += logSeperator;
        }

        if (messageArray[i] instanceof Error) {
            newMessage += messageArray[i].stack;
        } else if (typeof messageArray[i] == 'object') {
            newMessage += JSON.stringify(messageArray[i], null, 4);
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
        loggingMethod((VlocityUtils.performance ? VlocityUtils.getTime() + ':' : ''), newMessage, neutralColor);
    }

    if (VlocityUtils.verboseLogging) {
        VlocityUtils.fullLog.push(newMessage.replace(color, '').replace(/\x1b\[0m/g, ''));
    }
}

VlocityUtils.requirePlugin = async function (jobInfo, packageName, packageVersion) {

    // Configure the plugin manager
    const cwd = process.cwd();
    let pluginTempPath = path.join(cwd, jobInfo.tempFolder, 'plugins');
    const manager = new PluginManager({
        pluginsPath: pluginTempPath
    });

    const repoUrl = jobInfo.npmRepository;
    const authKey = jobInfo.npmAuthKey || '';

    await manager.installFromNpm(packageName, packageVersion, {
        url: repoUrl,
        config: {
            auth: {
                username: authKey
            }
        }
    });

    return manager.require(packageName);
}

VlocityUtils.loadCompiler = async function (nameOfCompiler, jobInfo, packageVersion, namespace) {

    let lwcCompilerNamespace = jobInfo.lwcCompilerNamespace,
        lwcCompilerVersion = jobInfo.lwcCompilerVersion || '',
        lwcCompiler;

    // Load the installed compiler. Can be passed by the config or calculated by the namespace.
    if (!lwcCompilerNamespace) {
        switch (namespace) {
            case 'vlocity_ins': lwcCompiler = '@vlocity-ins/' + nameOfCompiler; break;
            case 'vlocity_cme': lwcCompiler = '@vlocity-cme/' + nameOfCompiler; break;
            case 'vlocity_ps': lwcCompiler = '@vlocity-ps/' + nameOfCompiler; break;
            case 'omnistudio': lwcCompiler = '@omnistudio/' + nameOfCompiler; break;
            default:
                VlocityUtils.warn('Using default @omnistudio/' + nameOfCompiler);
                lwcCompiler = '@omnistudio/' + nameOfCompiler;
                break;
        }
    } else {
        lwcCompiler = `@${lwcCompilerNamespace}/${nameOfCompiler}`;
    }

    // If the compiler version was not provided, use the package version
    if (!lwcCompilerVersion) {
        if (packageVersion === 'DeveloperOrg') {
            VlocityUtils.warn('No compiler version found for DeveloperOrg');
            return null;
        } else {
            lwcCompilerVersion = packageVersion;
        }
    } else if (lwcCompilerVersion != packageVersion && packageVersion !== 'DeveloperOrg') {
        VlocityUtils.warn('Provided compiler version does match package version.');
    }

    // Make sure we have a compiler
    if(!lwcCompilerVersion) {
        return null;
    }

    VlocityUtils.report(`Loading ${lwcCompiler}@${lwcCompilerVersion}`);

    try {
        return await VlocityUtils.requirePlugin(jobInfo, lwcCompiler, lwcCompilerVersion);
    } catch (err) {
        VlocityUtils.error('An error occurred while loading OmniScript compiler.', err);
        return null;
    }
}