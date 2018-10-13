'use strict'

const _datapacksutils = require('../lib/datapacksutils');
const expect = require('chai').expect;

describe('DataPacksUtils', () => 
{
    var datapacksutils = new _datapacksutils({tempFolder: '../vlocity-temp'});
    
    it('should not be null', () => { 
        expect(_datapacksutils).to.not.be.eq(null);
        expect(datapacksutils).to.not.be.eq(null)
    }) 
    
    describe('guid', () => {
        it('should be a function', () => {
            expect(datapacksutils.guid).to.be.a('function')
        })

        var generatedGuids = {};

        for (var i = 0; i < 1000000; i++) {
            var newGuid = datapacksutils.guid();

            expect(generatedGuids[newGuid]).to.be.eq(undefined);

            generatedGuids[newGuid] = newGuid;
        }
    });
})