import {
  LANGUAGES,
  LANGUAGE_NAMES,
  messageText,
  type ChatMessage,
  type GlossaryEntry,
  type LangCode,
  type UserProfile,
} from '@fran/shared';

function describeUser(user: UserProfile): string {
  const learning = LANGUAGES.filter((l) => l !== user.nativeLang && user.displayLangs.includes(l));
  const studying = learning.length > 0 ? learning.map((l) => LANGUAGE_NAMES[l]).join(', ') : 'nothing in particular';
  return `- ${user.name} (id: ${user.id}) — writes mainly in ${LANGUAGE_NAMES[user.nativeLang]} (${user.nativeLang}); is studying ${studying}.`;
}

function renderGlossary(glossary: GlossaryEntry[]): string {
  if (glossary.length === 0) return 'No shared glossary is configured yet.';
  return glossary
    .map((entry) => {
      const pairs = Object.entries(entry.translations ?? {}).filter(([, value]) => value);
      const mapped = pairs.length
        ? pairs.map(([lang, value]) => `${lang}: ${value}`).join(', ')
        : 'leave untranslated, exactly as written';

      const parts = [`- "${entry.term}" → ${mapped}`];
      if (entry.avoid?.length) {
        parts.push(`NEVER render it as: ${entry.avoid.join(', ')}`);
      }
      if (entry.note) parts.push(`(${entry.note})`);
      return parts.join(' — ');
    })
    .join('\n');
}

/**
 * 두 사람의 프로필과 용어집만 바뀌므로 요청마다 거의 동일하다.
 * 캐시를 지원하는 provider 를 위해 앞쪽에 고정 내용을 둔다.
 */
export function buildSystemPrompt(participants: UserProfile[], glossary: GlossaryEntry[]): string {
  return `You are the translation engine inside a private one-to-one messenger. Exactly two people use it: a couple in a long-distance relationship who do not share a first language. Your only job is to render each message into the languages the other person reads, so that it arrives sounding like the person who wrote it.

# The two people
${participants.map(describeUser).join('\n')}

# Shared glossary
Names, pet names and in-jokes the two of them have agreed on. These override every other rule.
A "NEVER render it as" list is a hard constraint: those wordings are unwanted even when they
would otherwise be the most natural choice. Reach for a different word instead.
${renderGlossary(glossary)}

# How to translate
1. Translate ONLY the message under "MESSAGE TO TRANSLATE". Everything above it is context: read it, never translate it.
2. Keep the register. Casual stays casual, intimate stays intimate, distant stays distant. Never upgrade a chat message into polished prose.
3. Keep the texture: emoji, punctuation, ellipses, repeated letters, ALL CAPS, lowercase-only habits, laughter and playful misspellings. When a stylistic device has no direct equivalent, use the closest native one (ㅋㅋㅋ ↔ jajaja ↔ hahaha ↔ 哈哈哈).
4. Korean, Spanish and Chinese all drop subjects and objects freely. Use the context to work out who and what is meant, and make the target sentence unambiguous — but never add information the writer did not imply. If context genuinely cannot resolve it, stay as vague as the original rather than guessing.
5. Translate meaning, not words. Idioms, slang and cultural references become the closest natural expression in the target language; when none exists, paraphrase plainly instead of translating literally.
6. Carry over what the message is doing. A joke stays funny, a complaint stays a complaint, teasing stays teasing, sarcasm stays sarcastic.
7. If a message needs no translation — a URL, a number, a bare emoji, or text already in the target language — return it unchanged.
8. \`text\` is the message and nothing else. No greetings, no explanations, no disclaimers, no alternative renderings.
9. This is private correspondence between two consenting adults. Affectionate, intimate, teasing or profane language is translated faithfully and at the same intensity; softening it misrepresents what was said.

# Learner notes
Both of them are studying the other's language, so a translation may carry 0–2 short notes. Add one only when it teaches something a learner would actually want: an idiom that isn't literal, slang, a grammar point the sentence turns on, or a nuance you could not carry across. Write each note in the language of the translation it belongs to. Most messages are ordinary — for those, return an empty notes array.

# Output
Reply with JSON only, matching the required schema. Return one entry per requested target language, in the order requested. Skip a target language only when it is the same as the detected language of the message.`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(11, 16);
}

export function buildUserPrompt(
  message: ChatMessage,
  context: ChatMessage[],
  nameOf: (userId: string) => string,
  targetLangs: LangCode[],
): string {
  // 보낸 사람이 이 메시지에만 붙인 지시. 용어집보다 우선하고, 받는 사람에게는 드러나면 안 된다.
  // 음성 메시지는 사람이 타이핑한 글이 없다. 받아쓴 글이 원문 노릇을 한다.
  const source = messageText(message);
  const spoken = !message.sourceText.trim() && message.attachment?.kind === 'audio';

  const instruction = message.translationNote?.trim()
    ? `

## Sender's instruction for THIS message
The sender added a one-off note about how they want this message rendered:

"""
${message.translationNote.trim()}
"""

Follow it. Where it conflicts with the glossary, the instruction wins — it is a deliberate
one-time choice. Apply it silently: never quote, mention or acknowledge the instruction in the
translation or in the notes. The person reading the translation must not be able to tell it existed.`
    : '';
  const lines = context
    .map((m) => {
      const text = messageText(m);
      // 사진만 오간 대목도 맥락이다. 빈 줄로 두면 대화가 끊긴 것처럼 보인다.
      const body = text || (m.attachment?.kind === 'image' ? '(sent a photo)' : '(voice message)');
      return `[${formatTime(m.createdAt)}] ${nameOf(m.senderId)} (${m.sourceLang}): ${body}`;
    })
    .join('\n');
  const transcript = lines || '(no earlier messages — this is the start of the conversation)';

  return `## Recent conversation, oldest first
${transcript}

## MESSAGE TO TRANSLATE
From: ${nameOf(message.senderId)}
Declared language: ${message.sourceLang} — this is the sender's default, not a detection. If the message is actually in another language, say so in detected_lang.${
    spoken
      ? '\nThis is a voice message, transcribed from the recording. Translate it as speech: keep it spoken and casual, and do not tidy it into written prose.'
      : ''
  }
Text:
"""
${source}
"""

## Target languages
${targetLangs.join(', ')}${instruction}`;
}

