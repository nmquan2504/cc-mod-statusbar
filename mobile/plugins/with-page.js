// The hub's page in the APK (scripts/page.js), written at prebuild into the Android project's
// assets, so the WebView loads file:///android_asset/page/app.html
const path = require('path')
const { withDangerousMod } = require('expo/config-plugins')
const { buildPage } = require('../scripts/page')

module.exports = config =>
  withDangerousMod(config, [
    'android',
    async c => {
      buildPage(path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main', 'assets', 'page'))
      return c
    },
  ])
