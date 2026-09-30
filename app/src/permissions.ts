import { PermissionsAndroid, Platform } from 'react-native';

/**
 * 통화를 걸거나 받기 전에 마이크(와 카메라) 권한을 확인한다.
 *
 * 통화 안에서 getUserMedia 가 처음 권한을 묻게 두면, 거절했을 때 어떤 이름의 오류가
 * 오는지가 기기마다 달라 "왜 안 되는지" 를 알려 줄 수 없다. 미리 묻고 결과만 본다.
 */
export async function ensureCallPermissions(video: boolean): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const wanted = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, ...(video ? [PermissionsAndroid.PERMISSIONS.CAMERA] : [])];
  const result = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every((permission) => result[permission] === PermissionsAndroid.RESULTS.GRANTED);
}
