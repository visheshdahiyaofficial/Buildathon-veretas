import 'dotenv/config';

const num = (key: string, fallback: number) => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && process.env[key] !== '' ? v : fallback;
};

export const config = {
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
  chatModel: process.env.OLLAMA_CHAT_MODEL || 'qwen2.5:7b-instruct',
  embedModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
  epsMeters: num('CLUSTER_EPS_M', 500),
  minPoints: num('CLUSTER_MIN_POINTS', 3),
  pollSeconds: num('POLL_SECONDS', 15),
  windowHours: num('WINDOW_HOURS', 72),
};
