import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Directory, File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { useT } from '../web/i18n';
import Icon from '../Icon';
import { attachmentUrl } from '../media';
import { TextButton } from '../ui/kit';

interface Props {
  /** 볼 사진의 첨부 id. */
  attachmentId: string;
  /** 누가 보낸 사진인지. 있으면 아래에 적는다. */
  who?: string;
  /** 이 사진이 오간 자리로. 사진첩에서 열었을 때만 있다. */
  onJump?: () => void;
  onClose: () => void;
}

/** 사진 크게 보기. 앱을 떠나지 않고 이 창에서 연다. 저장하면 폰 사진첩에 들어간다. */
export default function PhotoViewer({ attachmentId, who, onJump, onClose }: Props) {
  const t = useT();
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const insets = useSafeAreaInsets();

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) throw new Error(t('photo.save'));
      const file = await File.downloadFileAsync(
        attachmentUrl(attachmentId),
        new File(Paths.cache, `fran-${attachmentId.slice(0, 8)}.jpg`),
        { idempotent: true },
      );
      // SDK 57 부터 예전 saveToLibraryAsync 는 부르면 오류만 낸다. 새 방식으로 사진첩에 넣는다.
      await MediaLibrary.Asset.create(file.uri);
      setMessage(t('photo.saved'));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose}>
          <Image
            source={{ uri: attachmentUrl(attachmentId) }}
            style={{ flex: 1 }}
            contentFit="contain"
            accessibilityLabel={t('bubble.photo')}
          />
        </Pressable>
        {/* 화면 끝까지 그리므로 아래 버튼이 내비게이션 바에 가리지 않게 띄운다. */}
        <View style={{ padding: 16, paddingBottom: 16 + insets.bottom, gap: 10, alignItems: 'center' }}>
          {who ? <Text style={{ color: '#fff' }}>{who}</Text> : null}
          {message ? <Text style={{ color: '#fff' }}>{message}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <TextButton label={t('photo.save')} onPress={() => void save()} disabled={saving} filled />
            {onJump && <TextButton label={t('jump.go')} onPress={onJump} />}
            <TextButton label={t('actions.close')} onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