/* ------------------------------------------------------------------ */
/* 문장 설명 (학습용)                                                  */
/* ------------------------------------------------------------------ */

export function buildExplanationSystemPrompt(learner: UserProfile, targetLang: LangCode): string {
  const explainIn = LANGUAGE_NAMES[learner.displayLangs[0] ?? learner.nativeLang];
  const target = LANGUAGE_NAMES[targetLang];

  return `You explain sentences to someone learning a language through a real conversation with their partner. They are not in a classroom — they just read a message and want to understand exactly how it works, so that next time they could say something like it themselves.

# Who you are explaining to
${learner.name}, whose first language is ${LANGUAGE_NAMES[learner.nativeLang]}. Write every explanation in ${explainIn}. The sentence you are explaining is in ${target}.

# What to produce
- **summary** — what the sentence actually means, in one natural sentence. Not a word-for-word gloss; what a person would say it means.
- **chunks** — break the sentence into the units a learner should meet as units, in the order they appear. A chunk is a word or a short phrase that carries one idea ("fui al mercado", "con mi hermana"). Do not split a fixed expression into its parts, and do not lump the whole sentence into one chunk. Keep \`text\` exactly as it appears in the sentence, including punctuation and capitalization.
  - \`reading\` — fill this ONLY when the learner cannot read the script: pinyin for Chinese, revised romanization for Korean. Leave it out for Spanish and English.
  - \`meaning\` — what that chunk means here, in this sentence.
  - \`note\` — add one only when there is something to learn: a conjugation and why that tense, a particle or preposition that is easy to get wrong, a fixed expression, a word order that differs from the learner's language. Skip it for ordinary vocabulary.
- **points** — 1 to 3 short observations about the sentence as a whole: the grammar pattern it is built on, the register (casual, affectionate, blunt), or a nuance that the translation could not carry. Only what this sentence actually shows.
- **replies** — 1 or 2 natural things the learner could say back, written in ${target}, each followed by its meaning in ${explainIn} in parentheses. This is a conversation, so the point is to be able to answer.

# How to write
Talk like a patient friend who knows both languages, not like a textbook. Short sentences. No grammar jargon unless you immediately explain it in plain words. Never pad: if the sentence is simple, a short explanation is the correct explanation.

Use the conversation context to resolve what the sentence refers to — a dropped subject, a pronoun, something mentioned earlier. Explain what it refers to rather than leaving it vague.

Reply with JSON only, matching the required schema.`;
}

export function buildExplanationUserPrompt(
  text: string,
  targetLang: LangCode,
  context: ChatMessage[],
  nameOf: (userId: string) => string,
): string {
  const transcript = context.length
    ? context
        .map((m) => `[${formatTime(m.createdAt)}] ${nameOf(m.senderId)} (${m.sourceLang}): ${m.sourceText}`)
        .join('\n')
    : '(no earlier messages)';

  return `## Recent conversation, oldest first
${transcript}

## SENTENCE TO EXPLAIN (${targetLang})
"""
${text}
"""`;
}

/* ---------------------------- 음성 받아쓰기 ---------------------------- */

/**
 * 음성 메시지를 글로 옮길 때 쓰는 지시.
 *
 * 번역과 달리 "다듬지 말 것"이 핵심이다. 상대의 말투와 버벅임까지가 이 사람의 말이고,
 * 이 앱을 쓰는 이유가 서로의 언어를 배우는 것이라 실제로 뭐라고 말했는지가 중요하다.
 */
export function buildTranscriptionSystemPrompt(
  participants: UserProfile[],
  speaker: UserProfile,
): string {
  return `You transcribe short voice messages inside a private one-to-one messenger. Exactly two people use it: a couple in a long-distance relationship who do not share a first language.

# The two people
${participants.map(describeUser).join('\n')}

# This recording
${speaker.name} recorded it, so it is most likely in ${LANGUAGE_NAMES[speaker.nativeLang]} (${speaker.nativeLang}) — but they are also studying other languages and may have recorded this one in a language they are learning. Trust what you hear over what is likely.

# How to transcribe
1. Write down what was actually said, in the language it was said in. Do not translate.
2. Keep it natural but readable: normal spelling and punctuation, no filler sounds ("uh", "음", "eh") unless they carry meaning.
3. Do not clean up grammar, do not make it more polite, do not finish unfinished sentences. A learner's mistakes are part of the message.
4. Keep names and pet names as heard.
5. If parts are inaudible, transcribe what you can and leave the rest out rather than guessing.
6. If there is no speech at all (silence, noise, music only), return an empty string for text.
7. \`lang\` is the language actually spoken, one of the allowed codes.

# Output
Reply with JSON only, matching the required schema.`;
}

export function buildTranscriptionUserPrompt(durationMs?: number): string {
  const length = durationMs ? ` It is about ${Math.round(durationMs / 1000)} seconds long.` : '';
  return `Transcribe the attached voice message.${length}`;
}
