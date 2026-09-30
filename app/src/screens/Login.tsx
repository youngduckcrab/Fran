import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
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

  useEffect(() => {
    fetchUsers()
      .then((list) => {
        setUsers(list);
        const chosen = list.find((user) => user.id === presetUserId) ?? list[0];
        if (chosen) {
          setUserId((current) => current || chosen.id);
          onUiLang(toUiLang(chosen.uiLang));
        }
      })
      .catch((cause: Error) => setError(cause.message));
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
