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

/**
 * 아이폰·아이패드는 홈 화면에 추가한 앱에서만 알림을 받을 수 있다.
 *
 * 브라우저가 알림 기능을 갖고 있다고 말해도(PushManager 가 있어도) 탭에서는 켤 수
 * 없다. 그래서 "켤 수 있나"가 아니라 "설치했나"로 가른다 — 아니면 눌러도 되지 않는
 * 켜기 단추를 보여 주게 된다.
 */
function needsInstall(): boolean {
  const ua = navigator.userAgent;
  const apple = /iPad|iPhone|iPod/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  const standalone = (navigator as { standalone?: boolean }).standalone === true;
  const installed = standalone || window.matchMedia('(display-mode: standalone)').matches;
  return apple && !installed;
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

  // 이미 알림이 오고 있으면 할 말이 없다. 설치한 뒤 사파리 탭으로 들어온 경우가 그렇다.
  if (dismissed || state === null || state === 'on') return null;

  // 애플 기기는 설치해야만 켤 수 있다. 눌러도 되지 않는 켜기 단추 대신 설치하는 길을 준다.
  const install = needsInstall() || state === 'unsupported';
  if (state === 'unsupported' && !install) return null;

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
