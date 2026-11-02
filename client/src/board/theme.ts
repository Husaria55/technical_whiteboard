import { INK, type Theme } from './types';

export interface ThemeColors {
  background: string;
  ink: string;
  gridMinor: string;
  gridMajor: string;
  selection: string;
}

export const THEMES: Record<Theme, ThemeColors> = {
  light: {
    background: '#ffffff',
    ink: '#1b1b1f',
    gridMinor: 'rgba(30, 60, 120, 0.10)',
    gridMajor: 'rgba(30, 60, 120, 0.22)',
    selection: '#2f6fed',
  },
  dark: {
    background: '#1d1f23',
    ink: '#f2f2f0',
    gridMinor: 'rgba(255, 255, 255, 0.07)',
    gridMajor: 'rgba(255, 255, 255, 0.16)',
    selection: '#6ea1ff',
  },
  chalk: {
    background: '#1f3d2e',
    ink: '#f3f1e7',
    gridMinor: 'rgba(255, 255, 240, 0.08)',
    gridMajor: 'rgba(255, 255, 240, 0.17)',
    selection: '#ffe27a',
  },
};

export const resolveColor = (color: string, theme: Theme) => (color === INK ? THEMES[theme].ink : color);

export const PALETTE = [INK, '#e03131', '#1971c2', '#2f9e44', '#f08c00', '#9c36b5', '#0c8599', '#868e96'];
export const HIGHLIGHTER_PALETTE = ['#ffe066', '#8ce99a', '#74c0fc', '#ffa8a8', '#e599f7'];
