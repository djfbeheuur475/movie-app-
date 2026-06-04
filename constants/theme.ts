export const Colors = {
  background: '#0a0a0a',
  surface: '#141414',
  surfaceElevated: '#1f1f1f',
  border: '#2a2a2a',
  primary: '#e50914',
  primaryDark: '#b20710',
  accent: '#f5c518',
  text: '#ffffff',
  textSecondary: '#a3a3a3',
  textMuted: '#666666',
  success: '#46d369',
  warning: '#f59e0b',
  error: '#ef4444',
  overlay: 'rgba(0,0,0,0.7)',
  gradientStart: 'rgba(10,10,10,0)',
  gradientEnd: 'rgba(10,10,10,1)',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const Typography = {
  hero: { fontSize: 32, fontWeight: '800' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '700' as const },
  heading: { fontSize: 18, fontWeight: '700' as const },
  subheading: { fontSize: 16, fontWeight: '600' as const },
  body: { fontSize: 14, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
  label: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.5 },
};

export const BorderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
};

export const Shadow = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 12,
  },
};
