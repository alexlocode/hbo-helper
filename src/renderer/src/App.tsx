import { useEffect, useState } from 'react'
import type { MonitorSnapshot } from '../../shared/types'

const number = (value: number) => Math.round(value).toLocaleString('zh-TW')
const eta = (seconds: number | null) => {
  if (seconds === null) return '累積資料中'
  const minutes = Math.ceil(seconds / 60)
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分` : `${minutes} 分鐘`
}

export default function App() {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let mounted = true
    const unsubscribe = window.hboHelper.onSnapshot(value => { if (mounted) setSnapshot(value) })
    void window.hboHelper.getSnapshot().then(value => { if (mounted) setSnapshot(value) })
      .catch(err => { if (mounted) setError(String(err)) })
    return () => { mounted = false; unsubscribe() }
  }, [])

  async function toggle() {
    setBusy(true)
    setError('')
    try {
      setSnapshot(snapshot?.status.running ? await window.hboHelper.stop() : await window.hboHelper.start())
    } catch (err) { setError(String(err)) }
    finally { setBusy(false) }
  }

  const sample = snapshot?.sample
  const progress = sample ? Math.min(100, sample.experience / sample.experienceRequired * 100) : 0
  const elapsed = snapshot?.startedAt && sample ? Math.max(0, Math.floor((sample.timestamp - snapshot.startedAt) / 60_000)) : 0
  return <div className="shell">
    <aside>
      <div className="brand"><span className="brand-icon">H</span><div>HBO Helper<small>冒險紀錄助手</small></div></div>
      <div className="nav-caption">工作空間</div>
      <div className="nav-item active"><span>◈</span> 即時監測</div>
      <div className="aside-bottom"><span className="dot amber" /> 遊戲即時讀取<br /><small>v0.2.0 · 指標監測</small></div>
    </aside>
    <main>
      <header><div><div className="eyebrow">HOLY BEAST ONLINE</div><h1>掌握每一次成長</h1><p>經驗、收益與升級進度，一眼看清。</p></div><div className="status"><span className={'dot ' + (snapshot?.status.running ? 'green' : 'muted')} />{snapshot?.status.phase === 'connecting' ? '同步中' : snapshot?.status.phase === 'error' ? '讀取中斷' : snapshot?.status.running ? '監測中' : '尚未開始'}</div></header>
      <div className="notice"><span>✧</span><div><strong>{snapshot?.status.running ? '正在讀取遊戲即時數據' : snapshot?.status.phase === 'connecting' ? '正在同步最新角色資料' : snapshot?.status.phase === 'error' ? '讀取已停止' : sample ? '監測已停止' : '等待連接遊戲'}</strong><p>{snapshot?.status.running ? '每秒更新經驗與升級進度。角色名稱與金幣尚未定位，暫不顯示。' : snapshot?.status.phase === 'connecting' ? '正在尋找遊戲程序並驗證角色指標，完成後建立新的統計起點。' : sample ? '畫面保留最後一次讀取結果。重新開始會同步當下資料並重設統計。' : '先開啟 Holy Beast Online 並登入角色，再按「開始監測」取得當下資料。'}</p></div></div>
      {(error || snapshot?.status.error) && <div className="error" role="alert">{error || snapshot?.status.error}</div>}
      <section className="character panel">
        <div className="avatar">H</div><div className="character-name"><small>目前角色</small><h2>{sample?.character ?? '角色名稱未取得'}</h2></div>
        <div className="level"><small>等級</small><strong>{sample?.level ?? '—'}</strong></div>
        <button disabled={busy || !snapshot} onClick={() => void toggle()}>{busy ? '同步中…' : snapshot?.status.running ? '停止監測' : '開始監測'}</button>
      </section>
      <section className="metrics">
        <article className="panel metric"><small>最近 10 分鐘經驗</small><strong>{sample && snapshot ? number(snapshot.experience10m) : '—'}</strong><span>EXP <i>滾動統計</i></span></article>
        <article className="panel metric"><small>最近 30 分鐘經驗</small><strong>{sample && snapshot ? number(snapshot.experience30m) : '—'}</strong><span>EXP <i>滾動統計</i></span></article>
        <article className="panel metric"><small>本次金幣淨變化</small><strong className="gold">{snapshot?.goldSession != null ? (snapshot.goldSession >= 0 ? '+' : '') + number(snapshot.goldSession) : '未取得'}</strong><span>GOLD <i>目前持有 {sample?.gold != null ? number(sample.gold) : '未取得'}</i></span></article>
      </section>
      <section className="panel progress-panel">
        <div className="section-heading"><h2>升級進度</h2><strong>{sample ? progress.toFixed(2) : '—'}<small>%</small></strong></div>
        <div className="progress-track" role="progressbar" aria-label="升級進度" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div style={{ width: progress + '%' }} /></div>
        <div className="progress-label"><span>{sample ? number(sample.experience) : '—'} / {sample ? number(sample.experienceRequired) : '—'} EXP</span><span>還差 {sample ? number(Math.max(0, sample.experienceRequired - sample.experience)) : '—'}</span></div>
        <div className="details"><div><small>每小時經驗估計</small><strong>{snapshot?.experiencePerHour != null ? number(snapshot.experiencePerHour) : '累積資料中'}</strong></div><div><small>預估升級時間</small><strong>{eta(snapshot?.etaSeconds ?? null)}</strong></div><div><small>本次累積經驗</small><strong>{sample && snapshot ? number(snapshot.experienceSession) : '—'}</strong></div></div>
      </section>
      <footer><span>{snapshot?.status.running ? `每秒取樣 · 已累積 ${elapsed} 分鐘 · PID ${sample?.processId ?? "—"}` : "尚未監測或已停止更新"} · 未滿視窗長度時，以本次已有資料計算</span><span>{sample ? new Date(sample.timestamp).toLocaleTimeString('zh-TW', { hour12: false }) : '—'}</span></footer>
    </main>
  </div>
}
