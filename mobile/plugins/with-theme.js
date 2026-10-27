// The window in the app's own colours, light and dark (App.tsx's bg), not Expo's blue: Android
// draws the window's background and its colorPrimary (the task's colour) while the app animates
// open from the home screen or the app switcher, before the WebView shows the page
const { withAndroidColors, withAndroidColorsNight, withAndroidStyles, AndroidConfig } = require('expo/config-plugins')
const { assignColorValue } = AndroidConfig.Colors
const { assignStylesValue, getAppThemeGroup } = AndroidConfig.Styles

const LIGHT = '#f7f6f1'
const DARK = '#1a1a18'

const colors = value => c => {
  for (const name of ['colorPrimary', 'appBackground']) c.modResults = assignColorValue(c.modResults, { name, value })
  return c
}

module.exports = config => {
  config = withAndroidColors(config, colors(LIGHT))
  config = withAndroidColorsNight(config, colors(DARK))
  return withAndroidStyles(config, c => {
    c.modResults = assignStylesValue(c.modResults, { add: true, parent: getAppThemeGroup(), name: 'android:windowBackground', value: '@color/appBackground' })
    return c
  })
}
