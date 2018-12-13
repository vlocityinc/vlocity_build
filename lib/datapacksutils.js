const fs = require('fs-extra')
const path = require('path')
const stringify = require('json-stable-stringify')
const yaml = require('js-yaml')
const VLOCITY_BUILD_VERSION = require('../package.json').version
const VlocityUtils = require('./vlocityutils')

// use consts for setting the namespace prefix so that we easily can reference it later on in this file
const namespacePrefix = 'vlocity_namespace'
const namespaceFieldPrefix = '%' + namespacePrefix + '%__'

let CURRENT_INFO_FILE

const DataPacksUtils = module.exports = function (vlocity) {
  this.vlocity = vlocity || {}

  CURRENT_INFO_FILE = path.join(vlocity.tempFolder, 'currentJobInfo.json')

  this.dataPacksExpandedDefinition = yaml.safeLoad(fs.readFileSync(path.join(__dirname, 'datapacksexpanddefinition.yaml'), 'utf8'))

  this.runJavaScriptModules = {}

  this.startTime = new Date().toISOString()
  this.alreadyWrittenLogs = []
  this.perfTimers = {}
  this.loadedFiles = {}
  this.fieldLabels = {}
  this.objectLabels = {}
}

DataPacksUtils.prototype.perfTimer = function (key) {
  if (this.perfTimers[key]) {
    VlocityUtils.log('Elapsed: ' + key, Date.now() - this.perfTimers[key])

    delete this.perfTimers[key]
  } else {
    this.perfTimers[key] = Date.now()
  }
}

DataPacksUtils.prototype.updateExpandedDefinitionNamespace = function (currentData) {
  var self = this

  if (Array.isArray(currentData)) {
    var replacedArray = []

    currentData.forEach(function (val) {
      replacedArray.push(self.updateExpandedDefinitionNamespace(val))
    })

    return replacedArray
  } else if (typeof currentData === 'object') {
    var replacedObject = {}

    Object.keys(currentData).forEach(function (key) {
      if (key.indexOf(namespaceFieldPrefix) === -1 && key.indexOf('__c')) {
        replacedObject[self.updateExpandedDefinitionNamespace(key)] = self.updateExpandedDefinitionNamespace(currentData[key])
      }
    })

    return replacedObject
  } else {
    if (typeof currentData === 'string') {
      if (currentData.indexOf(namespaceFieldPrefix) === -1 && currentData.indexOf('.') > 0) {
        var finalString = ''

        currentData.split('.').forEach(function (field) {
          if (finalString !== '') {
            finalString += '.'
          }

          if (field.indexOf('__c') > 0 || field.indexOf('__r') > 0) {
            finalString += namespaceFieldPrefix + field
          } else {
            finalString += field
          }
        })
        return finalString
      } else if (currentData.indexOf(namespaceFieldPrefix) === -1 && currentData.indexOf('__c') > 0) {
        return namespaceFieldPrefix + currentData
      }
    }

    return currentData
  }
}

DataPacksUtils.prototype.overrideExpandedDefinition = function (expandedDefinition) {
  this.overrideExpandedDefinitions = JSON.parse(JSON.stringify(expandedDefinition).replace(/vlocity_namespace/g, '%vlocity_namespace%'))
}

DataPacksUtils.prototype.getDataField = function (dataPackData) {
  var dataKey

  if (dataPackData.VlocityDataPackData) {
    Object.keys(dataPackData.VlocityDataPackData).forEach(function (key) {
      if (Array.isArray(dataPackData.VlocityDataPackData[key]) && dataPackData.VlocityDataPackData[key].length > 0 && dataPackData.VlocityDataPackData[key][0].VlocityRecordSObjectType) {
        dataKey = dataPackData.VlocityDataPackData[key][0].VlocityRecordSObjectType
      }
    })
  }
  return dataKey
}

DataPacksUtils.prototype.getAllConfigurations = async function () {
  if (!this.allConfigurations) {
    this.allConfigurations = {}

    var queryResult = await this.vlocity.queryservice.query('SELECT Id, NamespacePrefix, DeveloperName,%vlocity_namespace%__DefaultImportLimit__c,%vlocity_namespace%__DefaultExportLimit__c FROM %vlocity_namespace%__VlocityDataPackConfiguration__mdt')

    if (queryResult && queryResult.records) {
      for (var i = 0; i < queryResult.records.length; i++) {
        var developerName = queryResult.records[i].DeveloperName
        if (this.allConfigurations[queryResult.records[i][developerName]]) {
          if (queryResult.records[i]['NamespacePrefix'] !== null) {
            continue
          }
        }

        this.allConfigurations[developerName] = queryResult.records[i]
      }
    }
  }
}

DataPacksUtils.prototype.getListFileName = function (dataPackType, SObjectType) {
  var listFileNameKeys = this.getExpandedDefinition(dataPackType, SObjectType, 'ListFileName')

  if (!listFileNameKeys) {
    var defaultListFileName = SObjectType.replace(/%vlocity_namespace%__|__c/g, '')

    if (defaultListFileName.substr(defaultListFileName.length - 1, 1) === 'y') {
      defaultListFileName = '_' + defaultListFileName.substr(0, defaultListFileName.length - 1) + 'ies'
    } else if (defaultListFileName.substr(defaultListFileName.length - 1, 1) !== 's') {
      defaultListFileName = '_' + defaultListFileName + 's'
    }

    listFileNameKeys = [ defaultListFileName ]
  }

  return listFileNameKeys
}

DataPacksUtils.prototype.getBuildOnlyFields = function (dataPackType, SObjectType) {
  return this.getExpandedDefinition(dataPackType, SObjectType, 'BuildOnlyFields') || {}
}

DataPacksUtils.prototype.isBuildOnlyField = function (dataPackType, SObjectType, field) {
  var buildOnlyFields = this.getExpandedDefinition(dataPackType, SObjectType, 'BuildOnlyFields')
  return buildOnlyFields && buildOnlyFields.hasOwnProperty(field)
}

DataPacksUtils.prototype.getPaginationActions = function (dataPackType) {
  return this.getExpandedDefinition(dataPackType, null, 'PaginationActions')
}

DataPacksUtils.prototype.getSortFields = function (dataPackType, SObjectType) {
  return this.getExpandedDefinition(dataPackType, SObjectType, 'SortFields')
}

DataPacksUtils.prototype.isIgnoreExpand = function (dataPackType, SObjectField) {
  var ignoreFields = this.getExpandedDefinition(dataPackType, null, 'IgnoreExpand')

  return ignoreFields && ignoreFields.indexOf(SObjectField) !== -1
}

DataPacksUtils.prototype.isDoNotExpand = function (dataPackType, SObjectType) {
  return this.getExpandedDefinition(dataPackType, SObjectType, 'DoNotExpand')
}

DataPacksUtils.prototype.getFilterFields = function (dataPackType, SObjectType) {
  return this.getExpandedDefinition(dataPackType, SObjectType, 'FilterFields')
}

