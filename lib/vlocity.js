const jsforce = require('jsforce')
const fs = require('fs-extra')
const path = require('path')
const stringify = require('json-stable-stringify')

const VlocityUtils = require('./vlocityutils')

const Datapacks = require('./datapacks')
const DatapacksJob = require('./datapacksjob')
const DatapacksExpand = require('./datapacksexpand')
const DatapacksBuilder = require('./datapacksbuilder')
const DatapacksUtils = require('./datapacksutils')
const DatapacksExportBuildFile = require('./datapacksexportbuildfile')
const DatapacksErrorHandling = require('./datapackserrorhandling.js')
const QueryService = require('./queryservice.js')
const ValidationTest = require('./validationtest')
const DeltaCheck = require('./deltacheck')
const UtilityService = require('./utilityservice.js')

const SOURCE_FILE_CURRENT = 'sourceFileCurrent.json'
const TARGET_FILE_CURRENT = 'targetFileCurrent.json'
const DIFFS_FILE_CURRENT = 'diffsFileCurrent.json'

const Vlocity = module.exports = function (options) {
  options = options || {}

  this.passedInNamespace = options.vlocityNamespace

  this.passedInOptionsOverride = options.commandLineOptionsOverride

  this.tempFolder = options.tempFolder || './vlocity-temp/'

  this.verbose = !!options.verbose

  VlocityUtils.verboseLogging = !!options.verbose
  VlocityUtils.performance = !!options.performance

  VlocityUtils.verbose('Verbose mode enabled')

  this.sfdxUsername = options.sfdxUsername
  this.username = options.username || options.sfdxUsername
  this.password = options.password
  this.sessionId = options.sessionId
  this.instanceUrl = options.instanceUrl
  this.accessToken = options.accessToken

  if (this.username) {
    VlocityUtils.report('Org', this.username)
  }

  this.jsForceConnection = new jsforce.Connection({
    loginUrl: options.loginUrl ? options.loginUrl : 'https://login.salesforce.com',
    httpProxy: options.httpProxy ? options.httpProxy : null,
    sessionId: this.sessionId,
    instanceUrl: this.instanceUrl,
    accessToken: this.accessToken
  })

  this.datapacksutils = new DatapacksUtils(this)
  this.datapacks = new Datapacks(this)
  this.datapacksjob = new DatapacksJob(this)
  this.datapacksexpand = new DatapacksExpand(this)
  this.datapacksbuilder = new DatapacksBuilder(this)
  this.datapacksexportbuildfile = new DatapacksExportBuildFile(this)
  this.datapackserrorhandling = new DatapacksErrorHandling(this)
  this.queryservice = new QueryService(this)
  this.validationtest = new ValidationTest(this)
  this.utilityservice = new UtilityService(this)
  this.deltacheck = new DeltaCheck(this)
}

Vlocity.runDataPacksCommand = async function (action, options) {
  var passedInOptions = JSON.parse(JSON.stringify(options))

  switch (action) {
    case 'Compare':
      return Vlocity.compare(options)
    case 'Migrate':
      return Vlocity.migrate(options)
    case 'RevertChange':
      return Vlocity.revertChange(options)
    case 'DeltaMigrate':
      return Vlocity.deltaMigrate(options)
    case 'GetAvailable':
      return Vlocity.getAvailable(options)
  }

  var vlocityRun = new Vlocity(passedInOptions)
  delete passedInOptions.password
  delete passedInOptions.accessToken

  await vlocityRun.checkLogin()

  return vlocityRun.datapacksjob.runJob(action, passedInOptions)
}

Vlocity.getEnvironmentInfo = function (environment, options) {
  var passedInOptions = JSON.parse(JSON.stringify(options))

  if (environment === 'local') {

  } else {
    passedInOptions.sfdxUsername = environment
    passedInOptions.tempFolder = path.join(passedInOptions.tempFolder, environment.replace('.', '_').replace('@', '_'))
    passedInOptions.projectPath = path.join(passedInOptions.tempFolder, 'project')
    passedInOptions.buildFile = path.join(passedInOptions.tempFolder, 'AllDataPacks.json')
    passedInOptions.expansionPath = 'datapacks'
  }

  return passedInOptions
}

