const { expect } = require('chai');
const DeltaCheck = require('../lib/deltacheck');
//const _vlocity = require('../lib/vlocity');

describe('DeltaCheck', () => {
  describe('checkIfMatchingKeyPresent', () => {
    it('should return true if the matching key is present', () => {
      const dataPackData = {
        testKey__c: 'testValue',
        anotherTestKey: 'anotherTestValue'
      };
      const matchingKey = 'testKey__c';
      const deltaCheck = new DeltaCheck();
      const result = deltaCheck.checkIfMatchingKeyPresent(dataPackData, matchingKey);
      expect(result).to.be.true;
    });

    it('should return true if the matching key is present as a relationship name', () => {
      const dataPackData = {
        'testKey__r.Name': 'testValue',
        anotherTestKey: 'anotherTestValue'
      };
      const matchingKey = 'testKey__c';
      const deltaCheck = new DeltaCheck();
      const result = deltaCheck.checkIfMatchingKeyPresent(dataPackData, matchingKey);
      expect(result).to.be.true;
    });

    it('should return false if the matching key is not present', () => {
      const dataPackData = {
        testKey: 'testValue',
        anotherTestKey: 'anotherTestValue'
      };
      const matchingKey = 'missingKey';
      const deltaCheck = new DeltaCheck();
      const result = deltaCheck.checkIfMatchingKeyPresent(dataPackData, matchingKey);
      expect(result).to.be.false;
    });
  });
});