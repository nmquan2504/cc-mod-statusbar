import { expect, test } from 'claude-code/testing'
import { installZeroTts, uninstallZeroTts, zeroTtsSessionStart } from '../hooks/features/zerotts'

// /zerotts-install (hooks/features/zerotts.ts): it starts remote/zerotts-setup.sh in the background
// and says where, or that ZeroTTS is in already, or installing.
const fake = (stdout: string, exitCode = 0, stderr = '') => {
  const ran: string[][] = []
  const $ = { plugin: { root: '/mod' }, process: { run: async (argv: string[]) => (ran.push(argv), { exitCode, stdout, stderr }) } }
  return { $, ran }
}

test('a first install starts the setup script in the background and names the folder and its log', async () => {
  const { $, ran } = fake('started /home/me/.cache/cc-mod-statusbar/zerotts\n')
  const text = await installZeroTts($)
  expect(ran[0]?.slice(0, 2)).toEqual(['/bin/sh', '-c'])
  expect(ran[0]?.[3]).toBe('/mod/remote/zerotts-setup.sh')
  expect(ran[0]?.[2]).toContain('nohup sh "$0"')
  // the setup goes off with &, at a line's end: "& ;" is a shell's syntax error
  expect(ran[0]?.[2]).not.toMatch(/&\s*;/)
  expect(text).toContain('Installing ZeroTTS in the background')
  expect(text).toContain('a toast tells each step, and the voice loads when it is done')
  expect(text).toContain('/home/me/.cache/cc-mod-statusbar/zerotts/setup.log')
})

test('installed already, or installing: said, and nothing started again', async () => {
  // installed: it loads the voice on the remote, which is off here
  expect(await installZeroTts(fake('ready /h').$)).toBe('ZeroTTS is installed in /h; the remote is off: it loads the voice the first time the phone asks. On the phone it is the default voice (Settings, Automatic).')
  expect(await installZeroTts(fake('running /h').$)).toBe('ZeroTTS is installing already; a toast tells each step. Log: /h/setup.log.')
  expect(await installZeroTts(fake('', 1, 'mkdir: permission denied').$)).toBe('Could not start the install: mkdir: permission denied')
})

test('the mod lists /zerotts-install among its own commands from the start of a session', async () => {
  const registered: string[] = []
  await zeroTtsSessionStart({ command: { register: async (c: { name: string }) => void registered.push(c.name) } })
  expect(registered).toEqual(['zerotts-install', 'zerotts-uninstall'])
})

test('/zerotts-uninstall stops the voice, deletes the folder and says what it freed; a folder not named zerotts stays', async () => {
  const at = (stdout: string) => {
    const ran: string[][] = []
    const $ = {
      plugin: { root: '/mod' },
      process: { run: async (argv: string[]) => (ran.push(argv), argv[0] === '/bin/sh' ? { exitCode: 0, stdout, stderr: '' } : { exitCode: 1, stdout: '', stderr: '' }) },
      env: { get: async () => undefined },
    }
    return { $, ran }
  }
  const removed = at('removed /home/me/.cache/cc-mod-statusbar/zerotts 1.1G\n')
  expect(await uninstallZeroTts(removed.$)).toBe('ZeroTTS removed from /home/me/.cache/cc-mod-statusbar/zerotts (1.1G freed). The phone reads with its own voices again.')
  const script = removed.ran.find(a => a[0] === '/bin/sh')?.[2] ?? ''
  expect(script).toContain('case "$home" in */zerotts) ;; *) echo "refused $home"; exit 0 ;; esac')
  expect(script).toContain('rm -rf "$home"')
  expect(await uninstallZeroTts(at('none /h/zerotts').$)).toBe('ZeroTTS is not installed (no /h/zerotts).')
  expect(await uninstallZeroTts(at('refused /tmp/x').$)).toBe('Not removed: /tmp/x is not a folder named zerotts.')
})

test('a started install is followed with a toast at each step, then the voice is loaded', async () => {
  const steps = ['started /h', 'python', 'python', 'model 30%', 'model 40%', 'model 80%', 'ready']
  const toasts: string[] = []
  const $ = {
    plugin: { root: '/mod' },
    process: { run: async (argv: string[]) => ({ exitCode: argv[0] === '/bin/sh' ? 0 : 1, stdout: argv[0] === '/bin/sh' ? steps.shift() ?? 'ready' : '', stderr: '' }) },
    clock: { sleep: async () => undefined },
    ui: { toast: (text: string) => void toasts.push(text) },
  }
  await installZeroTts($)
  for (let i = 0; i < 50 && !toasts.some(t => t.includes('ready')); i++) await Promise.resolve()
  expect(toasts).toEqual([
    'statusbar: ZeroTTS: installing its Python',
    'statusbar: ZeroTTS: downloading the model 25%',
    'statusbar: ZeroTTS: downloading the model 75%',
    'statusbar: ZeroTTS installed; loading the voice…',
    'statusbar: ZeroTTS ready, the remote is off: it loads the voice the first time the phone asks',
  ])
})
