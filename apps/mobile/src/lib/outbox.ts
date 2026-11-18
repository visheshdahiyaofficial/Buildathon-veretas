/**
 * Offline-first outbox. In a disaster, signal comes and goes, so every report
 * is saved on the phone first and sent when possible. Each report carries a
 * client_id; the server has unique(user_id, client_id), so retries can never
 * create duplicates.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useSyncExternalStore } from 'react';
import type { ReportInput } from '@dw/shared';
import { ensureUserId, LIVE, supabase } from './supabase';

export type OutboxStatus = 'queued' | 'sending' | 'sent' | 'failed';

export interface OutboxItem {
  input: ReportInput;
  localPhotos: string[];
  status: OutboxStatus;
  attempts: number;
  error?: string;
  sentAt?: string;
}

const KEY = 'crisispulse.outbox.v1';
let items: OutboxItem[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  items = [...items];
  listeners.forEach((l) => l());
  AsyncStorage.setItem(KEY, JSON.stringify(items)).catch(() => {});
}

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      // Anything left "sending" when the app was killed goes back in the queue.
      items = (JSON.parse(raw) as OutboxItem[]).map((i) => (i.status === 'sending' ? { ...i, status: 'queued' } : i));
      emit();
    }
  } catch {
    // corrupt storage: start empty
  }
}

export function newClientId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
}

export async function enqueue(input: ReportInput, localPhotos: string[]) {
  await load();
  items = [{ input, localPhotos, status: 'queued', attempts: 0 }, ...items];
  emit();
  void flush();
}

async function uploadPhoto(userId: string, clientId: string, uri: string, n: number): Promise<string> {
  const path = `${userId}/${clientId}/${n}.jpg`;
  const body = await (await fetch(uri)).arrayBuffer();
  const { error } = await supabase!.storage.from('report-photos').upload(path, body, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  return path;
}

async function sendOne(item: OutboxItem): Promise<void> {
  const userId = await ensureUserId();
  const photo_paths: string[] = [];
  for (let n = 0; n < item.localPhotos.length; n++) {
    photo_paths.push(await uploadPhoto(userId, item.input.client_id, item.localPhotos[n], n));
  }
  const { error } = await supabase!
    .from('reports')
    .upsert({ ...item.input, photo_paths, user_id: userId }, { onConflict: 'user_id,client_id', ignoreDuplicates: true });
  if (error) throw error;
}

let flushing: Promise<void> | null = null;

/** Try to send everything that is waiting. Safe to call often. */
export function flush(): Promise<void> {
  flushing ??= (async () => {
    try {
      await load();
      if (!LIVE) return;
      const net = await NetInfo.fetch();
      if (net.isConnected === false) return;
      for (const item of items.filter((i) => i.status === 'queued' || i.status === 'failed')) {
        item.status = 'sending';
        item.attempts++;
        emit();
        try {
          await sendOne(item);
          item.status = 'sent';
          item.sentAt = new Date().toISOString();
          item.error = undefined;
        } catch (e) {
          item.status = 'failed';
          item.error = (e as Error).message;
        }
        emit();
      }
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

function subscribe(l: () => void) {
  listeners.add(l);
  void load();
  return () => listeners.delete(l);
}

export function useOutbox(): OutboxItem[] {
  return useSyncExternalStore(subscribe, () => items);
}

/** Mount once: retries when the network comes back, and every 30 s. */
export function useAutoFlush() {
  useEffect(() => {
    void flush();
    const unsub = NetInfo.addEventListener((s) => {
      if (s.isConnected) void flush();
    });
    const t = setInterval(() => void flush(), 30_000);
    return () => {
      unsub();
      clearInterval(t);
    };
  }, []);
}
