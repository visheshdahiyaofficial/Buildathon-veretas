import { Link, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, Text } from 'react-native';
import { useAutoFlush } from '@/lib/outbox';
import { C } from '@/lib/theme';

export default function Layout() {
  useAutoFlush();
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: C.card },
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: C.bg },
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            title: 'CrisisPulse',
            headerRight: () => (
              <Link href="/reports" asChild>
                <Pressable hitSlop={12}>
                  <Text style={{ color: C.blue, fontSize: 16, fontWeight: '600' }}>My reports</Text>
                </Pressable>
              </Link>
            ),
          }}
        />
        <Stack.Screen name="reports" options={{ title: 'My reports' }} />
        <Stack.Screen name="safety" options={{ title: 'Stay safe' }} />
      </Stack>
    </>
  );
}
