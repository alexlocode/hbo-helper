// Explicit fixtures exercise navigation and cleanup without touching the game.
const { app, BrowserWindow } = require('electron')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { mkdirSync, writeFileSync, existsSync, mkdtempSync } = require('node:fs')
const { join } = require('node:path')
const testRoot = join(__dirname, '../artifacts')
mkdirSync(testRoot, { recursive: true })
app.setPath('userData', mkdtempSync(join(testRoot, 'launcher-userdata-')))
app.setPath('sessionData', app.getPath('userData'))
const childProcess = require('node:child_process')
let games = []
const children = []
let scans = 0
childProcess.execFile = (_path, args, _options, callback) => {
  if (args[0] !== '--list') throw new Error('Unexpected fixture command')
  scans++
  setImmediate(() => callback(null, JSON.stringify({ type: 'games', games })))
}
childProcess.spawn = (_path, args) => {
  const target = games.find(game => String(game.processId) === args[1] && game.startedAt === args[2])
  if (!target) throw new Error('Wrong target')
  const child = new EventEmitter()
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough()
  let reads = 0
  child.stdin.on('data', () => {
    reads++
    child.stdout.write(JSON.stringify({ type: 'sample', sample: {
      timestamp: Date.now(), character: target.character, profession: target.profession,
      level: target.level, experience: 100 + reads, experienceRequired: 1000,
      gold: target.processId * 10 + reads, earnedExperience: reads - 1, processId: target.processId
    } }) + '\n')
  })
  child.kill = () => { child.killed = true; child.emit('exit'); child.stdout.end() }
  children.push(child)
  return child
}
if (process.env.HBO_PACKAGED_ROOT) {
  const resources = join(process.env.HBO_PACKAGED_ROOT, 'resources')
  Object.defineProperty(app, 'isPackaged', { value: true })
  Object.defineProperty(process, 'resourcesPath', { value: resources })
  if (!existsSync(join(resources, 'native', 'HboReader.exe')) || !existsSync(join(resources, 'native', 'profile.json'))) throw new Error('Native resources missing')
  require(join(resources, 'app.asar', 'out', 'main', 'index.js'))
} else require('../out/main/index.js')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const run = (win, code) => win.webContents.executeJavaScript(code)
const check = (condition, message) => { if (!condition) throw new Error(message) }
async function ready(win, selector) {
  for (let i = 0; i < 100; i++) {
    try {
      if (!win.webContents.isLoading() && await run(win, `!!document.querySelector('${selector}')`)) return
    } catch { /* The initial renderer context can still be initializing. */ }
    await delay(50)
  }
  throw new Error('UI did not load: ' + selector)
}
const deadline = setTimeout(() => app.exit(1), 30000)
app.whenReady().then(async () => {
  await delay(300)
  const win = BrowserWindow.getAllWindows()[0]
  const windowId = win.id
  await ready(win, '.empty-games')
  games = [
    { processId: 101, startedAt: '100000000001', character: '測試角色甲', profession: '戰士', level: 40, error: null },
    { processId: 102, startedAt: '100000000002', character: '測試角色乙', profession: '初心者', level: 6, error: null },
    { processId: 103, startedAt: '100000000003', character: null, profession: null, level: null, error: '測試：欄位未取得' }
  ]
  await run(win, "document.querySelector('.launcher-heading button').click(); true")
  await ready(win, '.game-card')
  check((await run(win, 'document.body.innerText')).includes('獲取到 3 個'), 'Wrong count')
  check(await run(win, "!!document.querySelector('[data-process-id=\"101\"] .entry-avatar img')"), 'Warrior icon missing')
  check(await run(win, "!!document.querySelector('[data-process-id=\"102\"] .entry-avatar.is-empty') && !document.querySelector('[data-process-id=\"102\"] .entry-avatar img')"), 'Beginner frame missing')
  const dir = join(__dirname, '../artifacts'); mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'launcher-fixtures.png'), (await win.webContents.capturePage()).toPNG())
  const scansBefore = scans
  await delay(5300)
  check(scans === scansBefore, 'Entrance polled')
  await run(win, "document.querySelector('[data-process-id=\"101\"] button').click(); true")
  await ready(win, '.character button:not(:disabled)')
  check(BrowserWindow.getAllWindows().length === 1 && win.id === windowId, 'Navigation opened a window')
  check((await run(win, 'window.hboHelper.getContext()')).target.processId === 101, 'Wrong first target')
  const initial = await run(win, 'window.hboHelper.getSnapshot()')
  check(initial.sample === null, 'Preview became baseline')
  const started = await run(win, 'window.hboHelper.start()')
  check(started.status.running && started.sample.gold === 1011, 'First monitor failed')
  const switched = await run(win, `window.hboHelper.openMonitor(${JSON.stringify(games[1])}).then(()=>false,()=>true)`)
  check(switched, 'Target switched without returning')
  await run(win, "document.querySelector('.back-entry').click(); true")
  await ready(win, '.launcher-heading button:not(:disabled)')
  check(children.every(child => child.killed), 'Return left reader alive')
  check((await run(win, 'window.hboHelper.getContext()')).target === null, 'Target not cleared')
  const returnScans = scans
  await delay(5300)
  check(scans === returnScans, 'Returned entrance polled')
  await run(win, "document.querySelector('[data-process-id=\"102\"] button').click(); true")
  await ready(win, '.character button:not(:disabled)')
  check((await run(win, 'window.hboHelper.getSnapshot()')).sample === null, 'Previous sample leaked into second target')
  const second = await run(win, 'window.hboHelper.start()')
  check(second.sample.processId === 102 && second.sample.gold === 1021 && second.goldSession === 0, 'Gold mixed between targets')
  await run(win, 'window.hboHelper.stop()')
  const restarted = await run(win, 'window.hboHelper.start()')
  check(restarted.status.running && restarted.goldSession === 0 && restarted.experienceSession === 0, 'Restart baseline incorrect')
  await run(win, "document.querySelector('.back-entry').click(); true")
  await ready(win, '.launcher-heading button:not(:disabled)')
  const unknown = await run(win, "window.hboHelper.openMonitor({processId:999,startedAt:'1'}).then(()=>false,()=>true)")
  check(unknown, 'Unknown target accepted')
  win.setSize(880, 660); await delay(150)
  check(!await run(win, 'document.documentElement.scrollWidth > innerWidth'), 'Entrance overflow')
  writeFileSync(join(dir, 'launcher-narrow-fixtures.png'), (await win.webContents.capturePage()).toPNG())
  check(BrowserWindow.getAllWindows().length === 1, 'Window count changed')
  console.log(JSON.stringify({ result: 'PASS', fixtureOnly: true, sameWindow: true, checks: ['icons', 'beginner frame', 'single entrance read', 'return cleanup', 'target isolation', 'restart', 'minimum width'] }))
  clearTimeout(deadline); app.quit()
  check(children.every(child => child.killed), 'Reader not disposed')
}).catch(error => { console.error(error); clearTimeout(deadline); app.exit(1) })
