import { useState } from 'react';
import type { UserProfile } from '@fran/shared';
import type { Photo } from '../api';
import { useT } from '../i18n';
import Icon from './Icon';
import PhotoViewer from './PhotoViewer';
import { useBackClose } from '../backstack';
import { attachmentUrl } from '../media';

interface Props {
  photos: Photo[];
  me: UserProfile | null;
  peer: UserProfile | null;
  /** 한 화면으로 열렸을 때만. 채팅 위에 얹힐 때는 머리말이 필요 없다. */
  onBack?: () => void;
}

/** 대화방에서 주고받은 사진들. */
export default function Album({ photos, me, peer, onBack }: Props) {
  const t = useT();
  const [open, setOpen] = useState<Photo | null>(null);

  useBackClose(Boolean(open), () => setOpen(null));

  const who = (photo: Photo) => (photo.senderId === me?.id ? me?.name : peer?.name) ?? '';

  const body = (
    <>
      {photos.length === 0 && <p className="page__empty">
          <Icon name="sparkle" size={34} className="page__emptyIcon" />
          {t('album.empty')}
        </p>}

      <div className="album">
        {photos.map((photo) => (
          <button key={photo.id} type="button" className="album__cell" onClick={() => setOpen(photo)}>
            <img src={attachmentUrl(photo.id)} alt="" loading="lazy" />
          </button>
        ))}
      </div>

      {open && (
        <PhotoViewer attachmentId={open.id} who={who(open)} onClose={() => setOpen(null)} />
      )}
    </>
  );

  if (!onBack) return body;

  return (
    <div className="page">
      <header className="page__header">
        <button type="button" className="chat__back" onClick={onBack} aria-label={t('home.back')}>
          <Icon name="back" size={22} />
        </button>
        <h1>{t('album.title')}</h1>
      </header>
      {body}
    </div>
  );
}
