import { useMemo, useState, type FormEvent } from 'react';
import { DISASTER_TYPES, LABELS, SEVERITY_LABELS, type Cluster } from '@dw/shared';
import ClusterDrawer from './ClusterDrawer';
import { db, LIVE, useData, useSession } from './data';
import MapView, { SEVERITY_COLORS, type Layers } from './MapView';
import { ago } from './util';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await db!.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError(error.message);
  };
  return (
    <div className="login">
      <form onSubmit={submit}>
        <div className="brand big"><span className="pulse" /> CrisisPulse</div>
        <p className="muted">Coordinator sign-in</p>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <div className="error">{error}</div>}
        <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}

type Window = 1 | 6 | 24 | 72;

function Dashboard() {
  const data = useData(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusReportId, setFocusReportId] = useState<string | null>(null);
  const [layers, setLayers] = useState<Layers>({ heat: true, clusters: true, reports: false });
  const [type, setType] = useState<string>('all');
  const [onlyTrapped, setOnlyTrapped] = useState(false);
  const [onlyChildren, setOnlyChildren] = useState(false);
  const [hideResolved, setHideResolved] = useState(false);
  const [hours, setHours] = useState<Window>(72);

  const since = Date.now() - hours * 3600_000;
  const reports = useMemo(() => data.reports.filter((r) => new Date(r.reported_at).getTime() >= since && (type === 'all' || r.disaster_type === type)), [data.reports, since, type]);
  const clusters = useMemo(
    () =>
      data.clusters
        .filter((c) => new Date(c.last_report_at).getTime() >= since)
        .filter((c) => type === 'all' || c.disaster_type === type)
        .filter((c) => !onlyTrapped || c.trapped_count > 0)
        .filter((c) => !onlyChildren || c.children_count > 0)
        .filter((c) => !hideResolved || c.status !== 'resolved')
        .sort((a, b) => b.severity - a.severity || b.trapped_count - a.trapped_count || b.report_count - a.report_count),
    [data.clusters, since, type, onlyTrapped, onlyChildren, hideResolved],
  );
  const totals = useMemo(
    () => ({
      trapped: clusters.reduce((s, c) => s + c.trapped_count, 0),
      children: clusters.reduce((s, c) => s + c.children_count, 0),
      injured: clusters.reduce((s, c) => s + c.injured_count, 0),
      critical: clusters.filter((c) => c.severity >= 5 && c.status !== 'resolved').length,
    }),
    [clusters],
  );
  const selected = data.clusters.find((c) => c.id === selectedId) ?? null;
  const selectedReports = useMemo(() => (selected ? data.reports.filter((r) => r.cluster_id === selected.id) : []), [data.reports, selected]);

  const select = (id: string | null) => {
    setSelectedId(id);
    setFocusReportId(null);
  };
  const selectReport = (id: string) => {
    const r = data.reports.find((x) => x.id === id);
    if (r?.cluster_id && r.cluster_id !== selectedId) setSelectedId(r.cluster_id);
    setFocusReportId(id);
  };
  const unclustered = reports.filter((r) => !r.cluster_id).length;

  return (
    <div className="app">
      <header>
        <div className="brand"><span className="pulse" /> CrisisPulse <span className="muted">Command</span></div>
        <div className="kpis">
          <div className="kpi"><b>{reports.length}</b><span>reports</span></div>
          <div className="kpi"><b>{clusters.length}</b><span>incident areas</span></div>
          <div className="kpi kpi-red"><b>{totals.trapped}</b><span>trapped (est.)</span></div>
          <div className="kpi kpi-amber"><b>{totals.children}</b><span>children</span></div>
          <div className="kpi kpi-orange"><b>{totals.injured}</b><span>injured</span></div>
          <div className="kpi kpi-purple"><b>{totals.critical}</b><span>critical open</span></div>
        </div>
        <div className="mode">
          <span className={`badge ${data.mode === 'live' ? 'badge-live' : ''}`}>{data.mode === 'live' ? '● Live' : 'Demo data'}</span>
          {data.mode === 'demo' && <span className="badge">{data.ai === 'ollama' ? 'AI: Ollama' : 'AI: keyword fallback'}</span>}
          {data.lastUpdate && <span className="muted small">updated {ago(data.lastUpdate.toISOString())}</span>}
          {LIVE && <button className="link" onClick={() => db!.auth.signOut()}>Sign out</button>}
        </div>
      </header>

      <div className="body">
        <nav className="sidebar">
          <div className="filters">
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="all">All disaster types</option>
              {DISASTER_TYPES.map((t) => (
                <option key={t} value={t}>{LABELS[t]}</option>
              ))}
            </select>
            <div className="seg">
              {([1, 6, 24, 72] as Window[]).map((h) => (
                <button key={h} className={hours === h ? 'active' : ''} onClick={() => setHours(h)}>{h}h</button>
              ))}
            </div>
            <label><input type="checkbox" checked={onlyTrapped} onChange={(e) => setOnlyTrapped(e.target.checked)} /> People trapped</label>
            <label><input type="checkbox" checked={onlyChildren} onChange={(e) => setOnlyChildren(e.target.checked)} /> Children present</label>
            <label><input type="checkbox" checked={hideResolved} onChange={(e) => setHideResolved(e.target.checked)} /> Hide resolved</label>
          </div>
          {data.error && <div className="error">{data.error}</div>}
          {data.loading && <div className="muted pad">Loading…</div>}
          <ul className="cluster-list">
            {clusters.map((c) => (
              <ClusterItem key={c.id} c={c} active={c.id === selectedId} onClick={() => select(c.id)} />
            ))}
          </ul>
          {unclustered > 0 && <div className="muted small pad">{unclustered} report(s) not in any incident area (isolated, low urgency).</div>}
        </nav>

        <main>
          <MapView
            reports={reports}
            clusters={clusters}
            selectedId={selectedId}
            focusReportId={focusReportId}
            layers={layers}
            onSelect={select}
            onSelectReport={selectReport}
          />
          <div className="layer-toggle">
            {(['heat', 'clusters', 'reports'] as const).map((k) => (
              <label key={k}>
                <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />
                {k === 'heat' ? 'Heat map' : k === 'clusters' ? 'Incident areas' : 'All reports'}
              </label>
            ))}
          </div>
          <div className="legend">
            {[5, 4, 3, 2, 1].map((s) => (
              <span key={s}><i style={{ background: SEVERITY_COLORS[s] }} />{SEVERITY_LABELS[s]}</span>
            ))}
          </div>
          {selected && (
            <ClusterDrawer
              cluster={selected}
              reports={selectedReports}
              focusReportId={focusReportId}
              onFocusReport={setFocusReportId}
              onStatus={(s) => data.setStatus(selected.id, s)}
              onClose={() => select(null)}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function ClusterItem({ c, active, onClick }: { c: Cluster; active: boolean; onClick: () => void }) {
  return (
    <li className={`cluster-item ${active ? 'active' : ''} ${c.status === 'resolved' ? 'resolved' : ''}`} onClick={onClick}>
      <i className="sev-bar" style={{ background: SEVERITY_COLORS[c.severity] }} />
      <div className="ci-body">
        <div className="ci-title">{c.title || 'Untitled'}</div>
        <div className="ci-meta">
          <span>{c.report_count} reports</span>
          {c.trapped_count > 0 && <span className="t-red">{c.trapped_count} trapped</span>}
          {c.children_count > 0 && <span className="t-amber">children</span>}
          {c.injured_count > 0 && <span className="t-orange">{c.injured_count} injured</span>}
          {c.status !== 'new' && <span className={`st st-${c.status}`}>{c.status}</span>}
        </div>
      </div>
    </li>
  );
}

export default function App() {
  const session = useSession();
  if (LIVE && session === undefined) return <div className="muted pad">Loading…</div>;
  if (LIVE && !session) return <Login />;
  return <Dashboard />;
}
