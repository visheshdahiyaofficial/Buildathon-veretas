import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { LABELS } from '@dw/shared';
import { flush, useOutbox, type OutboxItem } from '@/lib/outbox';
import { CONNECTED as LIVE } from '@/lib/supabase';
import { C } from '@/lib/theme';

const STATUS: Record<OutboxItem['status'], { label: string; color: string; bg: string }> = {
  queued: { label: 'Waiting for signal', color: '#7a5600', bg: '#fff4d6' },
  sending: { label: 'Sending…', color: C.blue, bg: C.blueSoft },
  sent: { label: 'Sent ✓', color: C.green, bg: C.greenSoft },
  failed: { label: 'Will retry', color: C.red, bg: C.redSoft },
};

export default function Reports() {
  const items = useOutbox();
  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.input.client_id}
      contentContainerStyle={{ padding: 14, gap: 10 }}
      ListHeaderComponent={
        <View style={{ gap: 10 }}>
          {!LIVE && <Text style={st.note}>Demo build: not connected to a server, reports stay on this phone.</Text>}
          {items.some((i) => i.status !== 'sent') && LIVE && (
            <Pressable style={st.retry} onPress={() => flush()}>
              <Text style={st.retryText}>Try sending now</Text>
            </Pressable>
          )}
        </View>
      }
      ListEmptyComponent={<Text style={st.empty}>No reports yet.</Text>}
      renderItem={({ item }) => {
        const s = STATUS[item.status];
        const r = item.input;
        return (
          <View style={st.card}>
            <View style={st.head}>
              <Text style={st.type}>{LABELS[r.disaster_type]}</Text>
              <Text style={st.time}>{new Date(r.reported_at).toLocaleString()}</Text>
            </View>
            {!!r.text && <Text style={st.text}>{r.text}</Text>}
            <Text style={st.meta}>
              {r.about === 'self' ? 'About me / my group' : 'Witness report'}
              {r.trapped_count > 0 ? ` · ${r.trapped_count} trapped` : ''}
              {r.has_children ? ' · children' : ''}
              {r.injured_count > 0 ? ` · ${r.injured_count} injured` : ''}
              {item.localPhotos.length ? ` · ${item.localPhotos.length} photo(s)` : ''}
            </Text>
            <View style={[st.badge, { backgroundColor: s.bg }]}>
              <Text style={{ color: s.color, fontWeight: '700' }}>{LIVE ? s.label : 'Saved on phone'}</Text>
            </View>
            {item.status === 'failed' && item.error && <Text style={st.err}>{item.error}</Text>}
          </View>
        );
      }}
    />
  );
}

const st = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 12, padding: 12, gap: 6, borderWidth: 1, borderColor: C.line },
  head: { flexDirection: 'row', justifyContent: 'space-between' },
  type: { fontWeight: '700', fontSize: 15, color: C.text },
  time: { color: C.muted, fontSize: 13 },
  text: { fontSize: 15, color: C.text },
  meta: { fontSize: 13, color: C.muted },
  badge: { alignSelf: 'flex-start', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  err: { color: C.red, fontSize: 12 },
  empty: { textAlign: 'center', color: C.muted, marginTop: 40 },
  note: { backgroundColor: C.blueSoft, color: C.blue, padding: 10, borderRadius: 10 },
  retry: { backgroundColor: C.blue, borderRadius: 10, padding: 12, alignItems: 'center' },
  retryText: { color: '#fff', fontWeight: '700' },
});
