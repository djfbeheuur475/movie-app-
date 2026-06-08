export const COLORS = {
  // Brand
  lemon: '#FFE135',
  amber: '#F59E0B',
  amberDark: '#D97706',
  amberLight: '#FDE68A',

  // Environment
  sky: '#7DD3FC',
  skyDeep: '#0EA5E9',
  sand: '#FEF08A',
  ocean: '#06B6D4',
  teal: '#14B8A6',

  // UI
  primary: '#F59E0B',
  primaryDark: '#D97706',
  success: '#22C55E',
  successDark: '#16A34A',
  danger: '#EF4444',
  dangerDark: '#DC2626',
  warning: '#F97316',
  info: '#0EA5E9',

  // Surfaces
  white: '#FFFFFF',
  cream: '#FFFBEB',
  creamDark: '#FEF3C7',
  card: '#FFFFFF',
  overlay: 'rgba(28,25,23,0.6)',

  // Text
  textDark: '#1C1917',
  textMid: '#57534E',
  textLight: '#A8A29E',
  textMuted: '#D6D3D1',

  // Weather background gradients
  heatwave: ['#FF6B35', '#F59E0B'] as string[],
  sunny: ['#FCD34D', '#F59E0B'] as string[],
  perfect: ['#BAE6FD', '#A7F3D0'] as string[],
  cloudy: ['#94A3B8', '#CBD5E1'] as string[],
  light_rain: ['#93C5FD', '#60A5FA'] as string[],
  storm: ['#475569', '#334155'] as string[],
};

export const FONT_SIZE = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 22,
  xxl: 28,
  xxxl: 38,
};

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const SHADOW = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 8,
  },
};
