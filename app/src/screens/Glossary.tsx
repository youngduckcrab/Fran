import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { LANGUAGES, LANGUAGE_NAMES, type GlossaryEntry, type LangCode } from '@fran/shared';
import { deleteGlossaryEntry, fetchGlossary, saveGlossaryEntry } from '../web/api';
import { useT } from '../web/i18n';
import { Sheet, SheetHeader, TextButton, useStyles } from '../ui/kit';
import { usePalette } from '../theme';

interface Props {
  entries: GlossaryEntry[];
  onChanged: (entries: GlossaryEntry[]) => void;
  onClose: () => void;
}

interface Draft {
  id?: string;
  term: string;
  translations: Partial<Record<LangCode, string>>;
  avoid: string;
  note: string;
}

const EMPTY: Draft = { term: '', translations: {}, avoid: '', note: '' };

function toDraft(entry: GlossaryEntry): Draft {
  return {
    id: entry.id,
    term: entry.term,
    translations: entry.translations ?? {},
    avoid: (entry.avoid ?? []).join(', '),
    note: entry.note ?? '',
  };
}

/** 애칭·고유명사·둘만 아는 표현. 번역할 때 그대로 두거나 정한 대로 옮긴다. */
export default function Glossary({ entries, onChanged, onClose }: Props) {
  const t = useT();
  const p = usePalette();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const st = useStyles((c) => ({
    body: { paddingBottom: 30 },
    hint: { color: c.textMuted, paddingHorizontal: 20, paddingBottom: 8, lineHeight: 19 },
    item: { paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border, gap: 2 },
    term: { color: c.text, fontWeight: '800', fontSize: 16 },
    to: { color: c.textMuted },
    avoid: { color: c.danger, fontSize: 13 },
    section: { paddingHorizontal: 20, paddingVertical: 8, gap: 6 },
    h3: { color: c.text, fontWeight: '800' },
    input: { borderWidth: 1, borderColor: c.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, color: c.text, backgroundColor: c.bg },
    field: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    fieldLabel: { color: c.textMuted, width: 70 },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, padding: 20, flexWrap: 'wrap' },
  }));

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged(await fetchGlossary());
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!draft?.term.trim()) return;
    void run(() =>
      saveGlossaryEntry(
        {
          term: draft.term,
          translations: draft.translations,
          avoid: draft.avoid.split(',').map((item) => item.trim()).filter(Boolean),
          note: draft.note,
        },
        draft.id,
      ),
    );
  };

  return (
    <Sheet onClose={onClose} full>
      <SheetHeader title={t('glossary.title')} onClose={onClose} />
      <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
        <Text style={st.hint}>{t('glossary.hint')}</Text>

        {draft === null ? (
          <>
            {entries.length === 0 ? <Text style={[st.hint, { textAlign: 'center' }]}>{t('glossary.empty')}</Text> : null}
            {entries.map((entry) => (
              <Pressable key={entry.id} style={st.item} onPress={() => setDraft(toDraft(entry))}>
                <Text style={st.term}>{entry.term}</Text>
                <Text style={st.to}>
                  {Object.entries(entry.translations ?? {})
                    .map(([lang, value]) => `${lang}: ${value}`)
                    .join(' · ') || t('glossary.asIs')}
                </Text>
                {entry.avoid && entry.avoid.length > 0 ? <Text style={st.avoid}>✕ {entry.avoid.join(', ')}</Text> : null}
              </Pressable>
            ))}
            {error ? <Text style={[st.hint, { color: p.danger }]}>{error}</Text> : null}
            <View style={st.actions}>
              <TextButton label={t('glossary.add')} onPress={() => setDraft({ ...EMPTY })} filled />
            </View>
          </>
        ) : (
          <>
            <View style={st.section}>
              <Text style={st.h3}>{t('glossary.term')}</Text>
              <Text style={st.hint}>{t('glossary.termHint')}</Text>
              <TextInput
                style={st.input}
                value={draft.term}
                placeholder={t('glossary.termPlaceholder')}
                placeholderTextColor={p.textMuted}
                onChangeText={(term) => setDraft({ ...draft, term })}
              />
            </View>

            <View style={st.section}>
              <Text style={st.h3}>{t('glossary.to')}</Text>
              <Text style={st.hint}>{t('glossary.toHint')}</Text>
              {LANGUAGES.map((lang) => (
                <View key={lang} style={st.field}>
                  <Text style={st.fieldLabel}>{LANGUAGE_NAMES[lang]}</Text>
                  <TextInput
                    style={[st.input, { flex: 1 }]}
                    value={draft.translations[lang] ?? ''}
                    placeholder={lang === 'es' ? 'bebe' : ''}
                    placeholderTextColor={p.textMuted}
                    onChangeText={(value) => setDraft({ ...draft, translations: { ...draft.translations, [lang]: value } })}
                  />
                </View>
              ))}
            </View>

            <View style={st.section}>
              <Text style={st.h3}>{t('glossary.avoid')}</Text>
              <Text style={st.hint}>{t('glossary.avoidHint')}</Text>
              <TextInput
                style={st.input}
                value={draft.avoid}
                placeholder="amor, cariño"
                placeholderTextColor={p.textMuted}
                onChangeText={(avoid) => setDraft({ ...draft, avoid })}
              />
            </View>

            <View style={st.section}>
              <Text style={st.h3}>{t('glossary.note')}</Text>
              <TextInput
                style={st.input}
                value={draft.note}
                placeholder={t('glossary.notePlaceholder')}
                placeholderTextColor={p.textMuted}
                onChangeText={(note) => setDraft({ ...draft, note })}
              />
            </View>

            {error ? <Text style={[st.hint, { color: p.danger }]}>{error}</Text> : null}

            <View style={st.actions}>
              <TextButton label={t('glossary.cancel')} onPress={() => setDraft(null)} />
              {draft.id ? (
                <TextButton label={t('glossary.delete')} onPress={() => void run(() => deleteGlossaryEntry(draft.id!))} danger />
              ) : null}
              <TextButton
                label={busy ? t('settings.saving') : t('settings.save')}
                onPress={save}
                disabled={busy || !draft.term.trim()}
                filled
              />
            </View>
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}
