import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Image } from 'expo-image';
import { Link, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { DISASTER_TYPES, LABELS, NEEDS, type DisasterType, type Need } from '@dw/shared';
import { Card, Chip, Stepper, s as ui } from '@/components/ui';
import { enqueue, newClientId, useOutbox } from '@/lib/outbox';
import { LIVE } from '@/lib/supabase';
import { C } from '@/lib/theme';

type Fix = { lat: number; lng: number; accuracy: number | null; at: number };

const TYPE_ICONS: Record<DisasterType, string> = {
  earthquake: '🌍', flood: '🌊', storm: '🌀', tornado: '🌪️', fire: '🔥', landslide: '⛰️', tsunami: '🌊', other: '⚠️',
};

function useLocation() {
  const [fix, setFix] = useState<Fix | null>(null);
  const [state, setState] = useState<'idle' | 'locating' | 'denied' | 'error'>('idle');
  const locate = useCallback(async () => {
    setState('locating');
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') return setState('denied');
      // Show the last known position instantly, then refine with a fresh GPS fix.
      const last = await Location.getLastKnownPositionAsync();
      if (last) setFix({ lat: last.coords.latitude, lng: last.coords.longitude, accuracy: last.coords.accuracy, at: last.timestamp });
      const cur = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setFix({ lat: cur.coords.latitude, lng: cur.coords.longitude, accuracy: cur.coords.accuracy, at: cur.timestamp });
      setState('idle');
    } catch {
      setState('error');
    }
  }, []);
  useEffect(() => {
    void locate();
  }, [locate]);
  return { fix, state, locate };
}

async function compress(uri: string): Promise<string> {
  const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1280 } }], {
    compress: 0.6,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return out.uri;
}

