/**
 * Local mode: the whole system on one Mac, no Supabase account needed.
 *
 *   phones (same Wi-Fi) ──POST /reports──▶ this server ──▶ AI pipeline
 *   dashboard ◀──GET /state (polled)──────┘
 *
 *   npm run local            # starts with the synthetic earthquake loaded
 *   npm run local -- --empty # starts with no reports
 *
 * State is kept in apps/worker/.local-data/ so a restart keeps reports.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { CLUSTER_STATUSES, ReportInputSchema, type Cluster, type ClusterStatus, type DemoData } from '@dw/shared';
import { z } from 'zod';
import { ollamaAvailable } from './ollama.js';
import { runClustering, type ProcessedReport } from './pipeline.js';
import { processReports } from './process.js';
import { syntheticReports } from './synthetic.js';

const PORT = Number(process.env.LOCAL_PORT) || 8787;
const DIR = process.env.LOCAL_DATA_DIR?.replace(/\/?$/, '/') ?? fileURLToPath(new URL('../.local-data/', import.meta.url));
const STATE_FILE = `${DIR}state.json`;
const PHOTO_DIR = `${DIR}photos/`;
mkdirSync(PHOTO_DIR, { recursive: true });

interface State {
  reports: ProcessedReport[];
  clusters: Cluster[];
}

let state: State = { reports: [], clusters: [] };
if (existsSync(STATE_FILE) && !process.argv.includes('--reset')) {
  state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State;
} else if (!process.argv.includes('--empty')) {
  state.reports = syntheticReports().map((r) => ({ ...r, embedding: null }));
}

const ai = (await ollamaAvailable()) ? 'ollama' : 'fallback';
let version = 0;
let dirty = true;
let busy = false;

function save() {
  writeFileSync(STATE_FILE, JSON.stringify(state));
}

async function tick() {
  if (busy || !dirty) return;
  busy = true;
  dirty = false;
  try {
    const fresh = state.reports.filter((r) => !r.processed_at);
    if (fresh.length) {
      console.log(`[local] processing ${fresh.length} new report(s) with ${ai === 'ollama' ? 'Ollama' : 'keyword fallback'}…`);
      const done = new Map((await processReports(fresh)).map((r) => [r.id, r]));
      state.reports = state.reports.map((r) => done.get(r.id) ?? r);
    }
    const members = new Map<string, string[]>();
    for (const r of state.reports) if (r.cluster_id) (members.get(r.cluster_id) ?? members.set(r.cluster_id, []).get(r.cluster_id)!).push(r.id);
    const { clusters, assignment, resummarised } = await runClustering(state.reports, state.clusters, members);
    state.reports = state.reports.map((r) => ({ ...r, cluster_id: assignment.get(r.id) ?? null }));
    state.clusters = clusters;
    version++;
    save();
    console.log(`[local] ${state.reports.length} reports → ${clusters.length} incident areas (${resummarised} re-summarised)`);
  } catch (e) {
    console.error('[local] pipeline error:', (e as Error).message);
    dirty = true;
  } finally {
    busy = false;
  }
}
setInterval(tick, 1500);

// ---- HTTP ---------------------------------------------------------------

const PostSchema = ReportInputSchema.extend({
  /** Up to 3 JPEGs as data URLs (base64). */
  photos: z.array(z.string().startsWith('data:image/')).max(3).optional(),
});

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json') {
  res.writeHead(status, {
    'content-type': type,
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(type === 'application/json' ? JSON.stringify(body) : (body as Buffer));
}

async function readJson(req: IncomingMessage, limit = 12_000_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new Error('body too large');
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function publicState(host: string): DemoData & { version: number } {
  return {
    generated_at: new Date().toISOString(),
    ai,
    version,
    clusters: state.clusters,
    reports: state.reports.map(({ embedding: _e, ...r }) => ({
      ...r,
      photo_paths: r.photo_paths.map((p) => (p.startsWith('local:') ? `http://${host}/photos/${p.slice(6)}` : p)),
    })),
  };
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (req.method === 'GET' && url.pathname === '/state') return send(res, 200, publicState(req.headers.host ?? `localhost:${PORT}`));
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, ai, reports: state.reports.length });

    if (req.method === 'GET' && url.pathname.startsWith('/photos/')) {
      const name = url.pathname.slice('/photos/'.length);
      if (!/^[\w-]+\.jpg$/.test(name) || !existsSync(PHOTO_DIR + name)) return send(res, 404, { error: 'not found' });
      return send(res, 200, readFileSync(PHOTO_DIR + name), 'image/jpeg');
    }

    if (req.method === 'POST' && url.pathname === '/reports') {
      const body = PostSchema.parse(await readJson(req));
      const existing = state.reports.find((r) => r.client_id === body.client_id);
      if (existing) return send(res, 200, { id: existing.id, duplicate: true }); // retry of a report we already have
      const id = randomUUID();
      const photo_paths = (body.photos ?? []).map((data, n) => {
        const name = `${id}-${n}.jpg`;
        writeFileSync(PHOTO_DIR + name, Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'));
        return `local:${name}`;
      });
      const { photos: _p, ...input } = body;
      state.reports.push({
        ...input,
        photo_paths,
        id,
        created_at: new Date().toISOString(),
        extracted: null,
        embedding: null,
        cluster_id: null,
        processed_at: null,
      });
      dirty = true;
      save();
      console.log(`[local] new report from phone: "${input.text.slice(0, 60)}"`);
      return send(res, 201, { id });
    }

    const m = url.pathname.match(/^\/clusters\/([\w-]+)$/);
    if (req.method === 'PATCH' && m) {
      const { status } = z.object({ status: z.enum(CLUSTER_STATUSES) }).parse(await readJson(req, 10_000));
      const c = state.clusters.find((x) => x.id === m[1]);
      if (!c) return send(res, 404, { error: 'no such cluster' });
      c.status = status as ClusterStatus;
      version++;
      save();
      return send(res, 200, c);
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 400, { error: (e as Error).message });
  }
}).listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address);
  console.log(`[local] CrisisPulse local server on http://localhost:${PORT}  (AI: ${ai})`);
  for (const ip of ips) console.log(`[local] phones on this Wi-Fi: set EXPO_PUBLIC_LOCAL_API=http://${ip}:${PORT} in apps/mobile/.env`);
});