DataPacksUtils.prototype.getSummaryFields = function (dataPackType, SObjectType) {
  return this.getExpandedDefinition(dataPackType, SObjectType, 'SummaryFields')
}

DataPacksUtils.prototype.getRecordLabel = function (dataPackType, SObjectType) {
  return this.getExpandedDefinition(dataPackType, SObjectType, 'RecordLabel')
}

DataPacksUtils.prototype.getFileName = function (dataPackType, SObjectType) {
  return this.getExpandedDefinition(dataPackType, SObjectType, 'FileName')
}

DataPacksUtils.prototype.getSourceKeyGenerationFields = function (SObjectType) {
  return this.getExpandedDefinition(null, SObjectType, 'SourceKeyGenerationFields')
}

DataPacksUtils.prototype.getSourceKeyDefinitionFields = function (SObjectType) {
  return this.getExpandedDefinition(null, SObjectType, 'SourceKeyDefinition')
}

DataPacksUtils.prototype.getMatchingSourceKeyDefinitionFields = function (SObjectType) {
  return this.getExpandedDefinition(null, SObjectType, 'MatchingSourceKeyDefinition')
}

DataPacksUtils.prototype.getDiffKeys = function (dataPackType, SObjectType) {
  return this.getExpandedDefinition(dataPackType, SObjectType, 'DiffKeys')
}

DataPacksUtils.prototype.getFolderName = function (dataPackType, SObjectType) {
  return this.getExpandedDefinition(dataPackType, SObjectType, 'FolderName')
}

DataPacksUtils.prototype.getFileType = function (dataPackType, SObjectType) {
  return this.getExpandedDefinition(dataPackType, SObjectType, 'FileType')
}

DataPacksUtils.prototype.getJsonFields = function (dataPackType, SObjectType) {
  return this.getExpandedDefinition(dataPackType, SObjectType, 'JsonFields')
}

DataPacksUtils.prototype.getHashFields = function (dataPackType, SObjectType) {
  return this.getExpandedDefinition(dataPackType, SObjectType, 'HashFields')
}

DataPacksUtils.prototype.getReplacementFields = function (dataPackType, SObjectType) {
  return this.getExpandedDefinition(dataPackType, SObjectType, 'ReplacementFields')
}

DataPacksUtils.prototype.isNonUnique = function (dataPackType, SObjectType) {
  return this.getExpandedDefinition(dataPackType, SObjectType, 'NonUnique')
}

DataPacksUtils.prototype.isUniqueByName = function (dataPackType) {
  return this.getExpandedDefinition(dataPackType, null, 'UniqueByName')
}

DataPacksUtils.prototype.getPaginationSize = function (dataPackType, SObjectType) {
  return this.getExpandedDefinition(dataPackType, null, 'PaginationSize')
}

DataPacksUtils.prototype.isRemoveNullValues = function (dataPackType, SObjectType) {
  return this.getExpandedDefinition(dataPackType, SObjectType, 'RemoveNullValues')
}

DataPacksUtils.prototype.getUnhashableFields = function (dataPackType, SObjectType) {
  return this.getExpandedDefinition(dataPackType, SObjectType, 'UnhashableFields')
}

DataPacksUtils.prototype.getIsDiffable = function (dataPackType, SObjectType) {
  return this.getExpandedDefinition(dataPackType, null, 'IsDiffable')
}

DataPacksUtils.prototype.isDeletedDuringDeploy = function (dataPackType, SObjectType) {
  return this.getExpandedDefinition(dataPackType, SObjectType, 'DeletedDuringDeploy')
}

DataPacksUtils.prototype.isAllowParallel = function (dataPackType, dataPackDataMetadata) {
  var parallel = this.getExpandedDefinition(dataPackType, null, 'SupportParallel')

  if (typeof parallel === 'object') {
    var parallelKeys = Object.keys(parallel)

    for (var i = 0; i < parallelKeys.length; i++) {
      var parallelKey = parallelKeys[i]
      var parallelValue = parallel[parallelKey]

      if (dataPackDataMetadata[parallelKey] !== parallelValue) {
        return false
      }
    }

    return true
  }

  return this.getExpandedDefinition(dataPackType, null, 'SupportParallel')
}

DataPacksUtils.prototype.getMaxDeploy = function (dataPackType) {
  return this.getExpandedDefinition(dataPackType, null, 'MaxDeploy')
}

DataPacksUtils.prototype.getHeadersOnly = function (dataPackType) {
  return this.getExpandedDefinition(dataPackType, null, 'HeadersOnly')
}

DataPacksUtils.prototype.getExportGroupSizeForType = function (dataPackType) {
  var override = this.getExpandedDefinition(dataPackType, null, 'ExportGroupSize')

  var setting = 0

  if (this.allConfigurations[dataPackType]) {
    setting = this.allConfigurations[dataPackType][`${this.vlocity.namespace}__DefaultExportLimit__c`]
  }

  return override || Math.max(setting, 10)
}

DataPacksUtils.prototype.getChildrenLimitForType = function (dataPackType, SObjectType, field) {
  return this.getExpandedDefinition(dataPackType, null, 'ChildrenLimit')
}

DataPacksUtils.prototype.isGuaranteedParentKey = function (parentKey) {
  return (this.overrideExpandedDefinitions &&
        this.overrideExpandedDefinitions.GuaranteedParentKeys &&
        this.overrideExpandedDefinitions.GuaranteedParentKeys.indexOf(parentKey) !== -1) ||
        this.dataPacksExpandedDefinition.GuaranteedParentKeys.indexOf(parentKey) !== -1
}

DataPacksUtils.prototype.getApexImportDataKeys = function (SObjectType) {
  var defaults = ['VlocityRecordSObjectType', 'Name']
  var apexImportDataKeys = this.getSourceKeyDefinitionFields(SObjectType)

  if (apexImportDataKeys) {
    return defaults.concat(apexImportDataKeys)
  }

  return defaults
}

DataPacksUtils.prototype.getApexSObjectTypeList = function (dataPackType, SObjectType) {
  return this.getExpandedDefinition(dataPackType, SObjectType, 'ApexSObjectTypeList')
}

DataPacksUtils.prototype.isCompiledField = function (dataPackType, SObjectType, field) {
  var compiledFields = this.getExpandedDefinition(dataPackType, SObjectType, 'CompiledFields')
  return compiledFields && compiledFields.indexOf(field) !== -1
}

DataPacksUtils.prototype.getDeltaQueryChildren = function (dataPackType, SObjectType, field) {
  return this.getExpandedDefinition(dataPackType, SObjectType, 'DeltaQueryChildren')
}

DataPacksUtils.prototype.hasExpandedDefinition = function (dataPackType, SObjectType) {
  return this.dataPacksExpandedDefinition[dataPackType] && this.dataPacksExpandedDefinition[dataPackType][SObjectType]
}

