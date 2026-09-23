// Re-applies Play Store release signing to the generated android/ project.
//
// android/ is generated (and gitignored), so hand edits to build.gradle — and a
// keystore stored inside it — are wiped by `expo prebuild --clean`. The key and
// passwords live outside the repo in ~/.gradle/gradle.properties:
//   NEXTUP_RELEASE_STORE_FILE=/abs/path/to/nextup-release.keystore
//   NEXTUP_RELEASE_KEY_ALIAS / NEXTUP_RELEASE_STORE_PASSWORD / NEXTUP_RELEASE_KEY_PASSWORD
// Without them (another machine, EAS) release builds fall back to debug signing.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// nextup-release-signing';

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;

    gradle = gradle.replace(
      /signingConfigs\s*\{\s*\n(\s*)debug\s*\{/,
      (match, indent) =>
        `signingConfigs {\n${indent}${MARKER}\n${indent}release {\n` +
        `${indent}    if (findProperty('NEXTUP_RELEASE_STORE_FILE')) {\n` +
        `${indent}        storeFile file(findProperty('NEXTUP_RELEASE_STORE_FILE'))\n` +
        `${indent}        storePassword findProperty('NEXTUP_RELEASE_STORE_PASSWORD')\n` +
        `${indent}        keyAlias findProperty('NEXTUP_RELEASE_KEY_ALIAS')\n` +
        `${indent}        keyPassword findProperty('NEXTUP_RELEASE_KEY_PASSWORD')\n` +
        `${indent}    }\n${indent}}\n${indent}debug {`,
    );
    gradle = gradle.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
      `$1signingConfig findProperty('NEXTUP_RELEASE_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`,
    );
    if (!gradle.includes(MARKER) || !gradle.includes('signingConfigs.release :')) {
      throw new Error('withReleaseSigning: build.gradle template changed — update the plugin.');
    }
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
