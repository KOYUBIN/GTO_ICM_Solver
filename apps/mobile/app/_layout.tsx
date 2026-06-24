import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { theme } from '../theme';

export default function Layout() {
  return (
    <>
      <StatusBar style="light" />
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: theme.elevated },
          headerTintColor: theme.text,
          tabBarStyle: { backgroundColor: theme.elevated, borderTopColor: theme.border },
          tabBarActiveTintColor: theme.accent,
          tabBarInactiveTintColor: theme.dim,
          sceneStyle: { backgroundColor: theme.bg },
        }}
      >
        <Tabs.Screen name="index" options={{ title: '에쿼티', tabBarLabel: '에쿼티' }} />
        <Tabs.Screen name="ranges" options={{ title: '레인지', tabBarLabel: '레인지' }} />
        <Tabs.Screen name="icm" options={{ title: 'ICM', tabBarLabel: 'ICM' }} />
        <Tabs.Screen name="play" options={{ title: '홀덤', tabBarLabel: '홀덤' }} />
        <Tabs.Screen name="community" options={{ title: '커뮤니티', tabBarLabel: '커뮤니티' }} />
      </Tabs>
    </>
  );
}
