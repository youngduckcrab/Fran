import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import type { ThemeId } from '@fran/shared';

/**
 * 색. web/src/styles.css 의 규칙을 그대로 따른다 — 색 두 개(c1, c2)로 나머지를 섞어 만든다.
 * 테마를 하나 더하거나 고쳐도 여기 한 곳만 바꾸면 된다.
 */
const BASE: Record<ThemeId, [string, string]> = {
  rose: ['#ff9ec0', '#b18bff'],
  ocean: ['#6fc9ff', '#7b83ff'],
  forest: ['#74d8ac', '#4bb4c8'],
  sunset: ['#ffb473', '#ff7f92'],
  lilac: ['#c9a0ff', '#8a92ff'],
  mono: ['#a8adbe', '#858ba1'],
};

export const THEME_COLORS = BASE;

type Rgb = [number, number, number];

function parse(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex([r, g, b]: Rgb): string {
  const part = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** a 를 amount(0~1) 만큼, 나머지는 b. CSS 의 color-mix(in srgb, a amount, b) 와 같다. */
export function mix(a: string, b: string, amount: number): string {
  const x = parse(a);
  const y = parse(b);
  return toHex([
    x[0] * amount + y[0] * (1 - amount),
    x[1] * amount + y[1] * (1 - amount),
    x[2] * amount + y[2] * (1 - amount),
  ]);
}

export function alpha(hex: string, a: number): string {
  const [r, g, b] = parse(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export interface Palette {
  dark: boolean;
  c1: string;
  c2: string;
  bg: string;
  surface: string;
  surfaceRaised: string;
  text: string;
  textMuted: string;
  border: string;
  accent: string;
  accent2: string;
  accentSoft: string;
  /** 진한 배경 위 글자색. 그라디언트 단추 위에 쓴다. */
  onAccent: string;
  danger: string;
  ok: string;
}

export function makePalette(theme: ThemeId, dark: boolean): Palette {
  const [c1, c2] = BASE[theme];
  if (dark) {
    const surface = mix(c2, '#1e1a26', 0.09);
    const text = mix(c1, '#f4eff7', 0.08);
    return {
      dark,
      c1,
      c2,
      bg: mix(c2, '#14111a', 0.1),
      surface,
      surfaceRaised: mix(c1, surface, 0.12),
      text,
      textMuted: alpha(text, 0.62),
      border: mix(c2, surface, 0.22),
      accent: c1,
      accent2: c2,
      accentSoft: mix(c1, surface, 0.22),
      onAccent: '#2a1a33',
      danger: '#ff7a90',
      ok: '#7fd1b9',
    };
  }
  const text = mix(c2, '#2f2a35', 0.2);
  return {
    dark,
    c1,
    c2,
    bg: mix(c1, '#ffffff', 0.07),
    surface: '#ffffff',
    surfaceRaised: mix(c1, '#ffffff', 0.12),
    text,
    textMuted: alpha(text, 0.55),
    border: mix(c1, '#ffffff', 0.22),
    accent: c1,
    accent2: c2,
    accentSoft: mix(c1, '#ffffff', 0.2),
    onAccent: '#2a1a33',
    danger: '#e0455e',
    ok: '#2f9c80',
  };
}

const PaletteContext = createContext<Palette>(makePalette('rose', true));

export function PaletteProvider({ theme, children }: { theme: ThemeId; children: ReactNode }) {
  const scheme = useColorScheme();
  const palette = useMemo(() => makePalette(theme, scheme !== 'light'), [theme, scheme]);
  return <PaletteContext.Provider value={palette}>{children}</PaletteContext.Provider>;
}

export const usePalette = (): Palette => useContext(PaletteContext);

export const RADIUS = 22;
export const RADIUS_SM = 14;
