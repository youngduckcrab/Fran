import { useEffect, useState } from 'react';
import type { UserProfile } from '@fran/shared';
import { fetchPhotos, saveWallpaper, type Photo } from '../api';
import { useT } from '../i18n';
import { attachmentUrl } from '../media';
import { photoWallpaper } from '../wallpaper';

interface Props {
  me: UserProfile | null;
  peer: UserProfile | null;
  onWallpaper: (profile: UserProfile) => void;
  onBack: () => void;
}

/** 대화방에서 주고받은 사진들. 배경화면으로도 쓸 수 있다. */
export default function Album({ me, peer, onWallpaper, onBack }: Props) {
  const t = useT();
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Photo | null>(null);

  useEffect(() => {
    fetchPhotos()
      .then(setPhotos)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const useAsWallpaper = async (photo: Photo) => {
    try {
      onWallpaper(await saveWallpaper(photoWallpaper(photo.id)));
      setOpen(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const who = (photo: Photo) => (photo.senderId === me?.id ? me?.name : peer?.name) ?? '';

  return (
    <div className="page">
      <header className="page__header">
        <button type="button" className="chat__back" onClick={onBack} aria-label={t('home.back')}>
          ‹
        </button>
        <h1>{t('album.title')}</h1>
      </header>

      {error && <p className="sheet__error">{error}</p>}
      {photos && photos.length === 0 && <p className="page__empty">{t('album.empty')}</p>}

      <div className="album">
        {(photos ?? []).map((photo) => (
          <button key={photo.id} type="button" className="album__cell" onClick={() => setOpen(photo)}>
            <img src={attachmentUrl(photo.id)} alt="" loading="lazy" />
          </button>
        ))}
      </div>

      {open && (
        <div className="sheet" role="dialog" onClick={() => setOpen(null)}>
          <div className="viewer" onClick={(event) => event.stopPropagation()}>
            <img src={attachmentUrl(open.id)} alt="" />
            <div className="viewer__foot">
              <span>{who(open)}</span>
              <button type="button" className="sheet__save" onClick={() => void useAsWallpaper(open)}>
                {t('album.setWallpaper')}
              </button>
              <button type="button" className="sheet__logout" onClick={() => setOpen(null)}>
                {t('actions.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
