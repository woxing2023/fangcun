#!/usr/bin/env bash
# Linux counterpart of build-release.ps1; its root-file whitelist is shared.
set -euo pipefail
FANGCUN_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
FANGCUN_RELEASE=2.7.0-calendar3
FANGCUN_STAGE=$(mktemp -d /tmp/fangcun-release.XXXXXX)
trap 'rm -rf -- "$FANGCUN_STAGE"' EXIT
export FANGCUN_ROOT FANGCUN_STAGE
cd "$FANGCUN_ROOT"
npm run check
node <<'NODE'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = process.env.FANGCUN_ROOT, stage = process.env.FANGCUN_STAGE;
const source = fs.readFileSync(path.join(root, 'deploy/build-release.ps1'), 'utf8');
const block = source.match(/\$rootFiles = @\(([\s\S]*?)\n\)/);
if (!block) throw new Error('Release whitelist missing');
const files = [...block[1].matchAll(/"([^"\r\n]+)"/g)].map(match => match[1]);
if (files.length < 30) throw new Error('Release whitelist incomplete');
const copy = name => {
  const from = path.join(root,name), to = path.join(stage,name);
  fs.mkdirSync(path.dirname(to), { recursive:true });
  fs.cpSync(from,to,{recursive:true,filter:src => {
    const relative=path.relative(root,src).split(path.sep).join('/');
    return !/(^|\/)(build|\.gradle|\.idea|__pycache__|node_modules|\.git)(\/|$)/.test(relative)
      && !/(^|\/)(local\.properties|signing\.properties)$/.test(relative)
      && !/\.(jks|keystore|keystore\.id|pyc|pyo)$/.test(relative)
      && path.basename(relative) !== '.DS_Store';
  }});
};
files.forEach(copy);
['android','deploy','docs/store','imports/README.md',
  'imports/examples/fictional-university-timetable-sample.json',
  'docs/calendar-sync-guide.md','docs/deployment-guide.md','docs/release-2.7.0.md',
  'docs/workbench-xuan.md','docs/xuan-material.md','docs/mobile-repair.md','docs/touch-material.md'].forEach(copy);
const wrapper='android/gradle/wrapper/gradle-wrapper.jar';
const hash=base=>crypto.createHash('sha256').update(fs.readFileSync(path.join(base,wrapper))).digest('hex');
if(hash(root)!==hash(stage)) throw new Error('Gradle wrapper changed');
console.log(`Staged ${files.length} root files; Gradle wrapper unchanged.`);
NODE
mkdir -p release
tar --format=ustar --owner=0 --group=0 --numeric-owner -czf "release/fangcun-release-$FANGCUN_RELEASE.tar.gz" -C "$FANGCUN_STAGE" .
python3 deploy/scan-release-privacy.py "release/fangcun-release-$FANGCUN_RELEASE.tar.gz" --output release/fangcun-privacy-20260911-calendar3.json
cd release
sha256sum "fangcun-release-$FANGCUN_RELEASE.tar.gz" > fangcun-SHA256SUMS-20260911-calendar3.txt
sha256sum --check fangcun-SHA256SUMS-20260911-calendar3.txt
printf 'Release: %s/release/fangcun-release-%s.tar.gz\n' "$FANGCUN_ROOT" "$FANGCUN_RELEASE"