DataPacksUtils.prototype.getExpandedDefinition = function (dataPackType, SObjectType, dataKey) {
  var definitionValue

  if (this.overrideExpandedDefinitions) {
    if (dataPackType && this.overrideExpandedDefinitions.DataPacks && this.overrideExpandedDefinitions.DataPacks[dataPackType]) {
      if (SObjectType) {
        if (this.overrideExpandedDefinitions.DataPacks[dataPackType][SObjectType]) {
          definitionValue = this.overrideExpandedDefinitions.DataPacks[dataPackType][SObjectType][dataKey]
        }
      } else {
        definitionValue = this.overrideExpandedDefinitions.DataPacks[dataPackType][dataKey]
      }
    }

    if (definitionValue === undefined && SObjectType && this.overrideExpandedDefinitions.SObjects && this.overrideExpandedDefinitions.SObjects[SObjectType]) {
      definitionValue = this.overrideExpandedDefinitions.SObjects[SObjectType][dataKey]
    }
  }

  if (definitionValue === undefined) {
    if (dataPackType && this.dataPacksExpandedDefinition.DataPacks[dataPackType]) {
      if (SObjectType) {
        if (this.dataPacksExpandedDefinition.DataPacks[dataPackType][SObjectType]) {
          definitionValue = this.dataPacksExpandedDefinition.DataPacks[dataPackType][SObjectType][dataKey]
        }
      } else {
        definitionValue = this.dataPacksExpandedDefinition.DataPacks[dataPackType][dataKey]
      }
    }
  }

  if (definitionValue === undefined && SObjectType && this.dataPacksExpandedDefinition.SObjects[SObjectType]) {
    definitionValue = this.dataPacksExpandedDefinition.SObjects[SObjectType][dataKey]
  }

  if (definitionValue === undefined) {
    if (SObjectType) {
      definitionValue = this.dataPacksExpandedDefinition.SObjectsDefault[dataKey]
    } else {
      definitionValue = this.dataPacksExpandedDefinition.DataPacksDefault[dataKey]
    }
  }

  return definitionValue
}

// Traverse JSON and get all Ids
DataPacksUtils.prototype.getAllSObjectIds = function (currentData, currentIdsOnly, typePlusId) {
  var self = this

  if (currentData) {
    if (Array.isArray(currentData)) {
      currentData.forEach(function (childData) {
        self.getAllSObjectIds(childData, currentIdsOnly, typePlusId)
      })
    } else {
      if (currentData.VlocityDataPackType === 'SObject') {
        if (currentData.Id) {
          currentIdsOnly.push(currentData.Id)
          typePlusId.push({ SObjectType: currentData.VlocityRecordSObjectType, Id: currentData.Id })
        }
      }

      Object.keys(currentData).forEach(function (sobjectField) {
        if (typeof currentData[sobjectField] === 'object') {
          self.getAllSObjectIds(currentData[sobjectField], currentIdsOnly, typePlusId)
        }
      })
    }
  }
}

DataPacksUtils.prototype.getDirectories = function (srcpath, recusive, rootpath) {
  var dirs = []
  try {
    rootpath = path.normalize(rootpath || srcpath)
    fs.readdirSync(srcpath).forEach((file) => {
      var fullname = path.join(srcpath, file)
      var fstat = fs.statSync(fullname)
      if (fstat.isDirectory()) {
        var packName = fullname

        if (packName.indexOf(rootpath) === 0) {
          packName = packName.substr(rootpath.length)
        }

        if (packName.indexOf(path.sep) === 0) {
          packName = packName.substr(path.sep.length)
        }

        dirs.push(packName)

        if (recusive) {
          dirs = dirs.concat(this.getDirectories(packName, recusive, rootpath || srcpath))
        }
      }
    })
  } catch (e) {
  }
  return dirs
}

DataPacksUtils.prototype.getFiles = function (srcpath) {
  try {
    return fs.readdirSync(srcpath).filter(function (file) {
      return fs.statSync(path.join(srcpath, file)).isFile()
    })
  } catch (e) {
    return []
  }
}

DataPacksUtils.prototype.fileExists = function (srcpath) {
  try {
    fs.statSync(srcpath)
  } catch (e) {
    return false
  }

  return true
}

DataPacksUtils.prototype.getParents = function (jobInfo, currentData, dataPackKey) {
  var self = this

  if (currentData) {
    if (currentData.VlocityDataPackData) {
      var dataField = self.vlocity.datapacksutils.getDataField(currentData)

      if (dataField) {
        currentData.VlocityDataPackData[dataField].forEach(function (sobjectData) {
          if (jobInfo.allParents.indexOf(currentData.VlocityDataPackKey) === -1) {
            jobInfo.allParents.push(currentData.VlocityDataPackKey)
          }

          self.getParents(jobInfo, sobjectData, currentData.VlocityDataPackKey)
        })
      }
    } else {
      if (Array.isArray(currentData)) {
        currentData.forEach(function (childData) {
          self.getParents(jobInfo, childData, dataPackKey)
        })
      } else {
        if (currentData.VlocityDataPackType !== 'VlocityLookupMatchingKeyObject' && currentData.VlocityDataPackType !== 'VlocityMatchingKeyObject') {
          // Make as Array because can Export Multiple Keys due to the way dependencies are exported
          if (!jobInfo.sourceKeysByParent[currentData.VlocityRecordSourceKey]) {
            jobInfo.sourceKeysByParent[currentData.VlocityRecordSourceKey] = []
          }

          if (jobInfo.sourceKeysByParent[currentData.VlocityRecordSourceKey].indexOf(dataPackKey) === -1) {
            jobInfo.sourceKeysByParent[currentData.VlocityRecordSourceKey].push(dataPackKey)
          }

          Object.keys(currentData).forEach(function (key) {
            if (Array.isArray(currentData[key])) {
              self.getParents(jobInfo, currentData[key], dataPackKey)
            }
          })
        }
      }
    }
  }
}

DataPacksUtils.prototype.initializeFromProject = async function (jobInfo) {
  var self = this

  if (!self.fileExists(jobInfo.projectPath)) {
    return
  }

  var jobInfoTemp = JSON.parse(stringify(jobInfo))

  jobInfoTemp.singleFile = true
  VlocityUtils.silence = true
  jobInfoTemp.compileOnBuild = false
  jobInfoTemp.manifest = null
  let dataJson = await self.vlocity.datapacksbuilder.buildImport(jobInfo.projectPath, jobInfoTemp, {})

  VlocityUtils.silence = false

  if (dataJson && dataJson.dataPacks) {
    dataJson.dataPacks.forEach(function (dataPack) {
      self.getParents(jobInfo, dataPack)
    })
  }
}

