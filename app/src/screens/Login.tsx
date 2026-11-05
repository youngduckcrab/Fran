import { useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { fetchUsers, login, type LoginOption } from '../web/api';
import { createTranslate, toUiLang, type UiLang } from '../web/i18n';
import Icon from '../Icon';
import { Accent, Screen, useStyles } from '../ui/kit';
import { usePalette } from '../theme';

interface Props {
  onLogin: (token: string, userId: string) => void;
  /** 이미 정해진 사람이 있으면(마지막으로 쓴 사람) 그 사람으로 시작한다. */
  presetUserId?: string;
  uiLang: UiLang;
  onUiLang: (lang: UiLang) => void;
}

export default function Login({ onLogin, presetUserId, uiLang, onUiLang }: Props) {
  const p = usePalette();
  const t = createTranslate(uiLang);
  const [users, setUsers] = useState<LoginOption[]>([]);
  const [userId, setUserId] = useState(presetUserId ?? '');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<TextInput | null>(null);

  const st = useStyles((c) => ({
    body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    card: {
      width: '100%',
      maxWidth: 420,
      backgroundColor: c.surface,
      borderRadius: 26,
      padding: 24,
      gap: 12,
      borderWidth: 1,
      borderColor: c.border,
    },
    title: { color: c.text, fontSize: 30, fontWeight: '800', textAlign: 'center' },
    subtitle: { color: c.textMuted, textAlign: 'center', marginBottom: 6 },
    people: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
    person: {
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: c.border,
    },
    personOn: { backgroundColor: c.accentSoft, borderColor: c.accent },
    personText: { color: c.text, fontWeight: '600' },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 16,
      paddingHorizontal: 16,
      paddingVertical: 12,
      color: c.text,
      fontSize: 16,
      backgroundColor: c.bg,
    },
    error: { color: c.danger, textAlign: 'center' },
    submit: { borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
    submitText: { color: c.onAccent, fontWeight: '800', fontSize: 16 },
  }));

  /*
   * 누구로 들어갈지 고를 목록. 못 받으면 고를 사람이 없어 들어갈 수도 없다.
   *
   * 처음 켤 때 비행기 모드였거나 서버가 깨어나는 중이면 실패한다. 그대로 두면 앱을 껐다 켜야만
   * 풀리므로, 받을 때까지 점점 길게 기다리며 다시 받고, 앱으로 돌아올 때도 곧바로 다시 받는다.
   */
  useEffect(() => {
    let done = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      if (done) return;
      if (timer) clearTimeout(timer);
      timer = null;
      fetchUsers()
        .then((list) => {
          if (done) return;
          done = true;
          setError(null);
          setUsers(list);
          const chosen = list.find((user) => user.id === presetUserId) ?? list[0];
          if (chosen) {
            setUserId((current) => current || chosen.id);
            onUiLang(toUiLang(chosen.uiLang));
          }
        })
        .catch((cause: Error) => {
          if (done) return;
          setError(cause.message);
          attempt += 1;
          timer = setTimeout(load, Math.min(2000 * attempt, 15_000));
        });
    };
    load();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') load();
    });
    return () => {
      done = true;
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, [presetUserId, onUiLang]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onLogin(await login(userId, passcode), userId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const ready = !busy && Boolean(userId) && Boolean(passcode);

  return (
    <Screen>
      <KeyboardAvoidingView style={st.body} behavior="padding">
        <View style={st.card}>
          <View style={{ alignItems: 'center' }}>
            <Icon name="heart" size={38} color={p.accent} />
          </View>
          <Text style={st.title}>Fran</Text>
          <Text style={st.subtitle}>{t('login.subtitle')}</Text>

          {/* 두 사람뿐이라 늘 보여 준다. 로그아웃한 뒤에 다른 사람으로 들어올 길이 있어야 한다. */}
          <View style={st.people}>
            {users.map((user) => (
              <Pressable
                key={user.id}
                onPress={() => {
                  setUserId(user.id);
                  onUiLang(toUiLang(user.uiLang));
                  input.current?.focus();
                }}
                style={[st.person, userId === user.id && st.personOn]}
              >
                <Text style={st.personText}>{user.name}</Text>
              </Pressable>
            ))}
          </View>

          <TextInput
            ref={input}
            style={st.input}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('login.passcode')}
            placeholderTextColor={p.textMuted}
            value={passcode}
            onChangeText={setPasscode}
            onSubmitEditing={() => ready && void submit()}
            returnKeyType="go"
          />

          {error ? <Text style={st.error}>{error}</Text> : null}

          <Pressable onPress={() => void submit()} disabled={!ready} style={{ opacity: ready ? 1 : 0.5 }}>
            <Accent style={st.submit}>
              <Text style={st.submitText}>{busy ? t('login.checking') : t('login.enter')}</Text>
            </Accent>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
