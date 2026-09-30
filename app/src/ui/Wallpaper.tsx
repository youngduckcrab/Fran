import type { ReactNode } from 'react';
import { ImageBackground, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { isWallpaperId, type WallpaperId } from '@fran/shared';
import { attachmentUrl } from '../media';
import { usePalette } from '../theme';

const PHOTO_PREFIX = 'photo:';

/** 직접 올린 사진을 배경으로 쓰고 있으면 그 첨부 id. */
export function wallpaperPhotoId(value: string | undefined): string | null {
  return value?.startsWith(PHOTO_PREFIX) ? value.slice(PHOTO_PREFIX.length) : null;
}

export function photoWallpaper(attachmentId: string): string {
  return `${PHOTO_PREFIX}${attachmentId}`;
}

/** web/src/styles.css 의 .wall--* 와 같은 색. */
export const WALLPAPER_COLORS: Record<Exclude<WallpaperId, 'default'>, string[]> = {
  night: ['#0f1020', '#1b1b35', '#241d3a'],
  dawn: ['#2b1d3a', '#55355a', '#8a5a63'],
  forest: ['#12251c', '#1b3a2a', '#27503a'],
  sand: ['#2c2419', '#4a3b26', '#6b563a'],
  rose: ['#2a1622', '#4c2138', '#6e3350'],
  mono: ['#14141a', '#14141a', '#14141a'],
};

/** 대화방 바탕. 기본 배경은 색으로, 직접 올린 사진은 그림으로 깐다. */
export default function Wallpaper({ value, children }: { value: string | undefined; children: ReactNode }) {
  const p = usePalette();
  const photo = wallpaperPhotoId(value);

  if (photo) {
    return (
      <ImageBackground source={{ uri: attachmentUrl(photo) }} style={{ flex: 1 }} resizeMode="cover">
        {/* 사진 위에서는 글자가 묻히지 않도록 살짝 덮는다. */}
        <View style={{ flex: 1, backgroundColor: 'rgba(10,10,16,0.42)' }}>{children}</View>
      </ImageBackground>
    );
  }

  if (isWallpaperId(value) && value !== 'default') {
    return (
      <LinearGradient colors={WALLPAPER_COLORS[value] as [string, string, string]} style={{ flex: 1 }}>
        {children}
      </LinearGradient>
    );
  }

  return <View style={{ flex: 1, backgroundColor: p.bg }}>{children}</View>;
}
