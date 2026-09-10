'use strict'

const _omniscript = require('../lib/datapacktypes/omniscript');
const _vlocityutils = require('../lib/vlocityutils');

const expect = require('chai').expect;

describe('OmniScript.escapeSOQLValue', () => {
  const escape = _omniscript.escapeSOQLValue;

  it('should be a function', () => {
    expect(escape).to.be.a('function');
  });

  it('leaves ordinary Type/SubType/Language values unchanged', () => {
    expect(escape('Claim')).to.eq('Claim');
    expect(escape('AddAttachments')).to.eq('AddAttachments');
    expect(escape('English')).to.eq('English');
  });

  it('escapes a legitimate apostrophe so the SOQL literal stays valid (functional bug)', () => {
    expect(escape("O'Brien")).to.eq("O\\'Brien");
  });

  it('neutralizes a SOQL-injection breakout attempt (CWE-89)', () => {
    // Without escaping this closes the literal and appends a predicate.
    const attack = "x' OR Name != '";
    expect(escape(attack)).to.eq("x\\' OR Name != \\'");
    // No unescaped single quote survives.
    expect(escape(attack).replace(/\\'/g, '')).to.not.contain("'");
  });

  it('escapes backslash before the quote (no escape-the-escape bypass)', () => {
    expect(escape("a\\'b")).to.eq("a\\\\\\'b");
  });

  it('preserves the prior template-literal coercion for null/undefined', () => {
    expect(escape(undefined)).to.eq('undefined');
    expect(escape(null)).to.eq('null');
  });
});
