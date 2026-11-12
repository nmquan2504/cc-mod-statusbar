// The app's own native module (android/): a file written into the phone's Downloads
import { requireNativeModule } from 'expo'

// save: the bytes as base64 (the app before pieces); saveFile: copied from a file the app wrote
type Downloads = { save(name: string, b64: string): Promise<string>; saveFile(name: string, uri: string): Promise<string> }

export default requireNativeModule<Downloads>('Downloads')