DataPacksUtils.prototype.isInManifest = function (dataPackData, manifest) {
  if (manifest && manifest[dataPackData.VlocityDataPackType]) {
    for (var i = 0; i < manifest[dataPackData.VlocityDataPackType].length; i++) {
      var man = manifest[dataPackData.VlocityDataPackType][i]

      if (typeof man === 'object') {
        var isMatching = true

        Object.keys(man).forEach(function (key) {
          if (man[key] !== dataPackData[key]) {
            isMatching = false
          }
        })

        if (isMatching) {
          return isMatching
        }
      } else if (man === dataPackData.Id) {
        return true
      }
    }
  }

  return false
}

DataPacksUtils.prototype.loadApex = async function (projectPath, filePath) {
  var possiblePaths = [
    path.join(projectPath, filePath),
    path.join(__dirname, '..', 'apex', filePath),
    filePath
  ]

  var apexFilePath = possiblePaths.find(apexFilePath =>
    this.vlocity.datapacksutils.fileExists(apexFilePath))

  if (!apexFilePath) {
    return 'The specified file \'' + filePath + '\' does not exist.'
  }

  VlocityUtils.report('Loading Apex', apexFilePath)

  var apexFileData = fs.readFileSync(apexFilePath, 'utf8')
  var includes = apexFileData.match(/\/\/include(.*?);/gi)

  var includedClasses = []

  if (includes) {
    var srcdir = path.dirname(apexFilePath)

    for (var replacement of includes) {
      var className = replacement.match(/\/\/include(.*?);/i)[1].trim()
      let apexClassLoaded = await this.loadApex(srcdir, className)

      includedClasses.push({
        replacement: replacement,
        fileData: apexClassLoaded
      })
    }
  }

  for (var classInfo of includedClasses) {
    apexFileData = apexFileData.replace(classInfo.replacement, classInfo.fileData)
  }

  return apexFileData
}

DataPacksUtils.prototype.splitApex = function (apexFileData, currentContextData) {
  // This function splits APEX in multiple chuncks so that the can be executed as anon apex
  // 16,088 is the limit according to a topic on SO
  const MAX_ANON_APEX_SIZE = 10000

  var formatApex = (data, contextData) => data
    .replace(/CURRENT_DATA_PACKS_CONTEXT_DATA/g, JSON.stringify(contextData))
    .replace(/%vlocity_namespace%/g, this.vlocity.namespace)
    .replace(/vlocity_namespace/g, this.vlocity.namespace)

  var formattedApex = []
  var intContextData = []
  currentContextData = currentContextData || []

  for (var i = 0; i < currentContextData.length; i++) {
    var isLastItem = (i + 1) === currentContextData.length
    var apex = formatApex(apexFileData, intContextData.concat(currentContextData[i]))

    if (apex.length > MAX_ANON_APEX_SIZE) {
      if (intContextData.length === 0) {
        throw new Error('Your APEX is to big to be executed anonymously.')
      }
      formattedApex.push(formatApex(apexFileData, intContextData))
      intContextData = []
      i-- // try agin to fit this context in the next Anon apex chunck
    } else if (isLastItem) {
      formattedApex.push(apex)
    } else {
      intContextData.push(currentContextData[i])
    }
  }

  if (currentContextData.length === 0) {
    formattedApex.push(formatApex(apexFileData, currentContextData))
  }

  return formattedApex
}

DataPacksUtils.prototype.runApex = async function (projectPath, filePaths, currentContextData) {
  var self = this
  filePaths = Array.isArray(filePaths) ? filePaths : [ filePaths ]

  for (var filePath of filePaths) {
    let loadedApex = await self.loadApex(projectPath, filePath)

    let apexChunks = self.splitApex(loadedApex, currentContextData)

    for (var apexChunk of apexChunks) {
      try {
        let res = await self.vlocity.jsForceConnection.tooling.executeAnonymous(apexChunk)

        if (!res || res.success === true) {
          VlocityUtils.success('Apex Success', filePath)
          continue
        }

        if (res.exceptionStackTrace) {
          VlocityUtils.error('APEX Exception StackTrace', res.exceptionStackTrace)
        }

        if (res.compileProblem) {
          VlocityUtils.error('APEX Compilation Error', res.compileProblem)
        }

        if (res.exceptionMessage) {
          VlocityUtils.error('APEX Exception Message', res.exceptionMessage)
        }

        throw res
      } catch (err) {
        throw new Error(`Apex Error >> ${err} APEX code failed to execute but no exception message was provided`)
      }
    }
  }
}

DataPacksUtils.prototype.runJavaScript = async function (projectPath, filePath, currentContextData, jobInfo) {
  var self = this

  let promise = await new Promise((resolve) => {
    var pathToRun = path.join(projectPath, filePath)

    var defaultJSPath = path.resolve(path.join(__dirname, '..', 'javascript', filePath))

    if (!self.fileExists(pathToRun) && self.fileExists(defaultJSPath)) {
      pathToRun = defaultJSPath
    }

    pathToRun = path.resolve(pathToRun)
    if (!self.runJavaScriptModules[pathToRun]) {
      self.runJavaScriptModules[pathToRun] = require(pathToRun)
    }

    self.runJavaScriptModules[pathToRun](self.vlocity, currentContextData, jobInfo, resolve)
  })

  return promise
}

DataPacksUtils.prototype.getFieldLabel = async function (sObject, fieldApiName) {
  var self = this

  let promise = await new Promise((resolve, reject) => {
    if (!self.fieldLabels[sObject]) {
      self.fieldLabels[sObject] = self.getExpandedDefinition(null, sObject, 'FieldLabels') || {}

      self.vlocity.jsForceConnection.sobject(sObject.replace('%vlocity_namespace%', self.vlocity.namespace)).describe(function (err, meta) {
        if (err) {
          reject(err)
          return
        }

        self.objectLabels[sObject] = meta.label

        meta.fields.forEach(field => {
          self.fieldLabels[sObject][field.name.replace(self.vlocity.namespace, '%vlocity_namespace%')] = field.label
        })

        resolve(self.generateFieldLabel(sObject, fieldApiName))
      })
    } else {
      resolve(self.generateFieldLabel(sObject, fieldApiName))
    }
  })

  return promise
}

DataPacksUtils.prototype.generateFieldLabel = function (sObject, fieldApiName) {
  if (this.fieldLabels[sObject][fieldApiName]) {
    return this.fieldLabels[sObject][fieldApiName]
  }

  var finalFieldName = ''

  for (var fieldSplit of fieldApiName.split('.')) {
    if (this.fieldLabels[sObject][fieldSplit]) {
      fieldSplit = this.fieldLabels[sObject][fieldSplit]
    } else if (this.dataPacksExpandedDefinition.FieldLabels[sObject] && this.dataPacksExpandedDefinition.FieldLabels[sObject][fieldSplit]) {
      fieldSplit = this.dataPacksExpandedDefinition.FieldLabels[sObject][fieldSplit]
    } else if (this.dataPacksExpandedDefinition.FieldLabels.All[fieldSplit]) {
      fieldSplit = this.dataPacksExpandedDefinition.FieldLabels.All[fieldSplit]
    }

    if (!finalFieldName) {
      finalFieldName = fieldSplit
    } else {
      finalFieldName += ' - ' + fieldSplit
    }
  }

  return finalFieldName.replace('%vlocity_namespace%__', '')
}

