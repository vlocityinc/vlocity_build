'use strict'

const _sfdx = require('../lib/sfdx');
const shell = require('shelljs');
const fs = require('fs');

const expect = require('chai').expect;

describe('sfdx.shellEscapeArg', () => {
  const escape = _sfdx.shellEscapeArg;

  it('should be a function', () => {
    expect(escape).to.be.a('function');
  });

  it('wraps an ordinary path in single quotes unchanged', () => {
    expect(escape('/Users/dev/myproject')).to.eq("'/Users/dev/myproject'");
  });

  it('escapes an embedded single quote so the shell literal stays valid (functional bug)', () => {
    expect(escape("/tmp/o'brien's project")).to.eq("'/tmp/o'\\''brien'\\''s project'");
  });

  it('neutralizes a command-injection breakout attempt (CWE-78)', () => {
    // Without escaping, this closes no quote (there wasn't one) and the shell
    // treats ';' as a command separator, executing the second command.
    const attack = '/tmp/innocuous; touch /tmp/should-not-exist-sfdx-spec';
    const escaped = escape(attack);
    // The entire payload is now one single-quoted word to the shell.
    expect(escaped).to.eq("'/tmp/innocuous; touch /tmp/should-not-exist-sfdx-spec'");
  });

  it('actually prevents shell interpretation when passed through shell.exec (end-to-end)', () => {
    const canary = '/tmp/should-not-exist-sfdx-spec-' + process.pid;
    try {
      shell.exec(`echo ${escape('foo; touch ' + canary)} > /dev/null`, { silent: true });
      expect(fs.existsSync(canary)).to.eq(false);
    } finally {
      if (fs.existsSync(canary)) fs.unlinkSync(canary);
    }
  });

  it('preserves the prior template-literal coercion for null/undefined', () => {
    expect(escape(undefined)).to.eq("'undefined'");
    expect(escape(null)).to.eq("'null'");
  });
});
