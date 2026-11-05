/** MiCole palette (light, warm ivory). The brand is light-only for now. */
const light = {
  bg: '#FAF7F0', // warm ivory
  card: '#FFFFFF',
  ink: '#203B39', // dark ink
  muted: '#637773', // muted slate (use on white; ivory text uses mutedOnBg)
  mutedOnBg: '#4E625F',
  line: '#DCE3DE', // light stone
  accent: '#005451', // deep teal
  accentPressed: '#00423F',
  accentSoft: '#E5EEEA', // soft sage
  lime: '#C0CF58', // fresh lime, with dark ink text
  success: '#287352',
  warn: '#946000',
  warnSoft: '#F3E3C2',
  danger: '#B44343',
  dangerSoft: '#F6E1E1',
};
export type Palette = typeof light;

export function useTheme(): Palette {
  return light;
}

/** Default per-child colours: teal and lime first (distinct in lightness), then calm extras. */
export const CHILD_COLOURS = ['#005451', '#C0CF58', '#946000', '#3D5BA9', '#8A3D8F', '#2E7F94'];
/** Text colour that reads on a child colour swatch. */
export const onColour = (hex: string | null | undefined) => (hex && ['#C0CF58'].includes(hex.toUpperCase()) ? '#203B39' : '#FFFFFF');

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 20, xxl: 32 };
export const radius = { s: 10, m: 12, l: 16 };
export const font = { title: 26, h2: 20, body: 16, small: 14, tiny: 12 };