DataPacksUtils.prototype.hashCode = function (toHash) {
  var hash = 0; var i; var chr

  if (toHash.length === 0) return hash

  for (i = 0; i < toHash.length; i++) {
    chr = toHash.charCodeAt(i)
    hash = ((hash << 5) - hash) + chr
    hash |= 0 // Convert to 32bit integer
  }

  return hash
}

DataPacksUtils.prototype.guid = function () {
  function s4 () {
    return Math.random().toString(16).substring(2, 5)
  }

  return s4() + s4() + '-' + s4() + s4() + '-' + s4() + s4() + '-' +
    s4() + s4() + '-' + s4() + s4() + s4()
}

DataPacksUtils.prototype.updateRecordReferences = function (record) {
  var self = this

  delete record.attributes

  try {
    Object.keys(record).forEach(function (field) {
      if (record[field] !== null && typeof record[field] === 'object' && !Array.isArray(record[field])) {
        delete record[field].attributes

        self.updateRecordReferences(record[field])

        var referenceField = self.endsWith(field, '__r') ? field.replace('__r', '__c') : field + 'Id'
        record[referenceField] = record[field]
      }
    })
  } catch (e) {
    VlocityUtils.error('Error', e)
  }
}

DataPacksUtils.prototype.removeUnhashableFields = function (dataPackType, dataPackData) {
  var self = this

  if (dataPackData && dataPackData.VlocityRecordSObjectType) {
    var unhashableFields = self.getUnhashableFields(dataPackType, dataPackData.VlocityRecordSObjectType)

    if (unhashableFields) {
      unhashableFields.forEach(function (field) {
        delete dataPackData[field]
      })
    }

    var filterFields = self.getFilterFields(dataPackType, dataPackData.VlocityRecordSObjectType)

    if (filterFields) {
      filterFields.forEach(function (field) {
        delete dataPackData[field]
      })
    }

    delete dataPackData.VlocityMatchingRecordSourceKey
    delete dataPackData.VlocityRecordSourceKey
    delete dataPackData.VlocityRecordSourceKeyOriginal
    delete dataPackData.VlocityLookupRecordSourceKey
    delete dataPackData.VlocityDataPackType
    delete dataPackData.Id

    Object.keys(dataPackData).forEach(function (childDataKey) {
      var childData = dataPackData[childDataKey]

      if (!childData || childDataKey.indexOf('.') !== -1) {
        delete dataPackData[childDataKey]
      } else if (Array.isArray(childData)) {
        childData.forEach(function (child) {
          self.removeUnhashableFields(dataPackType, child)
        })
      } else if (typeof childData === 'object') {
        self.removeUnhashableFields(dataPackType, childData)
      } else if (typeof childData === 'string') {
        try {
          // Remove extra line endings if there
          dataPackData[childDataKey] = stringify(JSON.parse(dataPackData[childDataKey]))
        } catch (e) {
          // Can ignore
        }
      }
    })
  }
}

DataPacksUtils.prototype.getDisplayName = function (dataPack) {
  var name = ''
  var self = this

  if (dataPack.VlocityDataPackRelationshipType === 'Children') {
    return 'Child Records For ' + dataPack.VlocityDataPackName
  }

  if (dataPack.VlocityDataPackData) {
    var dataField = self.vlocity.datapacksutils.getDataField(dataPack)

    dataPack = dataPack.VlocityDataPackData[dataField][0]
  }

  self.getExpandedDefinition(dataPack.VlocityDataPackType, null, 'DisplayName').forEach(function (field) {
    if (dataPack[field]) {
      if (name) {
        name += ' '
      }

      name += dataPack[field]
    }
  })

  if (!name && dataPack.Name) {
    name = dataPack.Name
  }

  if (dataPack.Id) {
    if (name) {
      name += ' (' + dataPack.Id + ')'
    } else {
      name = dataPack.Id
    }
  }

  return name
}

DataPacksUtils.prototype.getSingleSObjectHash = function (dataPackType, dataPack) {
  var self = this

  var dataPackData = JSON.parse(stringify(dataPack))

  var unhashableFields = self.getUnhashableFields(dataPackType, dataPackData.VlocityRecordSObjectType)

  if (unhashableFields) {
    unhashableFields.forEach(function (field) {
      delete dataPackData[field]
    })
  }

  var filterFields = self.getFilterFields(dataPackType, dataPackData.VlocityRecordSObjectType)

  if (filterFields) {
    filterFields.forEach(function (field) {
      delete dataPackData[field]
    })
  }

  delete dataPackData.VlocityMatchingRecordSourceKey
  delete dataPackData.VlocityRecordSourceKey
  delete dataPackData.VlocityRecordSourceKeyOriginal
  delete dataPackData.VlocityLookupRecordSourceKey
  delete dataPackData.VlocityDataPackType
  delete dataPackData.Id

  Object.keys(dataPackData).forEach(function (childDataKey) {
    var childData = dataPackData[childDataKey]

    if (Array.isArray(childData)) {
      delete dataPackData[childDataKey]
    }
  })

  return self.hashCode(stringify(dataPackData))
}

DataPacksUtils.prototype.getDataPackHashable = function (dataPack, jobInfo) {
  var self = this

  var clonedDataPackData = JSON.parse(stringify(dataPack))

  self.vlocity.datapacksexpand.preprocessDataPack(clonedDataPackData, jobInfo)

  // Remove these as they would not be real changes
  clonedDataPackData.VlocityDataPackParents = null
  clonedDataPackData.VlocityDataPackAllRelationships = null

  var dataField = self.getDataField(clonedDataPackData)

  clonedDataPackData.VlocityDataPackType, clonedDataPackData.VlocityDataPackData[dataField].forEach(function (sobjectData) {
    self.removeUnhashableFields(clonedDataPackData.VlocityDataPackType, sobjectData)
  })

  return clonedDataPackData
}

DataPacksUtils.prototype.getAllIndividualSObjectsInDataPack = function (dataPackData) {
  var self = this
  var allSObjects = []

  if (dataPackData && dataPackData.VlocityRecordSObjectType) {
    var individualSObject = JSON.parse(stringify(dataPackData))
    allSObjects.push(individualSObject)

    Object.keys(dataPackData).forEach(function (childDataKey) {
      var childData = dataPackData[childDataKey]

      if (Array.isArray(childData)) {
        delete individualSObject[childDataKey]
        childData.forEach(function (child) {
          allSObjects = allSObjects.concat(self.getAllIndividualSObjectsInDataPack(child))
        })
      }
    })
  }

  return allSObjects
}

