// The app's own native module (android/): a file written into the phone's Downloads
import { requireNativeModule } from 'expo'

type Downloads = { save(name: string, b64: string): Promise<string> }

export default requireNativeModule<Downloads>('Downloads')
