// The release APK signed with the app's own key when the build is given one (GitHub Actions, from
// the repository's secrets; or a local build with the same variables), so each release installs
// over the one before. With none, a local build keeps the debug key, as Expo's template has it.
//   CLAUDE_REMOTE_KEYSTORE           path to the keystore (.jks)
//   CLAUDE_REMOTE_KEYSTORE_PASSWORD  its password, the key's too
//   CLAUDE_REMOTE_KEY_ALIAS          the key's alias
const { withAppBuildGradle } = require('expo/config-plugins')

const RELEASE = `
        release {
            if (System.getenv('CLAUDE_REMOTE_KEYSTORE')) {
                storeFile file(System.getenv('CLAUDE_REMOTE_KEYSTORE'))
                storePassword System.getenv('CLAUDE_REMOTE_KEYSTORE_PASSWORD')
                keyAlias System.getenv('CLAUDE_REMOTE_KEY_ALIAS')
                keyPassword System.getenv('CLAUDE_REMOTE_KEYSTORE_PASSWORD')
            }
        }`

module.exports = config =>
  withAppBuildGradle(config, c => {
    let gradle = c.modResults.contents
    if (gradle.includes('CLAUDE_REMOTE_KEYSTORE')) return c
    gradle = gradle.replace(/signingConfigs \{/, `signingConfigs {${RELEASE}`)
    gradle = gradle.replace(
      /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/,
      "$1signingConfig System.getenv('CLAUDE_REMOTE_KEYSTORE') ? signingConfigs.release : signingConfigs.debug",
    )
    if (!gradle.includes("? signingConfigs.release")) throw new Error('with-release-signing: the release build type was not found in app/build.gradle')
    c.modResults.contents = gradle
    return c
  })