DataPacksUtils.prototype.getFieldDiffs = async function (allSourceDataPacks, allTargetDataPacks, jobInfo) {
  let self = this

  let allKeys = Object.keys(allTargetDataPacks)

  for (let dataPackKey of allKeys) {
    let sourceDataPack = allSourceDataPacks[dataPackKey]
    let targetDataPack = allTargetDataPacks[dataPackKey]

    if (jobInfo.diffType[dataPackKey] && jobInfo.diffType[dataPackKey] !== 'Unchanged') {
      let allFieldDiffsByRecordSourceKey = []

      let dataField = self.getDataField(sourceDataPack)

      let allSourceSObjects = self.getAllIndividualSObjectsInDataPack(sourceDataPack.VlocityDataPackData[dataField][0])

      let allTargetSObjects = self.getAllIndividualSObjectsInDataPack(targetDataPack.VlocityDataPackData[dataField][0])

      // Target are most important
      let targetDiffKeys = self.getAllByUniqueKey(sourceDataPack.VlocityDataPackType, Object.values(allTargetSObjects))

      // For Target need to keep track of Unique
      let sourceDiffKeys = self.getAllByUniqueKey(sourceDataPack.VlocityDataPackType, Object.values(allSourceSObjects), targetDiffKeys)

      let foundTarget = new Set()

      for (let uniqueKey in sourceDiffKeys) {
        let obj = { editable: sourceDiffKeys[uniqueKey] }

        if (sourceDiffKeys[uniqueKey] && targetDiffKeys[uniqueKey]) {
          foundTarget.add(targetDiffKeys[uniqueKey].VlocityRecordSourceKey)

          let fieldDiffs = await self.getFieldDiffsForSObjects(sourceDataPack.VlocityDataPackType, sourceDiffKeys[uniqueKey], targetDiffKeys[uniqueKey])

          if (fieldDiffs.length > 0) {
            obj.diffType = 'Changed'
            obj.fieldDiffs = fieldDiffs
            allFieldDiffsByRecordSourceKey.push(obj)
          }
        } else {
          obj.diffType = 'New'
          obj.fieldDiffs = await self.getFieldDiffsForSObjects(sourceDataPack.VlocityDataPackType, sourceDiffKeys[uniqueKey], {})
          allFieldDiffsByRecordSourceKey.push(obj)
        }
      }

      allTargetSObjects.forEach(function (obj) {
        if (!foundTarget.has(obj.VlocityRecordSourceKey)) {
          if (self.isDeletedDuringDeploy(sourceDataPack.VlcoityDataPackType, obj.VlocityRecordSObjectType)) {
            allFieldDiffsByRecordSourceKey.push({ editable: obj, diffType: 'Deleted' })
          }
        }
      })

      for (let obj of allFieldDiffsByRecordSourceKey) {
        let labelFields = self.getRecordLabel(null, obj.editable.VlocityRecordSObjectType)

        let label = self.objectLabels[obj.editable.VlocityRecordSObjectType]

        for (let labelField of labelFields) {
          if (obj.editable[labelField]) {
            label += `/${obj.editable[labelField]}`
          }
        }

        obj.VlocitySObjectRecordLabel = label.replace('%vlocity_namespace%__', '')
      }

      jobInfo.sObjectsInfo[targetDataPack.VlocityDataPackKey] = allFieldDiffsByRecordSourceKey
    }
  }
}

var ignoredFields = new Set([ 'VlocityRecordSourceKey', 'CurrencyIsoCode', 'VlocityRecordSObjectType', 'VlocityDataPackIsIncluded', 'VlocityDataPackType' ])

DataPacksUtils.prototype.getFieldDiffsForSObjects = async function (dataPackType, sourceObject, targetObject) {
  var self = this
  var fieldDiffs = []

  var unhashableFields = self.getUnhashableFields(dataPackType, sourceObject.VlocityRecordSObjectType) || []
  var sourceObjectKeys = Object.keys(sourceObject)

  for (var i = 0; i < sourceObjectKeys.length; i++) {
    var field = sourceObjectKeys[i]

    if (!ignoredFields.has(field) &&
        !Array.isArray(sourceObject[field]) &&
        field.indexOf('.') === -1 &&
        unhashableFields.indexOf(field) === -1 &&
        sourceObject[field] !== targetObject[field]) {
      var sourceObjParsed
      var targetObjParsed

      try {
        sourceObjParsed = JSON.parse(sourceObject[field])
        targetObjParsed = {}

        if (targetObject[field] !== null) {
          targetObjParsed = JSON.parse(targetObject[field])
        }
      } catch (e) {
        // Should be ignorable
      }

      if (sourceObjParsed !== null &&
                targetObjParsed !== null &&
                typeof sourceObjParsed === 'object' &&
                typeof targetObjParsed === 'object') {
        await self.setNestedFieldDiffs(sourceObjParsed, targetObjParsed, field, fieldDiffs, sourceObject.VlocityRecordSourceKey, sourceObject.VlocityRecordSObjectType)
        continue
      }

      let fieldLabel = await this.getFieldLabel(sourceObject.VlocityRecordSObjectType, field)

      if (typeof sourceObject[field] === 'object') {
        var sourceMatchingKey = sourceObject[field].VlocityMatchingRecordSourceKey ? sourceObject[field].VlocityMatchingRecordSourceKey : sourceObject[field].VlocityLookupRecordSourceKey
        var targetMatchingKey

        if (typeof targetObject[field] === 'object') {
          targetMatchingKey = targetObject[field].VlocityMatchingRecordSourceKey ? targetObject[field].VlocityMatchingRecordSourceKey : targetObject[field].VlocityLookupRecordSourceKey
        }

        if (sourceMatchingKey !== targetMatchingKey) {
          fieldDiffs.push({
            status: targetMatchingKey ? 'Changed' : 'New',
            value: sourceMatchingKey,
            old: targetMatchingKey,
            field: field,
            label: fieldLabel || field.replace('%vlocity_namespace%', self.vlocity.namespace),
            VlocityRecordSourceKey: targetObject.VlocityRecordSourceKey ? targetObject.VlocityRecordSourceKey : sourceObject.VlocityRecordSourceKey
          })
        }
      } else {
        var stat = targetObject[field] !== null ? 'Changed' : 'New'

        if (!(stat === 'New' && sourceObject[field] === '')) {
          fieldDiffs.push({
            status: targetObject[field] !== null ? 'Changed' : 'New',
            value: sourceObject[field],
            old: targetObject[field],
            field: field,
            label: fieldLabel || field.replace('%vlocity_namespace%', self.vlocity.namespace),
            VlocityRecordSourceKey: targetObject.VlocityRecordSourceKey ? targetObject.VlocityRecordSourceKey : sourceObject.VlocityRecordSourceKey
          })
        }
      }
    }
  }

  fieldDiffs.sort(function (a, b) {
    return self.fieldDiffsSortBy(a, b)
  })

  return fieldDiffs
}

