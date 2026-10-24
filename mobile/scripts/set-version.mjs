// The app takes the mod's version (.claude-plugin/plugin.json): app.json's version, and an
// Android versionCode that grows with it (0.16.0 is 1600), so each release installs over the last.
//   node scripts/set-version.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const here = new URL('..', import.meta.url)
const { version } = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', here), 'utf8'))
const [major, minor, patch] = version.split('.').map(Number)
const file = new URL('app.json', here)
const app = JSON.parse(readFileSync(file, 'utf8'))
const code = major * 10_000 + minor * 100 + patch
if (app.expo.version !== version || app.expo.android.versionCode !== code) {
  app.expo.version = version
  app.expo.android.versionCode = code
  writeFileSync(file, `${JSON.stringify(app, null, 2)}\n`)
}
console.log(`app ${version} (${code})`)
