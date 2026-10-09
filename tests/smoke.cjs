const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync, mkdtempSync } = require('node:fs')
const { join } = require('node:path')
const testRoot = join(__dirname, '../artifacts')
mkdirSync(testRoot, { recursive: true })
app.setPath('userData', mkdtempSync(join(testRoot, 'smoke-userdata-')))
app.setPath('sessionData', app.getPath('userData'))
if (process.env.HBO_PACKAGED_ROOT) {
  const resources = join(process.env.HBO_PACKAGED_ROOT, 'resources')
  Object.defineProperty(app, 'isPackaged', { value: true })
  Object.defineProperty(process, 'resourcesPath', { value: resources })
  require(join(resources, 'app.asar', 'out', 'main', 'index.js'))
} else {
  require('../out/main/index.js')
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function toggleThroughUi(win, running) {
  await win.webContents.executeJavaScript("document.querySelector('.character button').click(); true")
  for (let attempt=0; attempt<50; attempt++) {
    await delay(100)
    const snapshot = await win.webContents.executeJavaScript('window.hboHelper.getSnapshot()')
    if (snapshot.status.running === running && snapshot.status.phase !== 'connecting') return snapshot
  }
  throw new Error('Monitor button did not complete')
}
const deadline = setTimeout(() => { console.error('Smoke test timed out'); app.exit(1) }, 25000)
let stage = 'startup'
app.whenReady().then(async () => {
  await delay(500)
  const launcher = BrowserWindow.getAllWindows()[0]
  if (!launcher) throw new Error('Launcher missing')
  if (launcher.webContents.isLoading()) await new Promise(resolve => launcher.webContents.once('did-finish-load', resolve))
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if (await launcher.webContents.executeJavaScript("!!document.querySelector('.launcher-heading button:not(:disabled)')")) break
    } catch { /* Wait for the initial renderer context. */ }
    await delay(50)
  }
  stage = 'discover'
  const games = await launcher.webContents.executeJavaScript('window.hboHelper.listGames()')
  const selected = games.find(game => !game.error && (!process.env.HBO_EXPECT_CHARACTER || game.character === process.env.HBO_EXPECT_CHARACTER))
  if (!selected) throw new Error('No readable game for live smoke test: ' + JSON.stringify(games))
  stage = 'navigate'
  await launcher.webContents.executeJavaScript(`document.querySelector('[data-process-id="${selected.processId}"] button').click(); true`)
  const win = launcher
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!win.webContents.isLoading() && await win.webContents.executeJavaScript("!!document.querySelector('.character button:not(:disabled)')")) break
    await delay(50)
  }
  stage = 'initial snapshot'
  const initial = await win.webContents.executeJavaScript("window.hboHelper.getSnapshot()")
  if (initial.sample !== null || initial.status.mode !== 'live') throw new Error('Stale or demo data at startup')
  const preview = await win.webContents.executeJavaScript('window.hboHelper.getContext()')
  if (preview.preview.character !== selected.character) throw new Error('Selected character preview is missing')
  const dir=join(__dirname,'../artifacts')
  mkdirSync(dir,{recursive:true})
  stage = 'initial capture'
  writeFileSync(join(dir,'dashboard-idle.png'),(await win.webContents.capturePage()).toPNG())
  stage = 'start'
  const start = await toggleThroughUi(win, true)
  if (!start.status.running || !start.sample || start.status.error) throw new Error(JSON.stringify(start))
  if (!Number.isInteger(start.sample.gold) || start.sample.gold < 0 || start.goldSession !== 0 || start.experienceSession !== 0 || start.status.intervalMs !== 5000)
    throw new Error('Unconfirmed fields or baseline are incorrect')
  if (process.env.HBO_EXPECT_CHARACTER && start.sample.character !== process.env.HBO_EXPECT_CHARACTER) throw new Error('Unexpected character')
  if (process.env.HBO_EXPECT_PROFESSION && start.sample.profession !== process.env.HBO_EXPECT_PROFESSION) throw new Error('Unexpected profession')
  if (process.env.HBO_EXPECT_GOLD && start.sample.gold !== Number(process.env.HBO_EXPECT_GOLD)) throw new Error('Unexpected gold')
  if (await win.webContents.executeJavaScript("document.querySelector('[data-current-gold]').innerText") !== start.sample.gold.toLocaleString('zh-TW')) throw new Error('Current gold missing in UI')
  const text = await win.webContents.executeJavaScript('document.body.innerText')
  if ((start.sample.character && !text.includes(start.sample.character)) ||
      (start.sample.profession && !text.includes(start.sample.profession)) || !text.includes('每 5 秒')) throw new Error('Identity or interval missing in UI')
  if (text.includes('掌握每一次成長') || !text.includes('本次記錄總累計')) throw new Error('Dashboard layout was not updated')
  const liveState = await win.webContents.executeJavaScript("document.querySelector('.character').getAttribute('aria-label')")
  if (!liveState.includes('記錄中')) throw new Error('Character monitor state is missing')
  if (start.sample.profession === '戰士') {
    const icon = await win.webContents.executeJavaScript("(() => { const img = document.querySelector('.avatar img'); return img && { loaded: img.complete && img.naturalWidth > 0, src: img.getAttribute('src') }; })()")
    if (!icon?.loaded || !icon.src.includes('warrior-')) throw new Error('Packaged warrior icon did not load')
  }
  stage = 'sampling'
  await delay(2200)
  const beforeInterval = await win.webContents.executeJavaScript("window.hboHelper.getSnapshot()")
  if (beforeInterval.sample.timestamp !== start.sample.timestamp) throw new Error('Sample occurred before five seconds')
  await delay(3400)
  const running = await win.webContents.executeJavaScript("window.hboHelper.getSnapshot()")
  if (!running.status.running || running.sample.timestamp <= start.sample.timestamp) throw new Error('No fresh updates')
  if (running.goldSession !== running.sample.gold - start.sample.gold) throw new Error('Gold delta did not use session baseline')
  const isolation = await win.webContents.executeJavaScript("typeof require")
  if (isolation !== 'undefined') throw new Error('Renderer is not isolated')
  stage = 'stop'
  const stopped = await toggleThroughUi(win, false)
  if (stopped.status.running) throw new Error('Monitor did not stop')
  await delay(100)
  const stoppedState = await win.webContents.executeJavaScript("document.querySelector('.character').getAttribute('aria-label')")
  if (!stoppedState.includes('已停止')) throw new Error('Character monitor state did not stop')
  writeFileSync(join(dir,'dashboard-stopped.png'),(await win.webContents.capturePage()).toPNG())
  await delay(5200)
  const stillStopped = await win.webContents.executeJavaScript("window.hboHelper.getSnapshot()")
  if (stillStopped.sample.timestamp !== stopped.sample.timestamp) throw new Error('Stopped monitor kept sampling')
  stage = 'restart'
  const restarted = await toggleThroughUi(win, true)
  if (!restarted.status.running || restarted.sample.timestamp <= running.sample.timestamp ||
      restarted.experienceSession !== 0 || restarted.goldSession !== 0 || restarted.startedAt <= start.startedAt)
    throw new Error('Restart did not synchronize a new baseline')
  await delay(200)
  writeFileSync(join(dir,'dashboard-live.png'),(await win.webContents.capturePage()).toPNG())
  win.setSize(880,860)
  await delay(200)
  const overflow = await win.webContents.executeJavaScript('document.documentElement.scrollWidth > window.innerWidth')
  if (overflow) throw new Error('Dashboard overflows minimum window width')
  writeFileSync(join(dir,'dashboard-narrow.png'),(await win.webContents.capturePage()).toPNG())
  stage = 'return'
  await win.webContents.executeJavaScript("document.querySelector('.back-entry').click(); true")
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await win.webContents.executeJavaScript("!!document.querySelector('.launcher-heading button:not(:disabled)')")) break
    await delay(50)
  }
  const returned = await win.webContents.executeJavaScript('window.hboHelper.getContext()')
  if (returned.target !== null || BrowserWindow.getAllWindows().length !== 1) throw new Error('Return to entrance failed')
  console.log(JSON.stringify({result:'PASS', character:restarted.sample.character, profession:restarted.sample.profession, gold:restarted.sample.gold, goldSession:restarted.goldSession, intervalMs:restarted.status.intervalMs, firstExperience:start.sample.experience, latestExperience:restarted.sample.experience, level:restarted.sample.level, threshold:restarted.sample.experienceRequired, processId:restarted.sample.processId, restartSynchronized:true}))
  clearTimeout(deadline)
  app.quit()
}).catch(error => { console.error({ stage, error: String(error), stack: error.stack }); clearTimeout(deadline); app.exit(1) })
