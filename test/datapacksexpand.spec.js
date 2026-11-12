'use strict'

const _datapacksexpand = require('../lib/datapacksexpand');
const _datapacksutils = require('../lib/datapacksutils');
const _vlocityutils = require('../lib/vlocityutils');
const path = require('path');


const expect = require('chai').expect;

describe('DataPacksExpand', async () => 
{
  var datapacksexpand = new _datapacksexpand();
  
  it('should not be null', () => { 
    expect(_datapacksexpand).to.not.be.eq(null);
    expect(datapacksexpand).to.not.be.eq(null)
  }) 
  
  describe('generateFolderOrFilename', () => {
    it('should be a function', () => {
      expect(datapacksexpand.generateFolderOrFilename).to.be.a('function')
    })
    it('should replace namespace placeholder', () => {
      var name = '%vlocity_namespace%__NameSpace';
      expect(datapacksexpand.generateFolderOrFilename(name)).to.be.eq('NameSpace');
    })
    it('should replace all non asci characters with including spaces a dash (-)', () => {
      var name = '1$2%3^4(a*b:c\\d';
      expect(datapacksexpand.generateFolderOrFilename(name)).to.be.eq('1-2-3-4-a-b-c-d');
    })
    it('should replace multiple invalid characters in sequence with a single dash', () => {
      var name = '1!@#$%^&*()*&^%$#@$%^&2';
      expect(datapacksexpand.generateFolderOrFilename(name)).to.be.eq('1-2');
    })
    it('should replace extra dashes (1) before the key seperator', () => {
      var name = 'a$/$b';
      expect(datapacksexpand.generateFolderOrFilename(name)).to.be.eq('a/b');
    })
    it('should trim dashes from right side and left side', () => {
      var name = '#%#%#1!@#$%^&*()*&^%$#@$%^&2#$%^&*()';
      expect(datapacksexpand.generateFolderOrFilename(name)).to.be.eq('1-2');
    })
    it('should trim key seperators right side and left side', () => {
      var name = '#$%^&*/#%#%#1!@#$%^&*()*&^%$#@$%^&2#$%^&*()/$%^&*&^/%^&*&^%^&';
      expect(datapacksexpand.generateFolderOrFilename(name)).to.be.eq('1-2');
    })
    it('should trim ()', () => {
      var name = 'a (a-b)';
      expect(datapacksexpand.generateFolderOrFilename(name)).to.be.eq('a-a-b');
    })   
    
    it('should be 250 chars', () => {
      var name = path.join('test','test2','123456789-'.repeat(30));

      console.log(datapacksexpand.generateFolderOrFilename(name));
      expect(path.basename(datapacksexpand.generateFolderOrFilename(name))).to.have.length(250);
    })   
  })

  describe('assertPathWithin (path-traversal guard)', () => {
    const path = require('path');
    var base = path.resolve('/tmp/sfdx-project/force-app');

    it('should be a function', () => {
      expect(datapacksexpand.assertPathWithin).to.be.a('function')
    })
    it('should return the resolved path for a target inside the base', () => {
      var target = path.join(base, 'main', 'default', 'OmniScript', 'Type_SubType_English.json');
      expect(datapacksexpand.assertPathWithin(base, target)).to.be.eq(path.resolve(target));
    })
    it('should allow legitimate DataPack keys containing / separators', () => {
      var target = path.join(base, 'main', 'default', 'DataRaptor/MyDR/MyDR.json');
      expect(() => datapacksexpand.assertPathWithin(base, target)).to.not.throw();
    })
    it('should throw on a ../ traversal that escapes the base', () => {
      var target = path.join(base, 'main', 'default', '../../../../../../etc/cron.d/evil');
      expect(() => datapacksexpand.assertPathWithin(base, target)).to.throw(/traversal/i);
    })
    it('should throw on a sibling-directory prefix escape', () => {
      var target = base + '-evil/payload';
      expect(() => datapacksexpand.assertPathWithin(base, target)).to.throw(/traversal/i);
    })
  })

  describe('generateFolderPath (path-traversal guard)', () => {
    var base = path.resolve('/tmp/sfdx-project/force-app');
    var expand = new _datapacksexpand();
    expand.targetPath = base;
    it('should build a path inside targetPath for a legit dataPackType', () => {
      var folder = expand.generateFolderPath('OmniScript', 'Type_SubType');
      expect(path.resolve(folder).startsWith(base + path.sep)).to.be.eq(true);
    })
    it('should throw when a crafted VlocityDataPackType escapes targetPath', () => {
      expect(() => expand.generateFolderPath('../../../../../../tmp/evil', 'MyPack')).to.throw(/traversal/i);
    })
    it('should throw on a sibling-directory prefix escape', () => {
      expect(() => expand.generateFolderPath('../force-app-evil', 'MyPack')).to.throw(/traversal/i);
    })
  })

  describe('enforceSecurityValidations opt-out', () => {
    var base = path.resolve('/tmp/sfdx-project/force-app');
    var evil = path.join(base, '../../../../../../etc/cron.d/evil');
    it('enforces assertPathWithin when flag is undefined (default on)', () => {
      var expand = new _datapacksexpand();
      expect(() => expand.assertPathWithin(base, evil)).to.throw(/traversal/i);
    })
    it('enforces generateFolderPath guard when flag is undefined (default on)', () => {
      var expand = new _datapacksexpand();
      expand.targetPath = base;
      expect(() => expand.generateFolderPath('../../../../../../tmp/evil', 'MyPack')).to.throw(/traversal/i);
    })
    it('enforces when explicitly set to true', () => {
      var expand = new _datapacksexpand();
      expand.enforceSecurityValidations = true;
      expect(() => expand.assertPathWithin(base, evil)).to.throw(/traversal/i);
    })
    it('bypasses assertPathWithin only when explicitly set to false', () => {
      var expand = new _datapacksexpand();
      expand.enforceSecurityValidations = false;
      expect(() => expand.assertPathWithin(base, evil)).to.not.throw();
    })
  })

  describe('getNameWithFields', () => {
    it('should be a function', () => {
      expect(datapacksexpand.getNameWithFields).to.be.a('function')
    })
    it('should replace names with data in supplied name field order', () => {
      var names = ['Family', 'Name'];
      var data = {'Name': '1', 'Family': '2'};
      expect(datapacksexpand.getNameWithFields(names, data)).to.be.eq('2_1');
    })
    it('should treat names prefixed with _ as static values', () => {
      var names = ['Family', '_Name'];
      var data = {'Name': '1', 'Family': '2'};
      expect(datapacksexpand.getNameWithFields(names, data)).to.be.eq('2_Name');
    })
    it('should both / and \\ as key seperatros replacing them with /', () => {
      var names = ['Family', '/', 'Name', '\\' , 'Family'];
      var data = {'Name': '1', 'Family': '2'};
      expect(datapacksexpand.getNameWithFields(names, data)).to.be.eq('2/1/2');
    })
  })

  describe('ignoreDataPacks', () => {

    var ignore = require( 'ignore');
    const data = [
      'DataRaptor/',
      'CalculationMatrix/*',
      '!CalculationMatrix/test2',
      'OmniScript*',
      '!OmniScript/test1',
      '!IntegrationProcedure/'
    ];
    datapacksexpand.vlocity.datapacksutils = new _datapacksutils({tempFolder: '../vlocity-temp'});
    datapacksexpand.targetPath = './example_vlocity_build/';
    datapacksexpand.vlocity.datapacksutils.ignoreFileMap = ignore().add(data);

    if(datapacksexpand.vlocity.datapacksutils.ignoreFileMap)
    {
      it('should ignore DataRaptor/test1', async () => {
        expect(await datapacksexpand.writeFile('DataRaptor','test1','test1_Version','json','abcd')).to.be.undefined;
      })
      it('should ignore CalculationMatrix/test1', async () => {
        expect(await datapacksexpand.writeFile('CalculationMatrix','test1','test1_Version','json','abcd')).to.be.undefined;
      })
      it('should not ignore CalculationMatrix/test2', async () => {
        expect(await datapacksexpand.writeFile('CalculationMatrix','test2','test2_Version','','abcd',false,'')).to.be.equal('test2_Version');
      })
      it('should ignore OmniScript/test1', async () => {
        expect(await datapacksexpand.writeFile('OmniScript','test1','test1_Version','json','abcd')).to.be.undefined;
      })
      it('should ignore OmniScript/test2', async () => {
        expect(await datapacksexpand.writeFile('OmniScript','test2','test2_Version','json','abcd')).to.be.undefined;
      })
      it('should not ignore IntegrationProcedure/test1', async () => {
        expect(await datapacksexpand.writeFile('IntegrationProcedure','test1','test1_Version','','abcd',false,'')).to.be.equal('test1_Version');
      })
    }
  })

  describe('expandSFDX static resource copy source (path-traversal guard)', () => {
    const fs = require('fs-extra');
    const os = require('os');
    var root, target, expand, jobInfo, originalCwd;

    var staticPack = (originalFilePath) => ({
      VlocityDataPackKey: 'staticresources/res',
      SFDXDataType: 'staticresources',
      SFDXData: JSON.stringify([{ encoding: 'utf8', filePath: 'main/default/staticresources/res/a.txt', originalFilePath: originalFilePath }])
    });
    var resourceFile = (sfdxRoot, content) => {
      var file = path.join(sfdxRoot, 'main', 'default', 'staticresources', 'res', 'a.txt');
      fs.outputFileSync(file, content);
      return file;
    };
    var sfdxProject = (dir, packageDir) => fs.outputFileSync(path.join(dir, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: packageDir }] }));
    var copied = () => fs.existsSync(path.join(target, 'main', 'default', 'staticresources', 'res', 'a.txt'));
    var rejects = async (originalFilePath) => {
      try { await expand.expandSFDX(staticPack(originalFilePath), jobInfo); } catch (e) { return /traversal/i.test(e.message); }
      return false;
    };

    beforeEach(() => {
      originalCwd = process.cwd();
      root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vbt-expand-')));
      target = path.join(root, 'target');
      fs.ensureDirSync(target);
      process.chdir(root);
      expand = new _datapacksexpand({ tempFolder: path.join(root, 'vlocity-temp') });
      jobInfo = { sfdxFolderPath: target, projectPath: target, currentStatus: {} };
    });

    afterEach(() => {
      process.chdir(originalCwd);
      fs.removeSync(root);
    });

    it('rejects a file outside every allowed root', async () => {
      var other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vbt-outside-')));
      var outside = resourceFile(other, 'secret');
      expect(await rejects(outside)).to.eq(true);
      expect(copied()).to.eq(false);
      fs.removeSync(other);
    })
    it('copies from cwd force-app even when sfdx-project.json was rewritten to a temp project', async () => {
      sfdxProject(root, path.join('vlocity-temp', 'DX', 'salesforce_sfdx'));
      await expand.expandSFDX(staticPack(resourceFile(path.join(root, 'force-app'), 'from-cwd')), jobInfo);
      expect(fs.readFileSync(path.join(target, 'main', 'default', 'staticresources', 'res', 'a.txt'), 'utf8')).to.eq('from-cwd');
    })
    it('rejects a file under an allowed root that is not in a staticresources folder', async () => {
      var credentials = path.join(root, 'vlocity-temp', 'user.json');
      fs.outputFileSync(credentials, 'token');
      expect(await rejects(credentials)).to.eq(true);
      expect(copied()).to.eq(false);
    })
    it('rejects files in the cwd outside its sfdx package directory', async () => {
      sfdxProject(root, 'force-app');
      fs.writeFileSync(path.join(root, '.env'), 'secret');
      expect(await rejects(path.join(root, '.env'))).to.eq(true);
    })
    it('copies from an org export project under the temp folder', async () => {
      await expand.expandSFDX(staticPack(resourceFile(path.join(root, 'vlocity-temp', 'org_x', 'project'), 'from-org')), jobInfo);
      expect(fs.readFileSync(path.join(target, 'main', 'default', 'staticresources', 'res', 'a.txt'), 'utf8')).to.eq('from-org');
    })
    it('copies from the sfdx project that sits beside the source project (../DX)', async () => {
      fs.ensureDirSync(path.join(root, 'src', 'datapacks'));
      sfdxProject(path.join(root, 'src', 'DX'), 'salesforce_sfdx');
      jobInfo.sourceProjectPath = path.join(root, 'src', 'datapacks');
      await expand.expandSFDX(staticPack(resourceFile(path.join(root, 'src', 'DX', 'salesforce_sfdx'), 'from-dx')), jobInfo);
      expect(fs.readFileSync(path.join(target, 'main', 'default', 'staticresources', 'res', 'a.txt'), 'utf8')).to.eq('from-dx');
    })
    it('copies from the cwd sfdx project when the source project has none', async () => {
      sfdxProject(root, 'force-app');
      fs.ensureDirSync(path.join(root, 'vlocity'));
      jobInfo.sourceProjectPath = path.join(root, 'vlocity');
      await expand.expandSFDX(staticPack(resourceFile(path.join(root, 'force-app'), 'from-cwd')), jobInfo);
      expect(fs.readFileSync(path.join(target, 'main', 'default', 'staticresources', 'res', 'a.txt'), 'utf8')).to.eq('from-cwd');
    })
    it('copies from the project being expanded into', async () => {
      await expand.expandSFDX(staticPack(resourceFile(path.join(root, 'proj'), 'in-project')), Object.assign(jobInfo, { projectPath: path.join(root, 'proj') }));
      expect(copied()).to.eq(true);
    })
    it('does not enforce when enforceSecurityValidations is false', async () => {
      expand.enforceSecurityValidations = false;
      await expand.expandSFDX(staticPack(resourceFile(path.join(root, 'elsewhere'), 'x')), jobInfo);
      expect(copied()).to.eq(true);
    })
  })
})
