import { useEffect, useMemo, useState } from 'react';
import { LABELS, SEVERITY_LABELS, type Cluster, type ClusterStatus, type Report } from '@dw/shared';
import { signedPhotoUrls } from './data';
import { SEVERITY_COLORS } from './MapView';
import { ago, clock } from './util';

type Filter = 'all' | 'trapped' | 'children' | 'injured' | 'self';

interface Props {
  cluster: Cluster;
  reports: Report[];
  focusReportId: string | null;
  onFocusReport: (id: string) => void;
  onStatus: (s: ClusterStatus) => void;
  onClose: () => void;
}

const label = (k: string) => LABELS[k as keyof typeof LABELS] ?? k;
const directions = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

function Photos({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    signedPhotoUrls(paths).then((u) => live && setUrls(u));
    return () => {
      live = false;
    };
  }, [paths]);
  if (!paths.length) return null;
  if (!urls.length) return <div className="muted small">{paths.length} photo(s)</div>;
  return (
    <div className="photos">
      {urls.map((u) => (
        <a key={u} href={u} target="_blank" rel="noreferrer">
          <img src={u} alt="report" />
        </a>
      ))}
    </div>
  );
}

function ReportCard({ r, focused, onClick }: { r: Report; focused: boolean; onClick: () => void }) {
  const x = r.extracted;
  const trapped = x?.trapped_count ?? r.trapped_count;
  const children = x?.children_count ?? (r.has_children ? 1 : 0);
  const injured = x?.injured_count ?? r.injured_count;
  return (
    <li
      className={`report ${focused ? 'focused' : ''}`}
      onClick={onClick}
      ref={(n) => {
        if (focused && n) n.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }}
    >
      <div className="report-head">
        <span className={`tag ${r.about === 'self' ? 'tag-self' : 'tag-witness'}`}>{r.about === 'self' ? 'About themselves' : 'Witness'}</span>
        {x && <span className={`urg urg-${x.urgency}`}>U{x.urgency}</span>}
        <span className="muted small right" title={new Date(r.reported_at).toLocaleString()}>
          {clock(r.reported_at)} · {ago(r.reported_at)}
        </span>
      </div>
      <p className="report-text">{r.text || <em className="muted">(no text)</em>}</p>
      <div className="flags">
        {trapped > 0 && <span className="flag flag-red">{trapped} trapped</span>}
        {children > 0 && <span className="flag flag-amber">{children} child{children > 1 ? 'ren' : ''}</span>}
        {injured > 0 && <span className="flag flag-orange">{injured} injured</span>}
        {r.people_count != null && <span className="flag">{r.people_count} people</span>}
        {[...new Set([...(x?.needs ?? []), ...r.needs])].map((n) => (
          <span key={n} className="flag flag-blue">{label(n)}</span>
        ))}
        {(x?.hazards ?? []).map((h) => (
          <span key={h} className="flag flag-hazard">{label(h)}</span>
        ))}
      </div>
      <Photos paths={r.photo_paths} />
      <div className="muted small">
        {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
        {r.accuracy_m != null && ` · ±${Math.round(r.accuracy_m)} m`} ·{' '}
        <a className="nav-link" href={directions(r.lat, r.lng)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          Navigate
        </a>
      </div>
    </li>
  );
}

export default function ClusterDrawer({ cluster: c, reports, focusReportId, onFocusReport, onStatus, onClose }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const shown = useMemo(() => {
    const sorted = [...reports].sort((a, b) => (b.extracted?.urgency ?? 0) - (a.extracted?.urgency ?? 0) || b.reported_at.localeCompare(a.reported_at));
    return sorted.filter((r) => {
      const x = r.extracted;
      if (filter === 'trapped') return (x?.trapped_count ?? r.trapped_count) > 0;
      if (filter === 'children') return (x?.children_count ?? 0) > 0 || r.has_children;
      if (filter === 'injured') return (x?.injured_count ?? r.injured_count) > 0;
      if (filter === 'self') return r.about === 'self';
      return true;
    });
  }, [reports, filter]);

  return (
    <aside className="drawer">
      <div className="drawer-head">
        <div>
          <div className="sev-pill" style={{ background: SEVERITY_COLORS[c.severity] }}>
            Severity {c.severity} · {SEVERITY_LABELS[c.severity]}
          </div>
          <h2>{c.title || 'Untitled cluster'}</h2>
          <div className="muted small">
            {label(c.disaster_type)} · {c.report_count} reports · radius ~{c.radius_m} m · {clock(c.first_report_at)}–{clock(c.last_report_at)} ·{' '}
            <a className="nav-link" href={directions(c.lat, c.lng)} target="_blank" rel="noreferrer">
              Navigate to area
            </a>
          </div>
        </div>
        <button className="icon" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="stats">
        <div className={`stat ${c.trapped_count ? 'stat-red' : ''}`}>
          <b>{c.trapped_count}</b>
          <span>trapped (est.)</span>
          {c.trapped_count > 0 && <em>{c.trapped_confirmed} self-reported</em>}
        </div>
        <div className={`stat ${c.children_count ? 'stat-amber' : ''}`}>
          <b>{c.children_count > 0 ? c.children_count : 'No'}</b>
          <span>{c.children_count > 0 ? 'children present' : 'children reported'}</span>
        </div>
        <div className={`stat ${c.injured_count ? 'stat-orange' : ''}`}>
          <b>{c.injured_count}</b>
          <span>injured</span>
        </div>
        <div className="stat">
          <b>{c.people_count}</b>
          <span>people affected</span>
        </div>
      </div>

      <section className="summary">
        <h3>AI situation report</h3>
        <p>{c.summary || <em className="muted">Summary pending…</em>}</p>
        {c.hazards.length > 0 && (
          <div className="chips">
            <span className="muted small">Hazards</span>
            {c.hazards.map((h) => (
              <span key={h} className="flag flag-hazard">{label(h)}</span>
            ))}
          </div>
        )}
        {c.needs.length > 0 && (
          <div className="chips">
            <span className="muted small">Needs</span>
            {c.needs.map((n) => (
              <span key={n} className="flag flag-blue">{label(n)}</span>
            ))}
          </div>
        )}
      </section>

      <div className="status-row">
        {(['new', 'dispatched', 'resolved'] as const).map((s) => (
          <button key={s} className={`status-btn ${c.status === s ? 'active' : ''} status-${s}`} onClick={() => onStatus(s)}>
            {s === 'new' ? 'New' : s === 'dispatched' ? 'Team dispatched' : 'Resolved'}
          </button>
        ))}
      </div>

      <div className="reports-head">
        <h3>Individual reports ({shown.length})</h3>
        <div className="seg">
          {(['all', 'trapped', 'children', 'injured', 'self'] as const).map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f === 'self' ? 'first-hand' : f}
            </button>
          ))}
        </div>
      </div>
      <ul className="report-list">
        {shown.map((r) => (
          <ReportCard key={r.id} r={r} focused={r.id === focusReportId} onClick={() => onFocusReport(r.id)} />
        ))}
        {!shown.length && <li className="muted small">No reports match this filter.</li>}
      </ul>
    </aside>
  );
}
