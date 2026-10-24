// The foreground service react-native-background-actions runs, declared for Android 14 and later:
// type remoteMessaging (the app relays the hub's messages; no daily time limit, as dataSync has),
// with the permissions it and the notices need.
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins')

const PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.WAKE_LOCK',
]

module.exports = config =>
  withAndroidManifest(config, c => {
    const manifest = c.modResults.manifest
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools'
    manifest['uses-permission'] = manifest['uses-permission'] || []
    for (const name of PERMISSIONS)
      if (!manifest['uses-permission'].some(p => p.$['android:name'] === name)) manifest['uses-permission'].push({ $: { 'android:name': name } })
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults)
    app.service = (app.service || []).filter(s => s.$['android:name'] !== 'com.asterinet.react.bgactions.RNBackgroundActionsTask')
    app.service.push({ $: { 'android:name': 'com.asterinet.react.bgactions.RNBackgroundActionsTask', 'android:foregroundServiceType': 'remoteMessaging', 'android:exported': 'false', 'tools:replace': 'android:foregroundServiceType' } })
    return c
  })
