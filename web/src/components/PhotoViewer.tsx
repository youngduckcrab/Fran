import { useEffect, useState } from 'react';
import { useBackClose } from '../backstack';
import { useT } from '../i18n';
import { attachmentUrl, fetchPhotoFile, savePhoto } from '../media';
import Icon from './Icon';

interface Props {
  /** 볼 사진의 첨부 id. */
  attachmentId: string;
  /** 누가 보낸 사진인지. 있으면 아래에 적는다. */
  who?: string;
  onClose: () => void;
}

/**
 * 사진 크게 보기.
 *
 * 예전에는 말풍선의 사진이 링크였다. 새 창을 여는 링크는 홈 화면에 설치한 앱에서
 * 제대로 열리지 않아서, 사진을 누르면 앱이 처음 화면으로 돌아가 버렸다.
 * 앱을 떠나지 않고 이 창에서 연다.
 */
export default function PhotoViewer({ attachmentId, who, onClose }: Props) {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  useBackClose(true, onClose);

  // 저장 버튼이 기다림 없이 눌리도록 미리 받아 둔다(폰이 공유 시트를 거부하지 않게).
  useEffect(() => {
    let cancelled = false;
    fetchPhotoFile(attachmentId)
      .then((loaded) => {
        if (!cancelled) setFile(loaded);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [attachmentId]);

  return (
    <div className="sheet" role="dialog" aria-label={t('bubble.photo')} onClick={onClose}>
      <div className="viewer" onClick={(event) => event.stopPropagation()}>
        <img src={attachmentUrl(attachmentId)} alt={t('bubble.photo')} />
        {error && <p className="sheet__error">{error}</p>}
        <div className="viewer__foot">
          {who && <span className="viewer__who">{who}</span>}
          <button
            type="button"
            className="sheet__save"
            disabled={!file}
            onClick={() => {
              if (!file) return;
              try {
                savePhoto(file);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
              }
            }}
          >
            <Icon name="download" size={16} />
            {t('photo.save')}
          </button>
          <button type="button" className="sheet__logout" onClick={onClose}>
            <Icon name="close" size={16} />
            {t('actions.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
