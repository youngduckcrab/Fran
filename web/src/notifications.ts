/**
 * 폰에 쌓인 알림 치우기.
 *
 * 앱을 여는 것만으로는 치우지 않는다. 홈 화면에서 단어장만 보다 나갈 수도 있고,
 * 그때 알림이 사라지면 "봤다"는 표시만 없어지고 정작 메시지는 안 읽은 채로 남는다.
 * 채팅을 열어 실제로 읽었을 때만 치운다.
 */
export async function clearDelivered(): Promise<void> {
  const badge = navigator as Navigator & { clearAppBadge?: () => Promise<void> };
  void badge.clearAppBadge?.().catch(() => undefined);

  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    // 오래된 브라우저에는 getNotifications 가 없다. 그런 곳에서는 알림이 그냥 남는다.
    if (!registration?.getNotifications) return;
    const delivered = await registration.getNotifications();
    for (const notification of delivered) notification.close();
  } catch {
    // 알림을 못 치워도 대화에는 아무 지장이 없다.
  }
}
