import { useState } from 'react';
import type { UserProfile } from '@fran/shared';
import { saveWallpaper } from '../api';
import { useBackClose } from '../backstack';
import { useT } from '../i18n';
import { attachmentUrl } from '../media';
import { photoWallpaper } from '../wallpaper';
import Icon from './Icon';

interface Props {
  /** 볼 사진의 첨부 id. */
  attachmentId: string;
  /** 누가 보낸 사진인지. 있으면 아래에 적는다. */
  who?: string;
  /** 배경으로 지정하면 새 프로필이 온다. 없으면 배경 버튼을 띄우지 않는다. */
  onWallpaper?: (profile: UserProfile) => void;
  onClose: () => void;
}

/**
 * 사진 크게 보기.
 *
 * 예전에는 말풍선의 사진이 링크였다. 새 창을 여는 링크는 홈 화면에 설치한 앱에서
 * 제대로 열리지 않아서, 사진을 누르면 앱이 처음 화면으로 돌아가 버렸다.
 * 앱을 떠나지 않고 이 창에서 연다.
 */
export default function PhotoViewer({ attachmentId, who, onWallpaper, onClose }: Props) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  useBackClose(true, onClose);

  const useAsWallpaper = async () => {
    if (!onWallpaper) return;
    try {
      onWallpaper(await saveWallpaper(photoWallpaper(attachmentId)));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="sheet" role="dialog" aria-label={t('bubble.photo')} onClick={onClose}>
      <div className="viewer" onClick={(event) => event.stopPropagation()}>
        <img src={attachmentUrl(attachmentId)} alt={t('bubble.photo')} />
        {error && <p className="sheet__error">{error}</p>}
        <div className="viewer__foot">
          {who && <span className="viewer__who">{who}</span>}
          {onWallpaper && (
            <button type="button" className="sheet__save" onClick={() => void useAsWallpaper()}>
              {t('album.setWallpaper')}
            </button>
          )}
          <button type="button" className="sheet__logout" onClick={onClose}>
            <Icon name="close" size={16} />
            {t('actions.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
