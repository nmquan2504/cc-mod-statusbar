// The app's version, as app.json gives it (the mod's own, set together when it ships): in the
// user agent the hub names it by, and for the page to offer an update when the mod is newer
import app from '../app.json'

export const VERSION: string = app.expo.version
export const USER_AGENT = `ClaudeRemote/${VERSION}`
