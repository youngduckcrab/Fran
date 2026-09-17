import { useState } from 'react';
import { LANGUAGES, LANGUAGE_NAMES, type GlossaryEntry, type LangCode } from '@fran/shared';
import { deleteGlossaryEntry, saveGlossaryEntry } from '../api';

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
    <div className="sheet" role="dialog" aria-label="용어집">
      <div className="sheet__panel">
        <header className="sheet__header">
          <h2>용어집</h2>
          <button type="button" className="sheet__close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>
        <p className="sheet__hint">
          애칭·별명·둘만 아는 표현을 여기 적어두면 번역이 매번 그 규칙을 따릅니다.
          "이렇게는 쓰지 말 것"도 정할 수 있습니다.
        </p>

        {draft === null ? (
          <>
            <ul className="glossary">
              {entries.length === 0 && <li className="glossary__empty">아직 등록한 표현이 없습니다.</li>}
              {entries.map((entry) => (
                <li key={entry.id} className="glossary__item">
                  <button type="button" className="glossary__edit" onClick={() => setDraft(toDraft(entry))}>
                    <b>{entry.term}</b>
                    <span className="glossary__to">
                      {Object.entries(entry.translations ?? {})
                        .map(([lang, value]) => `${lang}: ${value}`)
                        .join(' · ') || '번역하지 않고 그대로'}
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
                표현 추가
              </button>
            </div>
          </>
        ) : (
          <>
            <section className="sheet__section">
              <h3>표현</h3>
              <p className="sheet__hint">내가 쓰는 말 그대로. 예: 애기</p>
              <input
                className="login__input"
                value={draft.term}
                placeholder="애기"
                onChange={(event) => setDraft({ ...draft, term: event.target.value })}
              />
            </section>

            <section className="sheet__section">
              <h3>이렇게 번역해 줘</h3>
              <p className="sheet__hint">비워두면 번역하지 않고 원문 그대로 둡니다.</p>
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
              <h3>이렇게는 쓰지 마</h3>
              <p className="sheet__hint">쉼표로 구분. 예: amor, cariño</p>
              <input
                className="login__input"
                value={draft.avoid}
                placeholder="amor, cariño"
                onChange={(event) => setDraft({ ...draft, avoid: event.target.value })}
              />
            </section>

            <section className="sheet__section">
              <h3>메모 (선택)</h3>
              <input
                className="login__input"
                value={draft.note}
                placeholder="연인 사이 애칭"
                onChange={(event) => setDraft({ ...draft, note: event.target.value })}
              />
            </section>

            {error && <p className="sheet__error">{error}</p>}

            <div className="sheet__actions">
              <button type="button" className="sheet__logout" onClick={() => setDraft(null)}>
                취소
              </button>
              {draft.id && (
                <button
                  type="button"
                  className="sheet__logout"
                  onClick={() => draft.id && void run(() => deleteGlossaryEntry(draft.id!))}
                >
                  삭제
                </button>
              )}
              <button
                type="button"
                className="sheet__save"
                onClick={save}
                disabled={busy || !draft.term.trim()}
              >
                {busy ? '저장 중…' : '저장'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