export default function SendReport() {
  const { fix, state, locate } = useLocation();
  const outbox = useOutbox();
  const [about, setAbout] = useState<'self' | 'others'>('self');
  const [type, setType] = useState<DisasterType>('earthquake');
  const [text, setText] = useState('');
  const [people, setPeople] = useState(1);
  const [trapped, setTrapped] = useState(0);
  const [children, setChildren] = useState(false);
  const [injured, setInjured] = useState(0);
  const [needs, setNeeds] = useState<Need[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const waiting = outbox.filter((i) => i.status !== 'sent').length;

  const addPhoto = async (camera: boolean) => {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8 };
    if (camera) {
      const p = await ImagePicker.requestCameraPermissionsAsync();
      if (!p.granted) return Alert.alert('Camera permission needed');
    }
    const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets[0]) return;
    setPhotos((p) => [...p, res.assets[0].uri].slice(0, 3));
  };

  const reset = () => {
    setText('');
    setPeople(1);
    setTrapped(0);
    setChildren(false);
    setInjured(0);
    setNeeds([]);
    setPhotos([]);
  };

  const send = async () => {
    if (!fix) return Alert.alert('Location needed', 'We need your location so rescuers can find you. Tap "Locate me".');
    if (!text.trim() && about === 'others') return Alert.alert('Describe what you see', 'A few words help responders a lot.');
    setBusy(true);
    try {
      const local = await Promise.all(photos.map(compress));
      const self = about === 'self';
      await enqueue(
        {
          client_id: newClientId(),
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
        local,
      );
      reset();
      Alert.alert(
        LIVE ? 'Report saved' : 'Saved on this phone',
        LIVE
          ? 'It is being sent now. If there is no signal it will be sent automatically when there is.'
          : 'This build is not connected to a server, so the report stays on the phone.',
        [{ text: 'OK' }, { text: 'My reports', onPress: () => router.push('/reports') }],
      );
    } finally {
      setBusy(false);
    }
  };

  const toggleNeed = (n: Need) => setNeeds((xs) => (xs.includes(n) ? xs.filter((x) => x !== n) : [...xs, n]));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={st.page} keyboardShouldPersistTaps="handled">
        {waiting > 0 && (
          <Link href="/reports" asChild>
            <Pressable style={st.banner}>
              <Text style={st.bannerText}>
                {waiting} report{waiting > 1 ? 's' : ''} waiting to send · will retry automatically
              </Text>
            </Pressable>
          </Link>
        )}

        <Card title="Your location">
          {fix ? (
            <View style={st.locRow}>
              <Text style={st.locText}>
                📍 {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}
              </Text>
              {fix.accuracy != null && (
                <Text style={[st.acc, fix.accuracy > 100 && { color: C.red }]}>±{Math.round(fix.accuracy)} m</Text>
              )}
            </View>
          ) : (
            <Text style={st.muted}>
              {state === 'denied' ? 'Location permission denied. Enable it in Settings.' : state === 'error' ? 'Could not get location.' : 'Finding you…'}
            </Text>
          )}
          <Pressable style={st.secondary} onPress={locate} disabled={state === 'locating'}>
            {state === 'locating' ? <ActivityIndicator /> : <Text style={st.secondaryText}>{fix ? 'Update location' : 'Locate me'}</Text>}
          </Pressable>
        </Card>

        <Card title="Who is this about?">
          <View style={st.seg}>
            {(['self', 'others'] as const).map((a) => (
              <Pressable key={a} style={[st.segBtn, about === a && st.segOn]} onPress={() => setAbout(a)}>
                <Text style={[st.segText, about === a && st.segTextOn]}>{a === 'self' ? 'Me / my group' : 'Others I can see'}</Text>
              </Pressable>
            ))}
          </View>
        </Card>

        <Card title="What happened?">
          <View style={ui.row}>
            {DISASTER_TYPES.map((t) => (
              <Chip key={t} label={`${TYPE_ICONS[t]} ${LABELS[t]}`} on={type === t} onPress={() => setType(t)} />
            ))}
          </View>
          <TextInput
            style={st.input}
            multiline
            placeholder={
              about === 'self'
                ? 'e.g. We are on the 2nd floor, stairs collapsed, my mother is hurt'
                : 'e.g. Building collapsed, about 6 people trapped, kids from the daycare missing'
            }
            placeholderTextColor="#98a1ad"
            value={text}
            onChangeText={setText}
            maxLength={4000}
          />
        </Card>

        {about === 'self' ? (
          <Card title="About you and your group">
            <Stepper label="People with you (incl. you)" value={people} onChange={(n) => setPeople(Math.max(1, n))} />
            <Stepper label="Trapped / can't get out" value={trapped} onChange={setTrapped} tone={C.red} />
            <Stepper label="Injured" value={injured} onChange={setInjured} tone={C.amber} />
            <View style={ui.stepRow}>
              <Text style={ui.stepLabel}>Children with you?</Text>
              <Chip label="No" on={!children} onPress={() => setChildren(false)} />
              <Chip label="Yes" on={children} onPress={() => setChildren(true)} tone="red" />
            </View>
          </Card>
        ) : (
          <Text style={st.tip}>Tip: mention how many people you see trapped or injured, and whether children are there.</Text>
        )}

        <Card title="What is needed?">
          <View style={ui.row}>
            {NEEDS.map((n) => (
              <Chip key={n} label={LABELS[n]} on={needs.includes(n)} onPress={() => toggleNeed(n)} tone={n === 'rescue' || n === 'medical' ? 'red' : 'blue'} />
            ))}
          </View>
        </Card>

        <Card title="Photos" hint="Up to 3. Compressed to save data.">
          <View style={ui.row}>
            {photos.map((p) => (
              <Pressable key={p} onLongPress={() => setPhotos((xs) => xs.filter((x) => x !== p))}>
                <Image source={{ uri: p }} style={st.thumb} />
              </Pressable>
            ))}
          </View>
          {photos.length < 3 && (
            <View style={ui.row}>
              <Pressable style={st.secondary} onPress={() => addPhoto(true)}>
                <Text style={st.secondaryText}>📷 Camera</Text>
              </Pressable>
              <Pressable style={st.secondary} onPress={() => addPhoto(false)}>
                <Text style={st.secondaryText}>🖼️ Gallery</Text>
              </Pressable>
            </View>
          )}
        </Card>

        <Pressable style={[st.send, (busy || !fix) && { opacity: 0.6 }]} onPress={send} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.sendText}>Send report</Text>}
        </Pressable>
        <Link href="/safety" style={st.link}>
          Safety tips while you wait →
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  page: { padding: 14, gap: 12, paddingBottom: 48 },
  banner: { backgroundColor: '#fff4d6', borderColor: '#f0d58a', borderWidth: 1, borderRadius: 10, padding: 10 },
  bannerText: { color: '#7a5600', fontWeight: '600' },
  locRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  locText: { fontSize: 16, fontWeight: '600', color: C.text, fontVariant: ['tabular-nums'] },
  acc: { fontSize: 14, color: C.green, fontWeight: '600' },
  muted: { color: C.muted, fontSize: 15 },
  secondary: { backgroundColor: C.blueSoft, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 16, alignItems: 'center' },
  secondaryText: { color: C.blue, fontWeight: '700', fontSize: 15 },
  seg: { flexDirection: 'row', backgroundColor: C.bg, borderRadius: 12, padding: 4 },
  segBtn: { flex: 1, paddingVertical: 12, borderRadius: 9, alignItems: 'center' },
  segOn: { backgroundColor: C.card, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  segText: { fontSize: 15, fontWeight: '600', color: C.muted },
  segTextOn: { color: C.text },
  input: { minHeight: 96, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, fontSize: 16, color: C.text, textAlignVertical: 'top' },
  tip: { color: C.muted, fontSize: 14, paddingHorizontal: 4 },
  thumb: { width: 84, height: 84, borderRadius: 10 },
  send: { backgroundColor: C.red, borderRadius: 14, paddingVertical: 18, alignItems: 'center', marginTop: 4 },
  sendText: { color: '#fff', fontSize: 19, fontWeight: '800' },
  link: { color: C.blue, textAlign: 'center', fontSize: 15, fontWeight: '600', paddingVertical: 8 },
});
