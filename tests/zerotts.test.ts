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
  expect(text).toContain('Installing ZeroTTS in the background')
  expect(text).toContain('/home/me/.cache/cc-mod-statusbar/zerotts/setup.log')
})

test('installed already, or installing: said, and nothing started again', async () => {
  expect(await installZeroTts(fake('ready /h').$)).toBe('ZeroTTS is installed in /h. On the phone, pick it in Settings, Vietnamese voice.')
  expect(await installZeroTts(fake('running /h').$)).toBe('ZeroTTS is installing already; see /h/setup.log.')
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
