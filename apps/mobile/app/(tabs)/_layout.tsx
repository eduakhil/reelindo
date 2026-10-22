import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/useAppTheme';
import { AppIcon, type AppIconName } from '@/src/components/AppIcon';

const icons: Record<string, AppIconName> = { index: 'home', explore: 'search', reels: 'play', profile: 'profile' };
export default function TabLayout() {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  return <Tabs screenOptions={({ route }) => ({ headerShown: false, tabBarShowLabel: true, tabBarActiveTintColor: colors.text, tabBarInactiveTintColor: colors.muted, tabBarStyle: [styles.bar, { height: 58 + insets.bottom, paddingBottom: Math.max(insets.bottom, 6), backgroundColor: colors.surface, borderTopColor: colors.border }], tabBarLabelStyle: styles.label, tabBarIcon: ({ focused }) => route.name === 'create'
    ? <View style={[styles.create, focused && { backgroundColor: colors.accent }]}><AppIcon name="create" color="white" size={21} filled={focused} /></View>
    : <AppIcon name={icons[route.name] ?? 'home'} color={focused ? colors.text : colors.muted} filled={focused} size={23} /> })}>
    <Tabs.Screen name="index" options={{ title: 'Home' }} />
    <Tabs.Screen name="explore" options={{ title: 'Search' }} />
    <Tabs.Screen name="create" options={{ title: 'Create' }} />
    <Tabs.Screen name="reels" options={{ title: 'Reels' }} />
    <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    <Tabs.Screen name="inbox" options={{ href: null }} />
  </Tabs>;
}
const styles = StyleSheet.create({ bar: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 7 }, label: { fontSize: 11, fontWeight: '600', marginTop: 2 }, create: { backgroundColor: palette.violet, borderRadius: 12, width: 42, height: 30, alignItems: 'center', justifyContent: 'center' } });
