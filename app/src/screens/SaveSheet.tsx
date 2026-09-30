import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { LANGUAGE_NAMES, messageText, type ChatMessage, type LangCode, type SavedSentence } from '@fran/shared';
import { deleteSaved, saveSentence } from '../web/api';
import { useT } from '../web/i18n';
import Icon from '../Icon';
import { Sheet, SheetHeader, TextButton, useStyles } from '../ui/kit';
import { usePalette } from '../theme';

interface Props {
  message: ChatMessage;
  /** 내가 읽는 언어. 저장할 때 뜻으로 함께 붙인다. */
  primaryLang: LangCode;
  /** 이미 저장한 것들. `<메시지 id>:<언어>` → 저장 항목 id. */
  savedIds: Map<string, string>;
  onSaved: (item: SavedSentence) => void;
  onUnsaved: (id: string) => void;
  onClose: () => void;
}

/**
 * 어떤 문장을 저장할지 고르는 창.
 *
 * 한 메시지에는 원문과 번역문이 함께 있다. 스페인어를 공부하는 사람은 스페인어 쪽을,
 * 뜻만 남기고 싶은 사람은 한국어 쪽을 담고 싶다. 앱이 대신 골라 줄 일이 아니라 물어본다.
 */
export default function SaveSheet({ message, primaryLang, savedIds, onSaved, onUnsaved, onClose }: Props) {
  const t = useT();
  const p = usePalette();
  const [busy, setBusy] = useState<LangCode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const st = useStyles((c) => ({
    hint: { color: c.textMuted, paddingHorizontal: 20, marginBottom: 6 },
    error: { color: c.danger, paddingHorizontal: 20 },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginHorizontal: 16,
      marginVertical: 5,
      padding: 14,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.border,
    },
    on: { borderColor: c.accent, backgroundColor: c.accentSoft },
    lang: { color: c.textMuted, fontSize: 11, fontWeight: '800' },
    text: { color: c.text, fontSize: 15, marginTop: 2 },
  }));

  const own = messageText(message);
  const options: Array<{ lang: LangCode; text: string }> = [
    ...(own ? [{ lang: message.sourceLang, text: own }] : []),
    ...Object.values(message.translations)
      .filter((translation): translation is NonNullable<typeof translation> => Boolean(translation))
      .map((translation) => ({ lang: translation.lang, text: translation.text })),
  ];

  /** 누르면 저장하고, 이미 저장한 것을 다시 누르면 취소한다. */
  const toggle = async (lang: LangCode, text: string) => {
    const key = `${message.id}:${lang}`;
    setBusy(lang);
    setError(null);
    try {
      const existing = savedIds.get(key);
      if (existing) {
        await deleteSaved(existing);
        onUnsaved(existing);
        return;
      }
      // 뜻을 함께 남긴다. 고른 문장이 내 언어면 원문을, 아니면 내 언어 번역을 짝으로.
      const pairLang = lang === primaryLang ? message.sourceLang : primaryLang;
      const pairText = pairLang === message.sourceLang ? own : message.translations[pairLang]?.text;
      const item = await saveSentence({
        messageId: message.id,
        lang,
        text,
        ...(pairText && pairLang !== lang ? { pairLang, pairText } : {}),
      });
      onSaved(item);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet onClose={onClose}>
      <SheetHeader title={t('save.title')} onClose={onClose} />
      <Text style={st.hint}>{t('save.hint')}</Text>
      {error ? <Text style={st.error}>{error}</Text> : null}
      <ScrollView>
        {options.map((option) => {
          const saved = savedIds.has(`${message.id}:${option.lang}`);
          return (
            <Pressable
              key={option.lang}
              style={[st.item, saved && st.on]}
              disabled={busy !== null}
              onPress={() => void toggle(option.lang, option.text)}
            >
              <View style={{ flex: 1 }}>
                <Text style={st.lang}>{LANGUAGE_NAMES[option.lang]}</Text>
                <Text style={st.text}>{option.text}</Text>
              </View>
              <Icon name={saved ? 'check' : 'bookmark'} size={18} color={p.accent} />
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={{ padding: 16, alignItems: 'center' }}>
        <TextButton label={t('actions.close')} onPress={onClose} filled />
      </View>
    </Sheet>
  );
}
