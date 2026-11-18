import { defineConfig } from 'vitest/config';

// Tests are deterministic: point at a closed port so the offline fallback is always used.
export default defineConfig({ test: { env: { OLLAMA_URL: 'http://127.0.0.1:9' } } });