DataPacksUtils.prototype.fieldDiffsSortBy = function (obj1, obj2) {
  if (obj1.status === 'Changed' && obj2.status !== 'Changed') {
    return -1
  } else if (obj2.status === 'Changed') {
    return 1
  } else if (obj1.priority && !obj2.priority) {
    return -1
  } else if (obj2.priority && !obj1.priority) {
    return 1
  } else if (obj1.priority && obj2.priority && obj1.priority !== obj2.priority) {
    return obj1.priority > obj2.priority ? -1 : 1
  } else if (obj1.label !== obj2.label) {
    return obj1.label < obj2.label ? -1 : 1
  }

  return 0
}

DataPacksUtils.prototype.setNestedFieldDiffs = async function (sourceObject, targetObject, currentPath, fieldDiffs, vlocityRecordSourceKey, sObjectType) {
  var self = this

  for (var field in sourceObject) {
    var fieldPath = `${currentPath}.${field}`
    let fieldLabel = await self.getFieldLabel(sObjectType, fieldPath)

    if (typeof sourceObject[field] === 'object' &&
        !Array.isArray(sourceObject[field])) {
      await self.setNestedFieldDiffs(sourceObject[field], targetObject[field] || {}, `${currentPath}.${field}`, fieldDiffs, vlocityRecordSourceKey, sObjectType)
    } else if (targetObject[field] !== null &&
        sourceObject[field] !== targetObject[field] &&
        stringify(sourceObject[field]) !== stringify(targetObject[field])) {
      fieldDiffs.push({
        status: 'Changed',
        value: sourceObject[field],
        old: targetObject[field],
        field: fieldPath,
        label: fieldLabel || fieldPath.replace('%vlocity_namespace%__', ''),
        VlocityRecordSourceKey: vlocityRecordSourceKey
      })
    } else if (sourceObject[field] !== targetObject[field] &&
        sourceObject[field] !== '' &&
        sourceObject[field] !== null &&
        stringify(sourceObject[field]) !== '{}') {
      fieldDiffs.push({
        status: 'New',
        value: sourceObject[field],
        field: fieldPath,
        label: fieldLabel || fieldPath.replace('%vlocity_namespace%__', ''),
        VlocityRecordSourceKey: vlocityRecordSourceKey
      })
    }
  }
}

DataPacksUtils.prototype.getAllByUniqueKey = function (dataPackType, sObjects, validKeys) {
  var self = this
  var allByUniqueKeys = {}

  for (var sObject of sObjects) {
    var diffKeys = self.getDiffKeys(dataPackType, sObject.VlocityRecordSObjectType)

    if (diffKeys) {
      var i = 1

      var addedValidKey = false

      while (diffKeys[i]) {
        var diffKey = ''

        for (var field of diffKeys[i]) {
          var value

          if (field.indexOf('_') === 0) {
            value = field
          } else if (field.indexOf('.') !== -1) {
            var currentObj = JSON.parse(JSON.stringify(sObject))

            var splitFields = field.split('.')
            for (var i = 0; i < splitFields.length; i++) {
              let nestedField = splitFields[i]

              if (i === splitFields.length - 1) {
                value = currentObj[nestedField]
              } else if (currentObj[nestedField]) {
                if (typeof currentObj[nestedField] === 'string') {
                  currentObj = JSON.parse(currentObj[nestedField])
                } else {
                  currentObj = currentObj[nestedField]
                }
              } else {
                break
              }
            }
          } else {
            value = sObject[field]
          }

          if (value === null || value === '') {
            diffKey = null
            break
          }

          diffKey += value + '|'
        }

        if (validKeys && !validKeys[diffKey]) {
          diffKey = null
        }

        if (diffKey) {
          if (allByUniqueKeys[diffKey] === null) {
            allByUniqueKeys[diffKey] = sObject

            if (validKeys) {
              addedValidKey = true
              break
            }
          } else {
            allByUniqueKeys[diffKey] = false
          }
        }

        i++
      }

      if (validKeys && !addedValidKey) {
        allByUniqueKeys[ this.vlocity.datapacksutils.guid() ] = sObject
      }
    } else {
      allByUniqueKeys[ sObject.VlocityRecordSourceKey ] = sObject
    }
  }

  return allByUniqueKeys
}

DataPacksUtils.prototype.endsWith = function (str, suffix) {
  return str.indexOf(suffix, str.length - suffix.length) !== -1
}

DataPacksUtils.prototype.countRemainingInManifest = function (jobInfo) {
  jobInfo.exportRemaining = 0

  Object.keys(jobInfo.fullManifest).forEach(function (dataPackType) {
    if (!jobInfo.alreadyExportedIdsByType[dataPackType]) {
      jobInfo.alreadyExportedIdsByType[dataPackType] = []
    }

    if (!jobInfo.alreadyErroredIdsByType[dataPackType]) {
      jobInfo.alreadyErroredIdsByType[dataPackType] = []
    }

    Object.keys(jobInfo.fullManifest[dataPackType]).forEach(function (dataPackKey) {
      var dataPackId = jobInfo.fullManifest[dataPackType][dataPackKey].Id

      if (jobInfo.alreadyExportedIdsByType[dataPackType].indexOf(dataPackId) === -1 &&
                jobInfo.alreadyExportedIdsByType[dataPackType].indexOf(dataPackKey) === -1 &&
                jobInfo.alreadyErroredIdsByType[dataPackType].indexOf(dataPackId) === -1 &&
                jobInfo.alreadyExportedKeys.indexOf(dataPackKey) === -1 &&
                jobInfo.currentStatus[dataPackKey] !== 'Error' &&
                jobInfo.currentStatus[dataPackKey] !== 'Ignored') {
        jobInfo.exportRemaining++
      }
    })
  })
}

