export const palette = {
  violet: '#0E9F95', pink: '#3978D4', orange: '#55C9BC', blue: '#3978D4',
  dark: { background: '#0A141C', surface: '#121F2A', surfaceRaised: '#1C2D39', text: '#F7FBFD', muted: '#A0B1BC', border: '#2A3E4B', accent: '#55C9BC', success: '#34D399', danger: '#F87171' },
  light: { background: '#F4F8FB', surface: '#FFFFFF', surfaceRaised: '#EAF1F5', text: '#183040', muted: '#627789', border: '#DAE5ED', accent: '#0E9F95', success: '#07866D', danger: '#B42318' },
} as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 10, md: 16, lg: 20, xl: 28, pill: 999 } as const;
export const typography = { caption: 12, bodySmall: 14, body: 16, title: 20, display: 28 } as const;
export type ThemeMode = 'system' | 'light' | 'dark';
