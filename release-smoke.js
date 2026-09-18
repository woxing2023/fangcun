"use strict";

const fs = require("fs");
const path = require("path");

const root = __dirname;
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const buildApk = read("android/build-apk.ps1");
const upload = read("deploy/upload-and-upgrade.ps1");
const buildRelease = read("deploy/build-release.ps1");
const install = read("deploy/install.sh");
const verify = read("deploy/verify.sh");
const storePreflight = read("deploy/store-preflight.ps1");
const gradle = read("android/app/build.gradle.kts");

for (const [name, content] of [
  ["android/build-apk.ps1", buildApk],
  ["deploy/upload-and-upgrade.ps1", upload],
  ["deploy/build-release.ps1", buildRelease],
]) {
  assert(!/[^\x00-\x7F]/.test(content), `${name} must remain ASCII for Windows PowerShell 5.1`);
}

assert(buildApk.includes("commandlinetools-win-15859902_latest.zip"), "Android CLI tools are not pinned");
assert(buildApk.includes("90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a"), "Android CLI checksum is missing");
assert(buildApk.includes("gradle-9.5.0-bin.zip") && buildApk.includes("553c78f50dafcd54d65b9a444649057857469edf836431389695608536d6b746"), "Gradle distribution or checksum is missing");
assert(buildApk.includes("platforms;android-36") && buildApk.includes("build-tools;36.0.0"), "Android SDK packages are incomplete");
assert(buildApk.includes("assembleDebug") && buildApk.includes("assembleRelease"), "APK build variants are incomplete");
assert(buildApk.includes("apksigner.bat") && buildApk.includes("verify --verbose --print-certs") && buildApk.includes("zipalign.exe"), "Release APK signature or alignment verification is missing");

for (const marker of ["npm run check", "scp", "ssh", "deploy/backup.sh", "deploy/install.sh", "deploy/verify.sh"]) {
  assert(upload.includes(marker), `Deployment command is missing: ${marker}`);
}
assert(upload.includes("127.0.0.1:18443"), "Deployment script must preserve the private bind address");
assert(buildRelease.includes("android\\app\\build") && buildRelease.includes("android\\.gradle"), "Release staging does not exclude Android build caches");
assert(!buildRelease.includes('@("android", "deploy", "docs", "imports")'), "Release archive must not copy ignored personal imports");
assert(buildRelease.includes("fictional-university-timetable-sample.json"), "Release archive is missing the fictional import example");
assert(install.includes("outlook-sync.js") && install.includes("google-sync.js") && install.includes("reset-password.js") && install.includes("calendar-occurrences.js") && install.includes("deploy/reset-password.sh") && install.includes("deploy/verify.sh"), "Server install payload is incomplete");
assert(buildRelease.includes("calendar-occurrences.js") && buildRelease.includes("calendar-occurrences-smoke.js"), "Release archive is missing the calendar occurrences module or smoke");
assert(install.includes("privacy.html") && buildRelease.includes('"privacy.html"'), "Release payload is missing the privacy policy");
assert(verify.includes("systemctl is-active") && verify.includes("127\\.0\\.0\\.1:18443"), "Server verification is incomplete");
assert(verify.includes("FANGCUN_STORE_RELEASE") && verify.includes("FANGCUN_APP_BEIAN") && verify.includes("FANGCUN_ICP_BEIAN"), "Store deployment checks are incomplete");
assert(storePreflight.includes("npm run check") && storePreflight.includes("Android Debug") && storePreflight.includes("At least four distinct store screenshots"), "Store preflight does not cover tests, release signing, and screenshots");

for (const variable of [
  "FANGCUN_KEYSTORE_PATH",
  "FANGCUN_KEYSTORE_PASSWORD",
  "FANGCUN_KEY_ALIAS",
  "FANGCUN_KEY_PASSWORD",
]) {
  assert(gradle.includes(variable), `Release signing variable is missing: ${variable}`);
}

for (const relativePath of [
  "android/gradlew",
  "android/gradlew.bat",
  "android/gradle/wrapper/gradle-wrapper.jar",
  "android/gradle/wrapper/gradle-wrapper.properties",
]) {
  assert(fs.existsSync(path.join(root, relativePath)), `Gradle Wrapper file is missing: ${relativePath}`);
}

console.log("发布链检查通过：APK 工具链、签名、源码打包、SSH 升级、备份与服务器验收脚本均完整。");
