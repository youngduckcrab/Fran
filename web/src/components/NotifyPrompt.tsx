import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { enablePush, pushState, type PushState } from '../push';
import Icon from './Icon';

interface Props {
  /** 사람마다 한 번만 묻는다. */
  userId: string;
}

function dismissKey(userId: string): string {
  return `fran.askedPush.${userId}`;
}

/** 아이폰은 홈 화면에 추가한 앱에서만 알림을 받을 수 있다. */
function isIosBrowser(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  const installed = window.matchMedia('(display-mode: standalone)').matches;
  return ios && !installed;
}

/**
 * 알림이 꺼져 있으면 한 번 권한다.
 *
 * 매번 띄우면 잔소리가 된다. 한 번 닫으면 그 기기에서는 다시 묻지 않고, 언제든 설정에서
 * 켤 수 있다. 켜려면 사용자가 누른 그 순간에 브라우저에 물어야 해서 버튼으로 둔다.
 */
export default function NotifyPrompt({ userId }: Props) {
  const t = useT();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(dismissKey(userId)) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    void pushState().then(setState);
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(dismissKey(userId), '1');
    } catch {
      // 저장하지 못하면 다음에 한 번 더 묻는다. 그 정도는 괜찮다.
    }
  };

  const turnOn = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const next = await enablePush();
      setState(next);
      if (next === 'on') dismiss();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (dismissed || state === null || state === 'on') return null;
  if (state === 'unsupported' && !isIosBrowser()) return null;

  const install = state === 'unsupported';
  const denied = state === 'denied';

  return (
    <div className="notice">
      <span className="notice__icon">
        <Icon name="heart" size={20} />
      </span>
      <div className="notice__body">
        <b>{install ? t('ask.installTitle') : denied ? t('ask.deniedTitle') : t('ask.title')}</b>
        <span>
          {install
            ? t('ask.installBody')
            : denied
              ? t('settings.notifyDenied')
              : failed
                ? t('settings.notifyFailed')
                : t('ask.body')}
        </span>
      </div>
      <div className="notice__actions">
        {!install && !denied && (
          <button type="button" className="notice__yes" onClick={() => void turnOn()} disabled={busy}>
            {busy ? t('settings.saving') : t('ask.enable')}
          </button>
        )}
        <button type="button" className="notice__no" onClick={dismiss}>
          {install || denied ? t('actions.close') : t('ask.later')}
        </button>
      </div>
    </div>
  );
}
