import type { CSSProperties } from 'react';
import { isWallpaperId } from '@fran/shared';
import { attachmentUrl } from './media';

const PHOTO_PREFIX = 'photo:';

/** 직접 올린 사진을 배경으로 쓰고 있으면 그 첨부 id. */
export function wallpaperPhotoId(value: string | undefined): string | null {
  return value?.startsWith(PHOTO_PREFIX) ? value.slice(PHOTO_PREFIX.length) : null;
}

export function photoWallpaper(attachmentId: string): string {
  return `${PHOTO_PREFIX}${attachmentId}`;
}

/** 대화방에 씌울 배경. 기본 배경은 CSS 에, 사진은 style 로 붙는다. */
export function wallpaperProps(value: string | undefined): {
  className: string;
  style?: CSSProperties;
} {
  const photo = wallpaperPhotoId(value);
  if (photo) {
    return {
      className: 'wall wall--photo',
      style: { backgroundImage: `url("${attachmentUrl(photo)}")` },
    };
  }
  return { className: `wall wall--${isWallpaperId(value) ? value : 'default'}` };
}
