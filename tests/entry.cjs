const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync, mkdtempSync } = require('node:fs')
const { join } = require('node:path')
const testRoot = join(__dirname, '../artifacts')
mkdirSync(testRoot, { recursive: true })
app.setPath('userData', mkdtempSync(join(testRoot, 'entry-userdata-')))
app.setPath('sessionData', app.getPath('userData'))
if (process.env.HBO_PACKAGED_ROOT) {
  const resources = join(process.env.HBO_PACKAGED_ROOT, 'resources')
  Object.defineProperty(app, 'isPackaged', { value: true })
  Object.defineProperty(process, 'resourcesPath', { value: resources })
  require(join(resources, 'app.asar', 'out', 'main', 'index.js'))
} else require('../out/main/index.js')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const deadline = setTimeout(() => app.exit(1), 25000)
app.whenReady().then(async () => {
  await delay(400)
  const win = BrowserWindow.getAllWindows()[0]
  for (let i = 0; i < 100; i++) {
    if (!win.webContents.isLoading() && await win.webContents.executeJavaScript("!!document.querySelector('.launcher-heading button') && !document.querySelector('.launcher-heading button').disabled")) break
    await delay(100)
  }
  const context = await win.webContents.executeJavaScript('window.hboHelper.getContext()')
  const games = await win.webContents.executeJavaScript('window.hboHelper.listGames()')
  const state = await win.webContents.executeJavaScript("({text:document.body.innerText,cards:document.querySelectorAll('.game-card').length,isolated:typeof require==='undefined'})")
  if (context.target !== null || state.cards !== games.length || !state.isolated || !state.text.includes('選擇要記錄的角色')) throw new Error('Launcher verification failed')
  if (games.length === 0 && !state.text.includes('目前沒有開啟 HBO Online')) throw new Error('Empty state missing')
  const before = await win.webContents.executeJavaScript("document.querySelector('.launcher > p').innerText")
  await delay(5600)
  const after = await win.webContents.executeJavaScript("document.querySelector('.launcher > p').innerText")
  if (before !== after || after.includes('每 5 秒自動更新')) throw new Error('Entry refreshed without user action')
  await win.webContents.executeJavaScript("window.dispatchEvent(new Event('focus')); true")
  await delay(400)
  if (await win.webContents.executeJavaScript("document.querySelector('.launcher > p').innerText") !== before) throw new Error('Entry refreshed on focus')
  await win.webContents.executeJavaScript("document.querySelector('.launcher-heading button').click(); true")
  for (let i = 0; i < 100; i++) {
    if (await win.webContents.executeJavaScript("!document.querySelector('.launcher-heading button').disabled")) break
    await delay(100)
  }
  if (await win.webContents.executeJavaScript("document.querySelector('.launcher > p').innerText") === before) throw new Error('Manual refresh did not update')
  if (await win.webContents.executeJavaScript("!!document.querySelector('.character')")) throw new Error('Entry started monitoring')
  const dir = join(__dirname, '../artifacts')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'launcher-real.png'), (await win.webContents.capturePage()).toPNG())
  const chosen = games.find(game => game.character === '190cm')
  if (chosen) {
    if (!Number.isInteger(chosen.level)) throw new Error('190cm level was not obtained')
    await win.webContents.executeJavaScript(`document.querySelector('[data-process-id="${chosen.processId}"] button').click(); true`)
    const monitor = win
    for (let i = 0; i < 100; i++) {
      if (!monitor.webContents.isLoading() && await monitor.webContents.executeJavaScript("!!document.querySelector('.character')")) break
      await delay(50)
    }
    const selected = await monitor.webContents.executeJavaScript('window.hboHelper.getContext()')
    const snapshot = await monitor.webContents.executeJavaScript('window.hboHelper.getSnapshot()')
    const text = await monitor.webContents.executeJavaScript('document.body.innerText')
    if (selected.target.processId !== chosen.processId || selected.preview.character !== '190cm' ||
        selected.preview.level !== chosen.level || snapshot.status.running || snapshot.sample !== null || !text.includes('190cm'))
      throw new Error('190cm selection or preview incorrect')
    writeFileSync(join(dir, '190cm-selected.png'), (await monitor.webContents.capturePage()).toPNG())
    if (BrowserWindow.getAllWindows().length !== 1) throw new Error('Navigation opened another window')
    await monitor.webContents.executeJavaScript("document.querySelector('.back-entry').click(); true")
    for (let i = 0; i < 100; i++) {
      if (await win.webContents.executeJavaScript("!!document.querySelector('.launcher-heading button:not(:disabled)')")) break
      await delay(50)
    }
    if ((await win.webContents.executeJavaScript('window.hboHelper.getContext()')).target !== null) throw new Error('Return failed')
  }
  console.log(JSON.stringify({result:'PASS',realDiscovery:true,gameCount:games.length,automaticRefresh:false,manualRefresh:true,selected190cm:!!chosen,monitoringStarted:false,packaged:app.isPackaged}))
  clearTimeout(deadline); app.quit()
}).catch(error => { console.error(error); clearTimeout(deadline); app.exit(1) })
