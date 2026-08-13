import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { isolatedEnv, makeTempDir } from '../helpers/temp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', '..', 'bin', 'tidykeep.mjs');

function installWithUserRoot(label) {
  const base = makeTempDir(`manifest-portable-${label}-`);
  const project = join(base, 'project');
  const kimiHome = join(base, 'user', '.kimi-code');
  const userDir = join(base, 'user', '.tidykeep');
  mkdirSync(project, { recursive: true });
  mkdirSync(kimiHome, { recursive: true });
  writeFileSync(join(kimiHome, 'config.toml'), '# same user config\n');
  execFileSync('git', ['-C', project, 'init', '-q']);
  const env = isolatedEnv({ KIMI_CODE_HOME: kimiHome, TIDYKEEP_USER_DIR: userDir });
  const result = spawnSync(process.execPath, [
    BIN, 'init', project, '--agents', 'kimi', '--no-git-hooks',
  ], { encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return {
    base,
    text: readFileSync(join(project, '.tidykeep', 'manifest.json'), 'utf8'),
  };
}

test('manifest 不持久化用户目录或安装时间，跨不同 home 字节稳定', () => {
  const first = installWithUserRoot('first');
  const second = installWithUserRoot('second');
  assert.equal(first.text, second.text);
  assert.equal(first.text.includes(first.base), false);
  assert.equal(second.text.includes(second.base), false);
  assert.deepEqual(Object.keys(JSON.parse(first.text)), [
    'manifestVersion', 'toolVersion', 'runtimeVersion', 'agents', 'files',
  ]);
});

test('manifest 不持久化不同用户 settings 内容或机器 EOL，重复安装字节稳定', () => {
  const install = (label, eol, settingValue) => {
    const base = makeTempDir(`manifest-user-bytes-${label}-`);
    const project = join(base, 'project');
    mkdirSync(join(project, '.claude'), { recursive: true });
    writeFileSync(join(project, '.claude', 'settings.json'), JSON.stringify({
      permissions: { allow: [settingValue] },
    }, null, 2).replaceAll('\n', eol) + eol);
    execFileSync('git', ['-C', project, 'init', '-q']);
    const env = isolatedEnv({
      KIMI_CODE_HOME: join(base, 'missing-kimi'),
      TIDYKEEP_USER_DIR: join(base, 'user', '.tidykeep'),
    });
    const args = [BIN, 'init', project, '--agents', 'claude', '--no-git-hooks'];
    for (let index = 0; index < 2; index++) {
      const result = spawnSync(process.execPath, args, { encoding: 'utf8', env });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    const text = readFileSync(join(project, '.tidykeep', 'manifest.json'), 'utf8');
    const parsed = JSON.parse(text);
    assert.deepEqual(Object.keys(parsed.files).every((rel) => parsed.files[rel].managed === true), true);
    assert.equal(text.includes(settingValue), false);
    return text;
  };

  assert.equal(install('lf', '\n', 'Bash(secret-one:*)'), install('crlf', '\r\n', 'Bash(secret-two:*)'));
});
