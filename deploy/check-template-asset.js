#!/usr/bin/env node
// Placeholder-aware verification for fangcun template assets.
// server.js serves index.html / privacy.html with {{OPERATOR_NAME}} /
// {{CONTACT}} / {{APP_BEIAN}} / {{ICP_BEIAN}} replaced from environment
// (/etc/fangcun.env and the systemd unit). A byte comparison of the served
// file against the packaged template therefore fails by design.
// This check reproduces the server's substitution exactly (same escape
// table, same defaults) and requires the served file to equal the
// substituted template byte-for-byte after that substitution.
// Usage: check-template-asset.js <asset> <served-file> [env-file] [unit-file]
'use strict';
const fs = require('fs');

const [assetPath, servedPath, envPath, unitPath] = process.argv.slice(2);
if (!assetPath || !servedPath) {
  console.error('usage: check-template-asset.js <asset> <served-file> [env-file] [unit-file]');
  process.exit(1);
}

function escapePublicText(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function stripQuotes(value) {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

function readEnvFile(file, env) {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(FANGCUN_[A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = stripQuotes(m[2]);
  }
}

// Environment= lines in the unit take precedence over EnvironmentFile.
function readUnitEnvironment(file, env) {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const m of raw.matchAll(/^\s*Environment=(.*)$/gm)) {
    const rest = m[1].trim();
    const tokenRe = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g;
    for (const token of rest.match(tokenRe) || []) {
      const eq = token.indexOf('=');
      if (eq <= 0) continue;
      const key = token.slice(0, eq);
      if (!/^FANGCUN_[A-Z_]+$/.test(key)) continue;
      env[key] = stripQuotes(token.slice(eq + 1));
    }
  }
}

const env = {};
if (envPath) readEnvFile(envPath, env);
if (unitPath) readUnitEnvironment(unitPath, env);

const replacements = {
  '{{OPERATOR_NAME}}': escapePublicText(env.FANGCUN_OPERATOR_NAME || '发布前待配置'),
  '{{CONTACT}}': escapePublicText(env.FANGCUN_CONTACT || '发布前待配置'),
  '{{APP_BEIAN}}': escapePublicText(env.FANGCUN_APP_BEIAN || '发布前待配置'),
  '{{ICP_BEIAN}}': escapePublicText(env.FANGCUN_ICP_BEIAN || '发布前待配置'),
};

let expected = fs.readFileSync(assetPath, 'utf8');
for (const [placeholder, value] of Object.entries(replacements)) {
  expected = expected.split(placeholder).join(value);
}
const served = fs.readFileSync(servedPath, 'utf8');
if (expected !== served) {
  console.error(`template asset mismatch after placeholder substitution: ${assetPath}`);
  process.exit(1);
}
console.log(`template-ok ${assetPath}`);
