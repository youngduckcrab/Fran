import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import type { UserProfile } from '@fran/shared';
import type { Photo } from '../web/api';
import { useT } from '../web/i18n';
import { attachmentUrl } from '../media';
import { Header, Screen, useStyles } from '../ui/kit';
import PhotoViewer from './PhotoViewer';

interface Props {
  photos: Photo[];
  /** 그 사진이 오간 자리로 간다. */
  onJump?: (messageId: string) => void;
  me: UserProfile | null;
  peer: UserProfile | null;
  /** 한 화면으로 열렸을 때만. 채팅 위에 얹힐 때는 머리말이 필요 없다. */
  onBack?: () => void;
}

const COLUMNS = 3;

/** 대화방에서 주고받은 사진들. */
export default function Album({ photos, onJump, me, peer, onBack }: Props) {
  const t = useT();
  const [open, setOpen] = useState<Photo | null>(null);
  const st = useStyles((c) => ({
    empty: { color: c.textMuted, textAlign: 'center', padding: 32 },
    cell: { flex: 1 / COLUMNS, aspectRatio: 1, padding: 1.5 },
  }));

  const who = (photo: Photo) => (photo.senderId === me?.id ? me?.name : peer?.name) ?? '';

  const body = (
    <>
      {photos.length === 0 ? <Text style={st.empty}>{t('album.empty')}</Text> : null}
      <FlatList
        data={photos}
        numColumns={COLUMNS}
        keyExtractor={(photo) => photo.id}
        renderItem={({ item }) => (
          <Pressable style={st.cell} onPress={() => setOpen(item)}>
            <Image source={{ uri: attachmentUrl(item.id) }} style={{ flex: 1 }} contentFit="cover" />
          </Pressable>
        )}
      />
      {open && (
        <PhotoViewer
          attachmentId={open.id}
          who={who(open)}
          {...(onJump ? { onJump: () => onJump(open.messageId) } : {})}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );

  if (!onBack) return <View style={{ flex: 1 }}>{body}</View>;

  return (
    <Screen>
      <Header title={t('album.title')} onBack={onBack} />
      {body}
    </Screen>
  );
}
