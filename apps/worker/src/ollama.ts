import { config } from './config.js';

let availability: Promise<boolean> | null = null;

/** True when Ollama is running and both models are pulled. Checked once per process. */
export function ollamaAvailable(): Promise<boolean> {
  availability ??= (async () => {
    try {
      const res = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return false;
      const { models } = (await res.json()) as { models: { name: string }[] };
      const names = models.map((m) => m.name);
      const has = (want: string) => names.some((n) => n === want || n === `${want}:latest`);
      const ok = has(config.chatModel) && has(config.embedModel);
      if (!ok) {
        console.warn(
          `[ollama] running, but missing models. Run: ollama pull ${config.chatModel} && ollama pull ${config.embedModel}`,
        );
      }
      return ok;
    } catch {
      return false;
    }
  })();
  return availability;
}

/** Ask the chat model for JSON matching `schema`. Returns the parsed object (unvalidated). */
export async function chatJson(system: string, user: string, schema: object, timeoutMs = 120_000): Promise<unknown> {
  const res = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: config.chatModel,
      stream: false,
      format: schema,
      options: { temperature: 0.1 },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`ollama chat ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { message: { content: string } };
  return JSON.parse(body.message.content);
}

/** Embed many texts in one call. */
export async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${config.ollamaUrl}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(120_000),
    // nomic-embed-text expects a task prefix.
    body: JSON.stringify({ model: config.embedModel, input: texts.map((t) => `clustering: ${t}`) }),
  });
  if (!res.ok) throw new Error(`ollama embed ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { embeddings: number[][] };
  return body.embeddings;
}
