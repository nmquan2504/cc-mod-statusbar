// The hub's page (remote/), copied into the APK as assets/page/ so the app loads it from the phone
// and only the sealed calls cross the tunnel: Cloudflare carries no code. Its paths made relative
// (it loads as file:///android_asset/page/app.html); speak.mjs and lineask.mjs as plain scripts
// (a module will not load from a file); e2e.js left out, as the app's bridge is the page's E2E.
// Run by plugins/with-page.js at prebuild; by hand: node scripts/page.js <out dir>
const fs = require('fs')
const path = require('path')

const REMOTE = path.join(__dirname, '..', '..', 'remote')
const read = name => fs.readFileSync(path.join(REMOTE, name), 'utf8')

function buildPage(out) {
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(path.join(out, 'vendor'), { recursive: true })
  let html = read('app.html')
  const swap = (from, to) => {
    if (!html.includes(from)) throw new Error(`page.js: remote/app.html no longer has ${from}`)
    html = html.replace(from, to)
  }
  swap(/<link rel="manifest"[^>]*>\n?/.exec(html)?.[0] ?? '<link rel="manifest"', '')
  swap('href="/icon.svg"', 'href="icon.svg"')
  swap('href="/vendor/hljs-dark.css"', 'href="vendor/hljs-dark.css"')
  swap('href="/vendor/hljs-light.css"', 'href="vendor/hljs-light.css"')
  swap('<script defer src="/i18n.js"></script>', '<script defer src="i18n.js"></script>')
  swap('<script type="module" src="/speak.mjs"></script>', '<script defer src="speak.js"></script>')
  swap('<script type="module" src="/lineask.mjs"></script>', '<script defer src="lineask.js"></script>')
  swap(/<script defer src="\/e2e\.js"><\/script>\n?/.exec(html)?.[0] ?? '<script defer src="/e2e.js">', '')
  swap('<script defer src="/app.js"></script>', '<script defer src="app.js"></script>')
  fs.writeFileSync(path.join(out, 'app.html'), html)

  // a module as a plain script: its exports kept in its own scope (it sets its global itself)
  const plain = name => `(() => {\n'use strict'\n${read(name).replace(/^export /gm, '')}\n})()\n`
  fs.writeFileSync(path.join(out, 'speak.js'), plain('speak.mjs'))
  fs.writeFileSync(path.join(out, 'lineask.js'), plain('lineask.mjs'))
  const app = read('app.js')
  if (!app.includes("'/vendor/highlight.min.js'")) throw new Error('page.js: remote/app.js no longer loads /vendor/highlight.min.js')
  fs.writeFileSync(path.join(out, 'app.js'), app.replace("'/vendor/highlight.min.js'", "'vendor/highlight.min.js'"))
  fs.copyFileSync(path.join(REMOTE, 'i18n.js'), path.join(out, 'i18n.js'))
  fs.copyFileSync(path.join(REMOTE, 'icon.svg'), path.join(out, 'icon.svg'))
  for (const f of ['highlight.min.js', 'hljs-dark.css', 'hljs-light.css', 'HIGHLIGHT-LICENSE']) fs.copyFileSync(path.join(REMOTE, 'vendor', f), path.join(out, 'vendor', f))
}

module.exports = { buildPage }
if (require.main === module) buildPage(path.resolve(process.argv[2] || 'page-out'))
