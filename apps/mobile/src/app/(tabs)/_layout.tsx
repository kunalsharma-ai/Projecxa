import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

/** Bottom tabs for staff. A tab disappears the moment Super Admin switches its feature off. */
export default function TabsLayout() {
  const { c } = useTheme();
  const { access } = useSession();
  const insets = useSafeAreaInsets();
  const show = (key: string) => (access.allowed.has(key) ? undefined : null);
  const icon = (name: React.ComponentProps<typeof Feather>['name']) => ({ color, size }: { color: ColorValue; size: number }) => <Feather name={name} color={color as string} size={size - 2} />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.faint,
        tabBarStyle: { backgroundColor: c.tabBar, borderTopColor: c.border, height: 62 + insets.bottom, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: c.bg[0] },
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: icon('home'), href: show('dashboard') }} />
      <Tabs.Screen name="projects" options={{ title: 'Projects', tabBarIcon: icon('folder'), href: show('projects') }} />
      <Tabs.Screen name="monitor" options={{ title: 'Fieldwork', tabBarIcon: icon('activity'), href: show('monitor') }} />
      <Tabs.Screen name="copilot" options={{ title: 'Copilot', tabBarIcon: icon('zap'), href: show('copilot') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('grid') }} />
    </Tabs>
  );
}
