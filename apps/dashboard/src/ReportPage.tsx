/**
 * /report: a help-request form for anyone with a browser (no app install).
 * Same fields as the mobile app. Reports are queued in the browser and sent
 * when there is signal; client_id makes retries safe on the server.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { DISASTER_TYPES, LABELS, NEEDS, type DisasterType, type Need, type ReportInput } from '@dw/shared';
import { LOCAL_API } from './data';

type Fix = { lat: number; lng: number; accuracy: number | null };
interface Queued {
  input: ReportInput;
  photos: string[];
  status: 'queued' | 'sent' | 'failed';
  error?: string;
}

const KEY = 'crisispulse.web-outbox.v1';
const ICONS: Record<DisasterType, string> = {
  earthquake: '🌍', flood: '🌊', storm: '🌀', tornado: '🌪️', fire: '🔥', landslide: '⛰️', tsunami: '🌊', other: '⚠️',
};

function loadQueue(): Queued[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Queued[];
  } catch {
    return [];
  }
}
function saveQueue(q: Queued[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    // storage full or blocked: keep in memory only
  }
}

const clientId = () => `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** Resize to max 1280 px and JPEG-compress so photos send on weak signal. */
async function compress(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.6);
}

async function send(item: Queued): Promise<void> {
  if (!LOCAL_API) throw new Error('No server configured for this page.');
  const res = await fetch(`${LOCAL_API}/reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...item.input, photos: item.photos }),
  });
  if (!res.ok) throw new Error(`Server said ${res.status}`);
}

function Stepper({ label, value, set, min = 0 }: { label: string; value: number; set: (n: number) => void; min?: number }) {
  return (
    <div className="rp-step">
      <span>{label}</span>
      <button type="button" onClick={() => set(Math.max(min, value - 1))} aria-label={`Decrease ${label}`}>−</button>
      <b>{value}</b>
      <button type="button" onClick={() => set(value + 1)} aria-label={`Increase ${label}`}>+</button>
    </div>
  );
}

export default function ReportPage() {
  const [fix, setFix] = useState<Fix | null>(null);
  const [locState, setLocState] = useState<'locating' | 'ok' | 'denied' | 'error'>('locating');
  const [about, setAbout] = useState<'self' | 'others'>('self');
  const [type, setType] = useState<DisasterType>('earthquake');
  const [text, setText] = useState('');
  const [people, setPeople] = useState(1);
  const [trapped, setTrapped] = useState(0);
  const [injured, setInjured] = useState(0);
  const [children, setChildren] = useState(false);
  const [needs, setNeeds] = useState<Need[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [queue, setQueue] = useState<Queued[]>(loadQueue);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const locate = useCallback(() => {
    if (!navigator.geolocation) return setLocState('error');
    setLocState('locating');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
        setLocState('ok');
      },
      (e) => setLocState(e.code === e.PERMISSION_DENIED ? 'denied' : 'error'),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
    );
  }, []);
  useEffect(locate, [locate]);

  const flush = useCallback(async () => {
    const q = loadQueue();
    let changed = false;
    for (const item of q.filter((i) => i.status !== 'sent')) {
      try {
        await send(item);
        item.status = 'sent';
        item.error = undefined;
      } catch (e) {
        item.status = 'failed';
        item.error = (e as Error).message;
      }
      changed = true;
    }
    if (changed) {
      saveQueue(q);
      setQueue([...q]);
    }
  }, []);

  useEffect(() => {
    void flush();
    const t = setInterval(flush, 20000);
    window.addEventListener('online', flush);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', flush);
    };
  }, [flush]);

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const out = await Promise.all([...files].slice(0, 3 - photos.length).map(compress));
    setPhotos((p) => [...p, ...out].slice(0, 3));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!fix) return setNotice('We need your location so rescuers can find you. Allow location and tap "Locate me".');
    if (about === 'others' && !text.trim()) return setNotice('Please describe what you see in a few words.');
    setBusy(true);
    const self = about === 'self';
    const item: Queued = {
      status: 'queued',
      photos,
      input: {
        client_id: clientId(),
        lat: fix.lat,
        lng: fix.lng,
        accuracy_m: fix.accuracy,
        disaster_type: type,
        about,
        text: text.trim(),
        people_count: self ? people : null,
        trapped_count: self ? trapped : 0,
        has_children: self && children,
        injured_count: self ? injured : 0,
        needs,
        photo_paths: [],
        reported_at: new Date().toISOString(),
      },
    };
    const q = [item, ...loadQueue()];
    saveQueue(q);
    setQueue(q);
    await flush();
    const sent = loadQueue()[0]?.status === 'sent';
    setNotice(sent ? 'Report sent. Responders can see it now. Stay safe.' : 'Saved on this phone. It will be sent automatically when there is signal.');
    setText('');
    setTrapped(0);
    setInjured(0);
    setChildren(false);
    setNeeds([]);
    setPhotos([]);
    setBusy(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const waiting = queue.filter((i) => i.status !== 'sent').length;
  const toggleNeed = (n: Need) => setNeeds((xs) => (xs.includes(n) ? xs.filter((x) => x !== n) : [...xs, n]));

  return (
    <div className="rp">
      <header className="rp-head">
        <span className="pulse" /> <b>CrisisPulse</b> <span>Ask for help</span>
      </header>
      <form className="rp-body" onSubmit={submit}>
        {notice && <div className="rp-notice" role="status">{notice}</div>}
        {waiting > 0 && <div className="rp-warn">{waiting} report(s) waiting to send · retrying automatically</div>}
        {!LOCAL_API && <div className="rp-warn">This page is not connected to a response server right now. Call 112.</div>}

        <section className="rp-card">
          <h2>Your location</h2>
          {fix ? (
            <p className="rp-loc">
              📍 {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}
              {fix.accuracy != null && <em className={fix.accuracy > 100 ? 'bad' : ''}> ±{Math.round(fix.accuracy)} m</em>}
            </p>
          ) : (
            <p className="rp-muted">
              {locState === 'locating' ? 'Finding you…' : locState === 'denied' ? 'Location blocked. Allow location for this site in your browser settings.' : 'Could not get your location.'}
            </p>
          )}
          <button type="button" className="rp-secondary" onClick={locate}>{fix ? 'Update location' : 'Locate me'}</button>
        </section>

        <section className="rp-card">
          <h2>Who is this about?</h2>
          <div className="rp-seg">
            <button type="button" className={about === 'self' ? 'on' : ''} onClick={() => setAbout('self')}>Me / my group</button>
            <button type="button" className={about === 'others' ? 'on' : ''} onClick={() => setAbout('others')}>Others I can see</button>
          </div>
        </section>

        <section className="rp-card">
          <h2>What happened?</h2>
          <div className="rp-chips">
            {DISASTER_TYPES.map((t) => (
              <button type="button" key={t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>{ICONS[t]} {LABELS[t]}</button>
            ))}
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={4000}
            rows={4}
            placeholder={about === 'self' ? 'e.g. We are on the 2nd floor, stairs collapsed, my mother is hurt' : 'e.g. Building collapsed, about 6 people trapped, kids missing'}
          />
          <p className="rp-muted small">Any language is fine (Hindi, Hinglish, English…).</p>
        </section>

        {about === 'self' ? (
          <section className="rp-card">
            <h2>About you and your group</h2>
            <Stepper label="People with you (incl. you)" value={people} set={setPeople} min={1} />
            <Stepper label="Trapped / can't get out" value={trapped} set={setTrapped} />
            <Stepper label="Injured" value={injured} set={setInjured} />
            <div className="rp-step">
              <span>Children with you?</span>
              <div className="rp-chips inline">
                <button type="button" className={!children ? 'on' : ''} onClick={() => setChildren(false)}>No</button>
                <button type="button" className={children ? 'on red' : ''} onClick={() => setChildren(true)}>Yes</button>
              </div>
            </div>
          </section>
        ) : (
          <p className="rp-muted pad">Tip: say how many people you see trapped or injured, and whether children are there.</p>
        )}

        <section className="rp-card">
          <h2>What is needed?</h2>
          <div className="rp-chips">
            {NEEDS.map((n) => (
              <button type="button" key={n} className={needs.includes(n) ? (n === 'rescue' || n === 'medical' ? 'on red' : 'on') : ''} onClick={() => toggleNeed(n)}>
                {LABELS[n]}
              </button>
            ))}
          </div>
        </section>

        <section className="rp-card">
          <h2>Photos <span className="rp-muted small">(up to 3)</span></h2>
          <div className="rp-photos">
            {photos.map((p, i) => (
              <button type="button" key={i} onClick={() => setPhotos((xs) => xs.filter((_, j) => j !== i))} title="Remove">
                <img src={p} alt={`photo ${i + 1}`} />
              </button>
            ))}
          </div>
          {photos.length < 3 && (
            <label className="rp-secondary">
              📷 Add photo
              <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
            </label>
          )}
        </section>

        <button className="rp-send" disabled={busy}>{busy ? 'Sending…' : 'Send report'}</button>
        <p className="rp-muted small center">Emergency: 112 · Ambulance 108 · Fire 101</p>
      </form>
    </div>
  );
}
