import { useEffect, useState } from 'react';
import type { UserProfile } from '@fran/shared';
import { fetchPhotos, type Photo } from '../api';
import { useT } from '../i18n';
import Icon from './Icon';
import PhotoViewer from './PhotoViewer';
import { useBackClose } from '../backstack';
import { attachmentUrl } from '../media';

interface Props {
  me: UserProfile | null;
  peer: UserProfile | null;
  onBack: () => void;
}

/** 대화방에서 주고받은 사진들. 배경화면으로도 쓸 수 있다. */
export default function Album({ me, peer, onBack }: Props) {
  const t = useT();
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Photo | null>(null);

  useEffect(() => {
    fetchPhotos()
      .then(setPhotos)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  useBackClose(Boolean(open), () => setOpen(null));

  const who = (photo: Photo) => (photo.senderId === me?.id ? me?.name : peer?.name) ?? '';

  return (
    <div className="page">
      <header className="page__header">
        <button type="button" className="chat__back" onClick={onBack} aria-label={t('home.back')}>
          <Icon name="back" size={22} />
        </button>
        <h1>{t('album.title')}</h1>
      </header>

      {error && <p className="sheet__error">{error}</p>}
      {photos && photos.length === 0 && <p className="page__empty">
          <Icon name="sparkle" size={34} className="page__emptyIcon" />
          {t('album.empty')}
        </p>}

      <div className="album">
        {(photos ?? []).map((photo) => (
          <button key={photo.id} type="button" className="album__cell" onClick={() => setOpen(photo)}>
            <img src={attachmentUrl(photo.id)} alt="" loading="lazy" />
          </button>
        ))}
      </div>

      {open && (
        <PhotoViewer attachmentId={open.id} who={who(open)} onClose={() => setOpen(null)} />
      )}

    </div>
  );
}