Vlocity.getComparisonInfo = function (options) {
  var passedInOptions = JSON.parse(JSON.stringify(options))
  passedInOptions.comparisonFolder = path.join(options.tempFolder, 'comparison', options.source.replace('.', '_').replace('@', '_'), options.target.replace('.', '_').replace('@', '_'))
  passedInOptions.sourceFileCurrent = path.join(passedInOptions.comparisonFolder, SOURCE_FILE_CURRENT)

  passedInOptions.diffsFileCurrent = path.join(passedInOptions.comparisonFolder, DIFFS_FILE_CURRENT)
  passedInOptions.targetFileCurrent = path.join(passedInOptions.comparisonFolder, TARGET_FILE_CURRENT)

  passedInOptions.hasComparison = fs.existsSync(passedInOptions.sourceFileCurrent)
  return passedInOptions
}

Vlocity.migrate = async function (options) {
  var comparisonInfo = Vlocity.getComparisonInfo(options)

  if (comparisonInfo.hasComparison) {
    if (options.target === 'local') {
      options.buildFile = comparisonInfo.sourceFileCurrent
      return Vlocity.runDataPacksCommand('ExpandFile', options)
    } else {
      options.sfdxUsername = options.target
      options.buildFile = comparisonInfo.sourceFileCurrent
      options.projectPath = comparisonInfo.comparisonFolder
      options.expansionPath = 'datapacks'
      fs.removeSync(path.join(comparisonInfo.comparisonFolder, migrateOptions.expansionPath))

      await Vlocity.runDataPacksCommand('ExpandFile', options)
      return Vlocity.runDataPacksCommand('Deploy', options)
    }
  } else if (options.source === 'local') {
    if (options.target === 'local') {

    } else {
      options.sfdxUsername = options.target
      return Vlocity.runDataPacksCommand('Deploy', options)
    }
  } else {
    if (options.target === 'local') {
      options.sfdxUsername = options.source
      return Vlocity.runDataPacksCommand('Export', options)
    } else if (options.target) {
      var sourceOptions = Vlocity.getEnvironmentInfo(options.source, options)
      sourceOptions.sfdxUsername = options.target
      return Vlocity.runDataPacksCommand('Deploy', sourceOptions)
    }
  }
}

Vlocity.refresh = async function (options) {
  if (options.sfdxUsername) {
    await Vlocity.runDataPacksCommand('Export', options)
  }
}

Vlocity.getDataPacks = async function (options) {
  var passedInOptions = JSON.parse(JSON.stringify(options))

  passedInOptions.workingSet = null

  let buildResult = await Vlocity.runDataPacksCommand('BuildFile', passedInOptions)

  return buildResult.records[0]
}

Vlocity.getAllDataByRecordSourceKey = function (dataPackData, dataPackBySourceKey) {
  if (dataPackData.VlocityDataPackData) {
    Vlocity.getAllDataByRecordSourceKey(dataPackData.VlocityDataPackData, dataPackBySourceKey)
  } else {
    if (dataPackData.VlocityRecordSourceKey) {
      dataPackBySourceKey[dataPackData.VlocityRecordSourceKey] = dataPackData
    }

    Object.keys(dataPackData).forEach(function (childDataKey) {
      var childData = dataPackData[childDataKey]

      if (Array.isArray(childData)) {
        childData.forEach(function (child) {
          Vlocity.getAllDataByRecordSourceKey(child, dataPackBySourceKey)
        })
      }
    })
  }
}