DataPacksUtils.prototype.printJobStatus = function (jobInfo) {
  if (!jobInfo.currentStatus) {
    return
  }

  var statusCount = { Remaining: 0, Success: 0, Error: 0 }
  var statusReportFunc = {
    Success: VlocityUtils.success,
    Error: VlocityUtils.error,
    Remaining: VlocityUtils.warn,
    Ignored: VlocityUtils.verbose
  }

  var statusKeyMap = {
    'Ready': 'Remaining',
    'Header': 'Remaining',
    'Added': 'Remaining',
    'ReadySeparate': 'Remaining'
  }
  var keysByStatus = {}

  Object.keys(jobInfo.currentStatus).forEach(function (dataPackKey) {
    // Count statuses by status type
    var status = jobInfo.currentStatus[dataPackKey]
    status = statusKeyMap[status] || status
    statusCount[status] = (statusCount[status] || 0) + 1
    keysByStatus[status] = keysByStatus[status] || {}

    // For Exports
    var keyForStatus = jobInfo.vlocityKeysToNewNamesMap[dataPackKey] ? jobInfo.vlocityKeysToNewNamesMap[dataPackKey] : dataPackKey

    if (keyForStatus.indexOf('/') !== -1) {
      var slashIndex = keyForStatus.indexOf('/')
      var beforeSlash = keyForStatus.substring(0, slashIndex)
      var afterSlash = keyForStatus.substring(slashIndex + 1)

      if (!keysByStatus[status][beforeSlash]) {
        keysByStatus[status][beforeSlash] = []
      }
      var dataPackName = jobInfo.generatedKeysToNames[keyForStatus]

      if (dataPackName && afterSlash.indexOf(dataPackName) === -1) {
        afterSlash = dataPackName + ' - ' + afterSlash
      }

      if (keysByStatus[status][beforeSlash].indexOf(afterSlash) === -1) {
        keysByStatus[status][beforeSlash].push(afterSlash)
      }
    }
  })

  if (jobInfo.jobAction === 'Export' ||
        jobInfo.jobAction === 'GetDiffs' ||
        jobInfo.jobAction === 'GetDiffsAndDeploy' ||
        jobInfo.jobAction === 'GetDiffsCheck') {
    this.countRemainingInManifest(jobInfo)
    statusCount.Remaining = jobInfo.exportRemaining
  }

  var totalCount = Object.values(statusCount).reduce((a, b) => a + b)
  if (totalCount === 0) {
    return
  }

  var elapsedTime = (Date.now() - jobInfo.startTime) / 1000

  if (jobInfo.headersOnly) {
    VlocityUtils.report('Uploading Only Parent Objects')
  }

  if (jobInfo.ignoreAllParents) {
    VlocityUtils.report('Ignoring Parents')
  }

  if (this.vlocity.username) {
    VlocityUtils.report('Salesforce Org', this.vlocity.username)
  }

  VlocityUtils.report('Version Info', 'v' + VLOCITY_BUILD_VERSION, this.vlocity.namespace, this.vlocity.PackageVersion ? this.vlocity.PackageVersion : '')
  VlocityUtils.verbose('Log File', path.join(this.vlocity.tempFolder, 'logs', jobInfo.logName))

  if (jobInfo.forceDeploy) {
    VlocityUtils.report('Force Deploy', 'On')
  }

  VlocityUtils.report('Current Status', jobInfo.jobAction)
  Object.keys(statusCount).forEach(status => (statusReportFunc[status] || VlocityUtils.report)(status, statusCount[status]))
  VlocityUtils.report('Elapsed Time', Math.floor((elapsedTime / 60)) + 'm ' + Math.floor((elapsedTime % 60)) + 's')

  var countByStatus = {}

  Object.keys(keysByStatus).forEach(function (statusKey) {
    countByStatus[statusKey] = {}

    Object.keys(keysByStatus[statusKey]).forEach(function (typeKey) {
      countByStatus[statusKey][typeKey] = keysByStatus[statusKey][typeKey].length

      if (jobInfo.fullStatus) {
        var messageBeginning = typeKey + ' - ' + statusKey
        var total = keysByStatus[statusKey][typeKey].length

        if (statusKey === 'Success') {
          VlocityUtils.success(messageBeginning, total)
        } else if (statusKey === 'Error') {
          VlocityUtils.error(messageBeginning, total)
        } else {
          VlocityUtils.warn(messageBeginning, total)
        }
      }

      keysByStatus[statusKey][typeKey].sort()
    })
  })

  var logInfo = {
    Org: this.vlocity.username,
    Version: VLOCITY_BUILD_VERSION,
    PackageVersion: this.vlocity.PackageVersion,
    Namespace: this.vlocity.namespace,
    Job: jobInfo.jobName,
    Action: jobInfo.jobAction,
    ProjectPath: jobInfo.projectPath,
    TotalTime: Math.floor((elapsedTime / 60)) + 'm ' + Math.floor((elapsedTime % 60)) + 's',
    Count: countByStatus,
    Errors: jobInfo.errors,
    Status: keysByStatus
  }

  if (VlocityUtils.verboseLogging) {
    logInfo.FullLog = VlocityUtils.fullLog
  }

  try {
    fs.outputFileSync('VlocityBuildLog.yaml', yaml.dump(logInfo, { lineWidth: 1000 }))
    fs.copySync('VlocityBuildLog.yaml', path.join(this.vlocity.tempFolder, 'logs', jobInfo.logName))
  } catch (e) {
    VlocityUtils.log(e)
  }

  var errorLog = ''

  errorLog += 'Org: ' + this.vlocity.username + '\n'
  errorLog += 'Version: ' + VLOCITY_BUILD_VERSION + '\n'
  errorLog += 'PackageVersion: ' + this.vlocity.PackageVersion + '\n'
  errorLog += 'Namespace: ' + this.vlocity.namespace + '\n'
  errorLog += 'Job: ' + jobInfo.jobName + '\n'
  errorLog += 'Action: ' + jobInfo.jobAction + '\n'
  errorLog += 'ProjectPath: ' + jobInfo.projectPath + '\n'
  errorLog += 'Errors:' + (jobInfo.errors && jobInfo.errors.length > 0 ? ('\n' + jobInfo.errors.join('\n')) : ' None')

  fs.outputFileSync('VlocityBuildErrors.log', errorLog)
}

DataPacksUtils.prototype.saveCurrentJobInfo = function (jobInfo) {
  fs.outputFileSync(CURRENT_INFO_FILE, stringify(jobInfo, { space: 4 }), 'utf8')
  fs.copySync(CURRENT_INFO_FILE, CURRENT_INFO_FILE + '.bak')
}

DataPacksUtils.prototype.loadCurrentJobInfo = function (jobInfo) {
  try {
    Object.assign(jobInfo, JSON.parse(fs.readFileSync(CURRENT_INFO_FILE, 'utf8')))
    this.saveCurrentJobInfo(jobInfo)
  } catch (e) {
    try {
      Object.assign(jobInfo, JSON.parse(fs.readFileSync(CURRENT_INFO_FILE + '.bak', 'utf8')))
      this.saveCurrentJobInfo(jobInfo)
    } catch (ex) {
      VlocityUtils.error('Error Loading Saved Job', e, ex)
    }
  }
}

DataPacksUtils.prototype.loadFilesAtPath = function (srcpath) {
  var self = this
  var dirName = srcpath.substr(srcpath.lastIndexOf('/') + 1)

  if (!dirName.startsWith('.')) {
    self.loadedFiles[dirName] = {}
    self.getFiles(srcpath).forEach(function (filename) {
      self.loadedFiles[dirName][filename] = fs.readFileSync(path.join(srcpath + '/', filename), 'utf8')
    })
  }

  return self.loadedFiles
}

DataPacksUtils.prototype.loadFilesFromDir = function (srcpath) {
  var dirNames = fs.readdirSync(srcpath)

  for (var i = 0; i < dirNames.length; i++) {
    this.loadFilesAtPath(srcpath + '/' + dirNames[i])
  }

  return this.loadedFiles
}
