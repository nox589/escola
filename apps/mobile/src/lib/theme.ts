import { useColorScheme } from 'react-native';

const light = {
  bg: '#F7F5F0',
  card: '#FFFFFF',
  ink: '#1C2321',
  muted: '#6A726E',
  line: '#E4E0D8',
  accent: '#1F6B52',
  accentSoft: '#E3EFE9',
  warn: '#B4561E',
  warnSoft: '#FBEADF',
  danger: '#B3261E',
  dangerSoft: '#FBE4E2',
};
const dark: typeof light = {
  bg: '#121614',
  card: '#1B201E',
  ink: '#EEF1EF',
  muted: '#9AA39F',
  line: '#2B322F',
  accent: '#6CC3A0',
  accentSoft: '#1E3029',
  warn: '#F0A06B',
  warnSoft: '#3A2A1F',
  danger: '#F2B8B5',
  dangerSoft: '#3B1F1E',
};
export type Palette = typeof light;

export function useTheme(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

/** Default per-child colours (SPEC §11: colour per child). */
export const CHILD_COLOURS = ['#1F6B52', '#3D5BA9', '#B4561E', '#8A3D8F', '#2E7F94', '#9A7B12'];

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 };
export const radius = { s: 8, m: 12, l: 16 };
export const font = { title: 26, h2: 19, body: 16, small: 14, tiny: 12 };
