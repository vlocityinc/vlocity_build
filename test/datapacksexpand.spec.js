'use strict'

const _datapacksexpand = require('../lib/datapacksexpand');
const expect = require('chai').expect;

describe('DataPacksExpand', () => 
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
})