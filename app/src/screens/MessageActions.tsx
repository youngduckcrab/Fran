import { Pressable, ScrollView, Text, View } from 'react-native';
import { REACTIONS } from '@fran/shared';
import { useT } from '../web/i18n';
import { Sheet, useStyles } from '../ui/kit';

interface Props {
  /** 실패한 메시지에만 재번역을 띄운다. */
  canRetranslate: boolean;
  /** 글이 있는 메시지에만 단어를 고를 수 있다. */
  canPickWord: boolean;
  /** 내가 보낸 글만 고칠 수 있다. */
  canEdit: boolean;
  /** 내가 이미 단 반응. 다시 누르면 지운다. */
  myReaction: string | null;
  onReact: (emoji: string | null) => void;
  onReply: () => void;
  onExplain: () => void;
  onPickWord: () => void;
  onEdit: () => void;
  onSave: () => void;
  onCopy: () => void;
  onRetranslate: () => void;
  onClose: () => void;
}

/** 말풍선을 길게 눌렀을 때 뜨는 메뉴. */
export default function MessageActions(props: Props) {
  const t = useT();
  const st = useStyles((c) => ({
    reactions: { flexDirection: 'row', justifyContent: 'space-around', padding: 14 },
    reaction: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
    reactionOn: { backgroundColor: c.accentSoft },
    item: { paddingHorizontal: 20, paddingVertical: 13 },
    itemTitle: { color: c.text, fontSize: 15, fontWeight: '700' },
    itemHint: { color: c.textMuted, fontSize: 12, marginTop: 2 },
    cancel: { alignItems: 'center', paddingVertical: 16, borderTopWidth: 1, borderTopColor: c.border },
  }));

  const Item = ({ title, hint, onPress }: { title: string; hint?: string; onPress: () => void }) => (
    <Pressable style={st.item} onPress={onPress}>
      <Text style={st.itemTitle}>{title}</Text>
      {hint ? <Text style={st.itemHint}>{hint}</Text> : null}
    </Pressable>
  );

  return (
    <Sheet onClose={props.onClose}>
      <ScrollView>
        {/* 한 줄로 늘어놓아 고르는 데 손가락 한 번이면 되게. */}
        <View style={st.reactions}>
          {REACTIONS.map((emoji) => (
            <Pressable
              key={emoji}
              style={[st.reaction, props.myReaction === emoji && st.reactionOn]}
              onPress={() => props.onReact(props.myReaction === emoji ? null : emoji)}
              accessibilityLabel={`${t('actions.react')} ${emoji}`}
            >
              <Text style={{ fontSize: 24 }}>{emoji}</Text>
            </Pressable>
          ))}
        </View>

        <Item title={t('actions.reply')} onPress={props.onReply} />
        {props.canEdit && <Item title={t('actions.edit')} hint={t('actions.editHint')} onPress={props.onEdit} />}
        <Item title={t('actions.explain')} hint={t('actions.explainHint')} onPress={props.onExplain} />
        {props.canPickWord && (
          <Item title={t('actions.pickWord')} hint={t('actions.pickWordHint')} onPress={props.onPickWord} />
        )}
        <Item title={t('actions.save')} hint={t('actions.saveHint')} onPress={props.onSave} />
        <Item title={t('actions.copy')} onPress={props.onCopy} />
        {props.canRetranslate && <Item title={t('actions.retranslate')} onPress={props.onRetranslate} />}
        <Pressable style={st.cancel} onPress={props.onClose}>
          <Text style={st.itemTitle}>{t('actions.close')}</Text>
        </Pressable>
      </ScrollView>
    </Sheet>
  );
}