Vlocity.revertChange = async function (options) {
  var comparisonInfo = Vlocity.getComparisonInfo(options)

  var comparisonFile = JSON.parse(fs.readFileSync(comparisonInfo.sourceFileCurrent, 'utf8'))
  var diffsFile = JSON.parse(fs.readFileSync(comparisonInfo.diffsFileCurrent, 'utf8'))

  var allDataPacksBySourceKey = {}
  for (var dataPack of comparisonFile.dataPacks) {
    Vlocity.getAllDataByRecordSourceKey(dataPack, allDataPacksBySourceKey)
  }

  var allDiffsBySourceKey = {}

  for (var data of diffsFile.records) {
    for (var record of (data.SObjects || [])) {
      for (var diff of (record.fieldDiffs || [])) {
        allDiffsBySourceKey[diff.VlocityRecordSourceKey] = diff
      }
    }
  }

  if (typeof options.revertByKey === 'string') {
    options.revertByKey = JSON.parse(options.revertByKey)
  }

  for (var revertRecord of (options.revertByKey || [])) {
    var revertSObject = allDataPacksBySourceKey[revertRecord.VlocityRecordSourceKey]

    revertSObject[revertRecord.field] = revertRecord.old
  }

  if (typeof options.editByKey === 'string') {
    options.editByKey = JSON.parse(options.editByKey)
  }

  for (var editRecord of (options.editByKey || [])) {
    var editSObject = allDataPacksBySourceKey[revertRecord.VlocityRecordSourceKey]
    editSObject.clear()

    Object.merge(editSObject, editRecord)
  }

  fs.outputFileSync(comparisonInfo.sourceFileCurrent, JSON.stringify(comparisonFile), 'utf8')

  return Vlocity.compare(options)
}

Vlocity.compare = async function (options) {
  // username
  // projectfile
  var comparisonInfo = Vlocity.getComparisonInfo(options)
  if (options.refresh && options.source !== 'local') {
    fs.removeSync(comparisonInfo.comparisonFolder)
    await Vlocity.refresh(Vlocity.getEnvironmentInfo(options.source, options))
  }

  if (!fs.existsSync(comparisonInfo.sourceFileCurrent)) {
    options.sourceData = await Vlocity.getDataPacks(Vlocity.getEnvironmentInfo(options.source, options))

    fs.outputFileSync(comparisonInfo.sourceFileCurrent, stringify(options.sourceData), 'utf8')
  } else {
    options.sourceData = JSON.parse(fs.readFileSync(comparisonInfo.sourceFileCurrent, 'utf8'))
  }

  options.manifest = []

  for (var dataPack of options.sourceData.dataPacks) {
    options.manifest.push(dataPack.VlocityDataPackKey)
  }

  if (options.refresh && options.target !== 'local') {
    await Vlocity.refresh(Vlocity.getEnvironmentInfo(options.target, options))
  }

  if (!fs.existsSync(comparisonInfo.targetFileCurrent)) {
    options.targetData = await Vlocity.getDataPacks(Vlocity.getEnvironmentInfo(options.target, options))

    fs.outputFileSync(comparisonInfo.targetFileCurrent, stringify(options.targetData), 'utf8')
  } else {
    options.targetData = JSON.parse(fs.readFileSync(comparisonInfo.targetFileCurrent, 'utf8'))
  }

  options.sfdxUsername = options.source !== 'local' ? options.source : options.target

  let differences = await Vlocity.runDataPacksCommand('DiffPacks', options)

  fs.outputFileSync(comparisonInfo.diffsFileCurrent, stringify(differences, { space: 4 }), 'utf8')

  return differences
}

Vlocity.getAvailable = async function (options) {
  if (options.source === 'local') {
    return Vlocity.runDataPacksCommand('BuildManifest', options)
  } else {
    options.sfdxUsername = options.source

    return Vlocity.runDataPacksCommand('GetAllAvailableExports', options)
  }
}

Vlocity.prototype.checkLogin = async function (options) {
  return this.utilityservice.checkLogin()
}
