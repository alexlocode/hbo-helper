import { useEffect, useState } from 'react'
import type { MonitorSnapshot } from '../../shared/types'
import warriorIcon from './assets/professions/warrior.jpg'
import mageIcon from './assets/professions/mage.jpg'
import archerIcon from './assets/professions/archer.jpg'
import healerIcon from './assets/professions/healer.jpg'
import rogueIcon from './assets/professions/rogue.jpg'
import illusionistIcon from './assets/professions/illusionist.jpg'

const professionIcons: Record<string, string> = {
  '戰士': warriorIcon,
  '仙法師': mageIcon,
  '射手': archerIcon,
  '治療師': healerIcon,
  '盜賊': rogueIcon,
  '幻術師': illusionistIcon
}

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
  const professionIcon = sample?.profession ? professionIcons[sample.profession] : undefined
  const progress = sample ? Math.min(100, sample.experience / sample.experienceRequired * 100) : 0
  const elapsed = snapshot?.startedAt && sample ? Math.max(0, Math.floor((sample.timestamp - snapshot.startedAt) / 60_000)) : 0
  const phase = snapshot?.status.phase
  const running = snapshot?.status.running ?? false
  const stateLabel = phase === 'connecting' ? '同步中' : phase === 'error' ? '讀取中斷' : running ? '監測中' : sample ? '已停止' : '尚未開始'
  const stateHint = running ? `每 ${snapshot!.status.intervalMs / 1000} 秒更新角色資料與升級進度。` : phase === 'connecting' ? '正在同步最新角色資料，完成後建立新的統計起點。' : sample ? '資料已停止更新，重新開始會同步當下資料並重設統計。' : '先開啟遊戲並登入角色，再按「開始監測」。'
  return <div className="shell">
    <aside>
      <div className="brand"><span className="brand-icon">H</span><div>HBO Helper<small>冒險紀錄助手</small></div></div>
      <div className="nav-caption">工作空間</div>
      <div className="nav-item active"><span>◈</span> 即時監測</div>
      <div className="aside-bottom"><span className="dot amber" /> 遊戲即時讀取<br /><small>v0.3.3 · 指標監測</small></div>
    </aside>
    <main>
      {(error || snapshot?.status.error) && <div className="error" role="alert">{error || snapshot?.status.error}</div>}
      <section className={`character panel ${running ? 'is-running' : phase === 'connecting' ? 'is-connecting' : phase === 'error' ? 'is-error' : ''}`} aria-label={`角色資訊 · ${stateLabel}`}>
        <div className="character-row">
        <div className={`avatar ${professionIcon ? 'has-profession' : 'is-empty'}`} aria-hidden="true">{professionIcon && <img src={professionIcon} alt="" />}</div><div className="character-name"><small>目前角色 <span className="character-state" role="status">{stateLabel}</span></small><h2>{sample?.character ?? '角色名稱未取得'}</h2></div>
        <div className="character-meta">
        <div className="level"><small>職業</small><strong>{sample?.profession ?? '未取得'}</strong></div>
        <div className="level"><small>等級</small><strong>{sample?.level ?? '—'}</strong></div>
        </div>
        <button disabled={busy || !snapshot} onClick={() => void toggle()}>{busy ? '同步中…' : snapshot?.status.running ? '停止監測' : '開始監測'}</button>
        </div>
        <p className="character-hint">{stateHint}</p>
      </section>
      <section className="metrics">
        <article className="panel metric-group" aria-labelledby="recent-heading">
          <div className="group-heading"><h2 id="recent-heading">近期經驗統計</h2><span>滾動視窗</span></div>
          <div className="group-values">
            <div className="metric"><small>最近 10 分鐘</small><strong>{sample && snapshot ? number(snapshot.experience10m) : '—'}</strong><span>EXP</span></div>
            <div className="metric"><small>最近 30 分鐘</small><strong>{sample && snapshot ? number(snapshot.experience30m) : '—'}</strong><span>EXP</span></div>
          </div>
        </article>
        <article className="panel metric-group" aria-labelledby="session-heading">
          <div className="group-heading"><h2 id="session-heading">本次監測總累計</h2><span>{elapsed} 分鐘</span></div>
          <div className="group-values">
            <div className="metric"><small>累計經驗</small><strong>{sample && snapshot ? number(snapshot.experienceSession) : '—'}</strong><span>EXP</span></div>
            <div className="metric"><small>金幣淨變化</small><strong className="gold">{snapshot?.goldSession != null ? (snapshot.goldSession >= 0 ? '+' : '') + number(snapshot.goldSession) : '未取得'}</strong><span>GOLD</span></div>
          </div>
        </article>
      </section>
      <section className="panel progress-panel">
        <div className="section-heading"><h2>升級進度</h2><strong>{sample ? progress.toFixed(2) : '—'}<small>%</small></strong></div>
        <div className="progress-track" role="progressbar" aria-label="升級進度" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div style={{ width: progress + '%' }} /></div>
        <div className="progress-label"><span>{sample ? number(sample.experience) : '—'} / {sample ? number(sample.experienceRequired) : '—'} EXP</span><span>還差 {sample ? number(Math.max(0, sample.experienceRequired - sample.experience)) : '—'}</span></div>
        <div className="details"><div><small>每小時經驗估計</small><strong>{snapshot?.experiencePerHour != null ? number(snapshot.experiencePerHour) : '累積資料中'}</strong></div><div><small>預估升級時間</small><strong>{eta(snapshot?.etaSeconds ?? null)}</strong></div><div><small>本次累積經驗</small><strong>{sample && snapshot ? number(snapshot.experienceSession) : '—'}</strong></div></div>
      </section>
      <footer><span>{snapshot?.status.running ? `每 ${snapshot.status.intervalMs / 1000} 秒取樣 · 已累積 ${elapsed} 分鐘 · PID ${sample?.processId ?? "—"}` : "尚未監測或已停止更新"} · 未滿視窗長度時，以本次已有資料計算</span><span>{sample ? new Date(sample.timestamp).toLocaleTimeString('zh-TW', { hour12: false }) : '—'}</span></footer>
    </main>
  </div>
}
