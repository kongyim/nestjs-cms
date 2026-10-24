const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

test('CLI validates arguments, forwards dry-run, disables sync and always closes initialized connections', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cms-cli-'));
  const config = join(directory, 'auth.config.js');
  writeFileSync(config, 'process.env.CMS_CLI_ENV_TEST = "loaded"; exports.authConfig = {};');
  const events = [];
  let fail = false;
  const previousMarker = process.env.CMS_CLI_ENV_TEST;
  delete process.env.CMS_CLI_ENV_TEST;
  const originalLoad = Module._load;
  const originalLog = console.log;
  Module._load = function(id, ...rest) {
    if (['@nestjs-cms/auth', '@nestjs-cms/core', './importer'].includes(id))
      assert.equal(process.env.CMS_CLI_ENV_TEST, 'loaded', 'Host environment must load before CMS modules');
    if (id === '@nestjs-cms/auth') return { createAuthDataSource() {
      return { resources: [], dataSource: {
        setOptions(options) { events.push(options); },
        async initialize() { events.push('initialize'); },
        async destroy() { events.push('destroy'); },
      } };
    } };
    if (id === '@nestjs-cms/core') return { ResourceRegistry: class {} };
    if (id === './importer') return { DatabaseImporter: class {
      constructor(ds, registry, options) { events.push(options.keyFile); }
      async run(options) { events.push(options); if (fail) throw Error('import failed'); return {}; }
    } };
    return originalLoad.call(this, id, ...rest);
  };
  const oldKey = process.env.GSHEET_KEY_PATH;
  process.env.GSHEET_KEY_PATH = 'key.json';
  console.log = () => {};
  try {
    const { main } = require('../dist/cli');
    await assert.rejects(main([]), /--config is required/);
    await assert.rejects(main(['--unknown']), /Unknown option/);
    await main(['--help']);
    assert.deepEqual(events, []);
    await main(['--config', config, '--base-dir', directory, '--dry-run']);
    assert.deepEqual(events, [{ synchronize: false }, 'initialize', resolve(directory, 'key.json'), { dryRun: true }, 'destroy']);
    events.length = 0;
    fail = true;
    await assert.rejects(main(['--config', config]), /import failed/);
    assert.equal(events.at(-1), 'destroy');
    assert.deepEqual(events.at(-2), { dryRun: false });
    writeFileSync(join(directory, 'invalid.js'), 'exports.other = {};');
    await assert.rejects(main(['--config', join(directory, 'invalid.js')]), /authConfig object/);
  } finally {
    if (previousMarker === undefined) delete process.env.CMS_CLI_ENV_TEST;
    else process.env.CMS_CLI_ENV_TEST = previousMarker;
    Module._load = originalLoad;
    console.log = originalLog;
    if (oldKey === undefined) delete process.env.GSHEET_KEY_PATH;
    else process.env.GSHEET_KEY_PATH = oldKey;
    rmSync(directory, { recursive: true, force: true });
  }
});
