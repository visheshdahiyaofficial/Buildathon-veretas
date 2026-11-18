import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { C } from '@/lib/theme';

export function Card({ title, hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  return (
    <View style={s.card}>
      {title && <Text style={s.title}>{title}</Text>}
      {hint && <Text style={s.hint}>{hint}</Text>}
      {children}
    </View>
  );
}

export function Chip({ label, on, onPress, tone = 'blue' }: { label: string; on: boolean; onPress: () => void; tone?: 'blue' | 'red' }) {
  const color = tone === 'red' ? C.red : C.blue;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={[s.chip, on && { backgroundColor: color, borderColor: color }]}
    >
      <Text style={[s.chipText, on && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

export function Stepper({ label, value, onChange, tone }: { label: string; value: number; onChange: (n: number) => void; tone?: string }) {
  return (
    <View style={s.stepRow}>
      <Text style={[s.stepLabel, value > 0 && tone ? { color: tone } : null]}>{label}</Text>
      <Pressable style={s.stepBtn} onPress={() => onChange(Math.max(0, value - 1))} accessibilityLabel={`Decrease ${label}`}>
        <Text style={s.stepBtnText}>−</Text>
      </Pressable>
      <Text style={s.stepValue}>{value}</Text>
      <Pressable style={s.stepBtn} onPress={() => onChange(value + 1)} accessibilityLabel={`Increase ${label}`}>
        <Text style={s.stepBtnText}>+</Text>
      </Pressable>
    </View>
  );
}

export const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, borderColor: C.line },
  title: { fontSize: 17, fontWeight: '700', color: C.text },
  hint: { fontSize: 13, color: C.muted, marginTop: -6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 99, borderWidth: 1.5, borderColor: C.line, backgroundColor: '#fff' },
  chipText: { fontSize: 15, fontWeight: '600', color: C.text },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepLabel: { flex: 1, fontSize: 16, color: C.text, fontWeight: '500' },
  stepBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { fontSize: 24, fontWeight: '600', color: C.text, marginTop: -2 },
  stepValue: { width: 36, textAlign: 'center', fontSize: 20, fontWeight: '700', color: C.text },
});
