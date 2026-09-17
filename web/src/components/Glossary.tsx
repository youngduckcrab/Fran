import { useState } from 'react';
import { LANGUAGES, LANGUAGE_NAMES, type GlossaryEntry, type LangCode } from '@fran/shared';
import { deleteGlossaryEntry, saveGlossaryEntry } from '../api';
import { useT } from '../i18n';
import Icon from './Icon';

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

export default function Glossary({ entries, onChanged, onClose }: Props) {
  const t = useT();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      const { fetchGlossary } = await import('../api');
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
    <div className="sheet" role="dialog" aria-label={t('glossary.title')}>
      <div className="sheet__panel">
        <header className="sheet__header">
          <h2>{t('glossary.title')}</h2>
          <button type="button" className="sheet__close" onClick={onClose} aria-label={t('actions.close')}>
            <Icon name="close" size={16} />
          </button>
        </header>
        <p className="sheet__hint">
          {t('glossary.hint')}
        </p>

        {draft === null ? (
          <>
            <ul className="glossary">
              {entries.length === 0 && <li className="glossary__empty">{t('glossary.empty')}</li>}
              {entries.map((entry) => (
                <li key={entry.id} className="glossary__item">
                  <button type="button" className="glossary__edit" onClick={() => setDraft(toDraft(entry))}>
                    <b>{entry.term}</b>
                    <span className="glossary__to">
                      {Object.entries(entry.translations ?? {})
                        .map(([lang, value]) => `${lang}: ${value}`)
                        .join(' · ') || t('glossary.asIs')}
                    </span>
                    {entry.avoid && entry.avoid.length > 0 && (
                      <span className="glossary__avoid">✕ {entry.avoid.join(', ')}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            {error && <p className="sheet__error">{error}</p>}
            <div className="sheet__actions">
              <button type="button" className="sheet__save" onClick={() => setDraft({ ...EMPTY })}>
                {t('glossary.add')}
              </button>
            </div>
          </>
        ) : (
          <>
            <section className="sheet__section">
              <h3>{t('glossary.term')}</h3>
              <p className="sheet__hint">{t('glossary.termHint')}</p>
              <input
                className="login__input"
                value={draft.term}
                placeholder={t('glossary.termPlaceholder')}
                onChange={(event) => setDraft({ ...draft, term: event.target.value })}
              />
            </section>

            <section className="sheet__section">
              <h3>{t('glossary.to')}</h3>
              <p className="sheet__hint">{t('glossary.toHint')}</p>
              {LANGUAGES.map((lang) => (
                <label key={lang} className="glossary__field">
                  <span>{LANGUAGE_NAMES[lang]}</span>
                  <input
                    className="login__input"
                    value={draft.translations[lang] ?? ''}
                    placeholder={lang === 'es' ? 'bebe' : ''}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        translations: { ...draft.translations, [lang]: event.target.value },
                      })
                    }
                  />
                </label>
              ))}
            </section>

            <section className="sheet__section">
              <h3>{t('glossary.avoid')}</h3>
              <p className="sheet__hint">{t('glossary.avoidHint')}</p>
              <input
                className="login__input"
                value={draft.avoid}
                placeholder="amor, cariño"
                onChange={(event) => setDraft({ ...draft, avoid: event.target.value })}
              />
            </section>

            <section className="sheet__section">
              <h3>{t('glossary.note')}</h3>
              <input
                className="login__input"
                value={draft.note}
                placeholder={t('glossary.notePlaceholder')}
                onChange={(event) => setDraft({ ...draft, note: event.target.value })}
              />
            </section>

            {error && <p className="sheet__error">{error}</p>}

            <div className="sheet__actions">
              <button type="button" className="sheet__logout" onClick={() => setDraft(null)}>
                {t('glossary.cancel')}
              </button>
              {draft.id && (
                <button
                  type="button"
                  className="sheet__logout"
                  onClick={() => draft.id && void run(() => deleteGlossaryEntry(draft.id!))}
                >
                  {t('glossary.delete')}
                </button>
              )}
              <button
                type="button"
                className="sheet__save"
                onClick={save}
                disabled={busy || !draft.term.trim()}
              >
                {busy ? t('settings.saving') : t('settings.save')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
