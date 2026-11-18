import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { C } from '@/lib/theme';

const TIPS: [string, string[]][] = [
  ['If you are trapped', [
    'Stay calm and move as little as possible to avoid raising dust.',
    'Cover your mouth with cloth. Tap on a pipe or wall so rescuers can hear you; shout only as a last resort.',
    'Send one report with "Me / my group" and the number of people trapped, then save your battery.',
  ]],
  ['Earthquake', [
    'Drop, cover and hold on until the shaking stops. Expect aftershocks.',
    'Stay away from damaged buildings, glass and power lines.',
    'If you smell gas, leave the building and do not use flames or switches.',
  ]],
  ['Flood and storm', [
    'Move to higher ground. Never walk or drive through moving water.',
    'Switch off electricity at the main if water is entering the house.',
  ]],
  ['Save your phone battery', [
    'Lower screen brightness, close other apps, use text instead of calls.',
    'Your reports are stored on the phone and sent automatically when signal returns.',
  ]],
];

export default function Safety() {
  return (
    <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }}>
      <View style={st.emergency}>
        <Text style={st.emergencyText}>Emergency numbers (India): 112 · Ambulance 108 · Fire 101 · NDRF 011-24363260</Text>
      </View>
      {TIPS.map(([title, items]) => (
        <View key={title} style={st.card}>
          <Text style={st.title}>{title}</Text>
          {items.map((t) => (
            <Text key={t} style={st.item}>• {t}</Text>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  emergency: { backgroundColor: C.redSoft, borderRadius: 12, padding: 12 },
  emergencyText: { color: C.red, fontWeight: '700', fontSize: 15 },
  card: { backgroundColor: C.card, borderRadius: 12, padding: 14, gap: 6, borderWidth: 1, borderColor: C.line },
  title: { fontSize: 17, fontWeight: '700', color: C.text },
  item: { fontSize: 15, color: C.text, lineHeight: 21 },
});
