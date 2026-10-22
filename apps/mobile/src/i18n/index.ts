import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

void i18n.use(initReactI18next).init({
  compatibilityJSON: 'v4',
  fallbackLng: 'en',
  lng: 'en',
  interpolation: { escapeValue: false },
  resources: {
    en: { translation: { settings: 'Settings', appearance: 'Appearance', language: 'Language', system: 'System', light: 'Light', dark: 'Dark', english: 'English', hindi: 'Hindi', dataSaver: 'Data saver', dataSaverHint: 'Use a lower-bitrate video stream to reduce data use.', privacy: 'Private account', notifications: 'Push notifications', blocked: 'Blocked accounts', analytics: 'Creator analytics', exportData: 'Export my data', legal: 'Policies', terms: 'Terms of service', privacyPolicy: 'Privacy policy', guidelines: 'Community guidelines', deleteAccount: 'Delete account', signOut: 'Sign out', cancel: 'Cancel', save: 'Save', views: 'Views', likes: 'Likes', comments: 'Comments', followers: 'New followers' } },
    hi: { translation: { settings: 'सेटिंग्स', appearance: 'दिखावट', language: 'भाषा', system: 'सिस्टम', light: 'लाइट', dark: 'डार्क', english: 'अंग्रेज़ी', hindi: 'हिंदी', privacy: 'निजी अकाउंट', notifications: 'पुश नोटिफ़िकेशन', blocked: 'ब्लॉक किए गए अकाउंट', analytics: 'क्रिएटर एनालिटिक्स', exportData: 'मेरा डेटा निर्यात करें', legal: 'नीतियाँ', terms: 'सेवा की शर्तें', privacyPolicy: 'गोपनीयता नीति', guidelines: 'कम्युनिटी दिशानिर्देश', deleteAccount: 'अकाउंट हटाएँ', signOut: 'साइन आउट', cancel: 'रद्द करें', save: 'सेव करें', views: 'व्यूज़', likes: 'लाइक्स', comments: 'कमेंट्स', followers: 'नए फ़ॉलोअर्स' } },
  },
});

export default i18n;
