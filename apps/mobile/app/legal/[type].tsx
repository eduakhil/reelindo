import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '@/src/components/Screen';

const policies: Record<string, { title: string; sections: Array<[string, string]> }> = {
  terms: { title: 'Terms of Service', sections: [
    ['Using Reelindo', 'You must be at least 16 years old. Keep your account credentials secure and provide accurate account information. You are responsible for activity on your account.'],
    ['Content and rights', 'You retain ownership of content you create. You grant Reelindo permission to host, process, display, and distribute that content as needed to operate the service. Only upload content and audio that you own or are authorized to use.'],
    ['Community safety', 'Do not post unlawful, abusive, threatening, sexually exploitative, or infringing material. Reelindo may restrict or remove content and accounts that violate these rules. Use in-app reporting to raise a concern.'],
    ['Availability and changes', 'Features may change as Reelindo develops. We may suspend access when needed to protect users, comply with law, or maintain the service.'],
  ] },
  privacy: { title: 'Privacy Policy', sections: [
    ['Information collected', 'Reelindo stores account details, profile information, posts, stories, messages, follows, likes, comments, reports, and usage analytics needed to provide the app. Passwords are stored as hashes. Push notification tokens are stored when you enable push notifications.'],
    ['How information is used', 'Information is used to operate feeds, profiles, messaging, moderation, analytics, security, and notifications. Content visibility depends on your account and post privacy settings.'],
    ['Service providers', 'Media may be stored in the configured S3-compatible object storage. Push notifications are sent through Expo when enabled. Hosting and database providers used by a deployment may process service data.'],
    ['Your controls', 'You can change privacy and notification settings, block accounts, export account data, and request account deletion in Settings. Deleting your account removes related database records and stored media when object storage is configured.'],
  ] },
  community: { title: 'Community Guidelines', sections: [
    ['Respect people', 'Do not harass, threaten, bully, or target people with hate or abuse.'],
    ['Share responsibly', 'Post only content you have rights to share. Do not upload exploitative, dangerous, deceptive, or illegal material.'],
    ['Keep the community safe', 'Use block and report tools when needed. Repeated violations may lead to content removal or account suspension.'],
    ['Age requirement', 'Reelindo is for people aged 16 and older.'],
  ] },
};

export default function LegalScreen() {
  const { type } = useLocalSearchParams<{ type: string }>(); const policy = policies[type] ?? policies.terms!;
  return <Screen style={styles.page}><View style={styles.header}><Text onPress={() => router.back()} style={styles.back}>‹</Text><Text style={styles.title}>{policy.title}</Text><View style={{ width: 32 }} /></View><ScrollView contentContainerStyle={styles.content}>{policy.sections.map(([heading, body]) => <View key={heading} style={styles.section}><Text style={styles.heading}>{heading}</Text><Text style={styles.body}>{body}</Text></View>)}<Text style={styles.draft}>Policy text should be reviewed and updated to match the service’s final operating company, contact method, retention practices, and applicable laws before public release.</Text></ScrollView></Screen>;
}
const styles = StyleSheet.create({ page: { paddingHorizontal: 18 }, header: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, back: { width: 32, fontSize: 30, color: '#0E9F95' }, title: { color: '#183040', fontSize: 20, fontWeight: '800' }, content: { paddingBottom: 30, gap: 20 }, section: { gap: 8 }, heading: { color: '#183040', fontSize: 16, fontWeight: '800' }, body: { color: '#C2BEC9', lineHeight: 22 }, draft: { color: '#627789', fontSize: 12, lineHeight: 18, marginTop: 10 } });
