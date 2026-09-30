import { useEffect, useState, type ReactNode } from 'react';
import { ImageBackground, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import {
  GENDERS,
  LANGUAGES,
  LANGUAGE_NAMES,
  THEMES,
  WALLPAPERS,
  type Gender,
  type LangCode,
  type ThemeId,
  type UserProfile,
} from '@fran/shared';
import { changePasscode, saveSettings, saveTheme, saveWallpaper } from '../web/api';
import { useT, type StringKey } from '../web/i18n';
import { BUBBLE_VIEWS, type BubbleView } from '../web/view';
import { attachmentUrl, prepareImage, uploadFile } from '../media';
import { disablePush, enablePush, pushState, testPush, type PushState } from '../push';
import { THEME_COLORS, usePalette } from '../theme';
import { Chips, Sheet, SheetHeader, TextButton, useStyles } from '../ui/kit';
import { WALLPAPER_COLORS, photoWallpaper, wallpaperPhotoId } from '../ui/Wallpaper';

interface Props {
  profile: UserProfile;
  /** 말풍선에서 원문·번역 중 무엇을 크게 볼지. */
  view: BubbleView;
  onChangeView: (value: BubbleView) => void;
  onSaved: (profile: UserProfile) => void;
  /** 색을 고르는 순간 앱 전체를 그 색으로. */
  onTheme: (theme: ThemeId | undefined) => void;
  onClose: () => void;
  onLogout: () => void;
  /** 비밀번호를 바꾸면 새 토큰이 나온다. 위로 올려 보낸다. */
  onToken: (token: string) => void;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const st = useStyles((c) => ({
    section: { paddingHorizontal: 20, paddingVertical: 12, gap: 8, borderTopWidth: 1, borderTopColor: c.border },
    title: { color: c.text, fontSize: 15, fontWeight: '800' },
    hint: { color: c.textMuted, fontSize: 13, lineHeight: 18 },
  }));
  return (
    <View style={st.section}>
      <Text style={st.title}>{title}</Text>
      {hint ? <Text style={st.hint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

export default function Settings({ profile, view, onChangeView, onSaved, onTheme, onClose, onLogout, onToken }: Props) {
  const t = useT();
  const p = usePalette();
  const [nativeLang, setNativeLang] = useState<LangCode>(profile.nativeLang);
  const [displayLangs, setDisplayLangs] = useState<LangCode[]>(profile.displayLangs);
  const [gender, setGender] = useState<Gender>(profile.gender ?? 'unspecified');
  const [region, setRegion] = useState(profile.region ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<ThemeId>(profile.theme ?? 'rose');
  const [wallpaper, setWallpaper] = useState<string>(profile.wallpaper ?? 'default');
  const [wallBusy, setWallBusy] = useState(false);
  const photoWall = wallpaperPhotoId(profile.wallpaper);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  /** 새 비밀번호를 한 번 더. 오타가 그대로 잠금이 되면 둘 다 못 들어온다. */
  const [again, setAgain] = useState('');
  const [passBusy, setPassBusy] = useState(false);
  const [passDone, setPassDone] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);
  const mismatch = again.length > 0 && next !== again;

  const [push, setPush] = useState<PushState>('unsupported');
  const [pushBusy, setPushBusy] = useState(false);
  const [tested, setTested] = useState<string | null>(null);

  const st = useStyles((c) => ({
    body: { paddingBottom: 40 },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 10,
      color: c.text,
      backgroundColor: c.bg,
    },
    wrong: { borderColor: c.danger },
    order: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    orderItem: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: c.accentSoft },
    themes: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    dot: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: 'transparent', overflow: 'hidden' },
    dotOn: { borderColor: c.text },
    walls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    wall: {
      width: '23%',
      aspectRatio: 1,
      borderRadius: 14,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: 'transparent',
    },
    wallOn: { borderColor: c.accent },
    wallText: { color: '#fff', fontSize: 11, fontWeight: '700' },
    toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    toggleText: { color: c.text, flex: 1 },
    error: { color: c.danger, paddingHorizontal: 20 },
    done: { color: c.ok },
    actions: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, gap: 12 },
  }));

  const toggleDisplay = (lang: LangCode) =>
    setDisplayLangs((now) => (now.includes(lang) ? now.filter((item) => item !== lang) : [...now, lang]));

  /** 목록의 첫 번째가 주 언어. 순서를 바꿔 어떤 번역을 크게 볼지 정한다. */
  const promote = (lang: LangCode) => setDisplayLangs((now) => [lang, ...now.filter((item) => item !== lang)]);

  const chooseTheme = async (value: ThemeId) => {
    const previous = theme;
    // 누르자마자 앱 전체가 그 색으로 바뀌는 게 보여야 고르는 맛이 있다.
    setTheme(value);
    onTheme(value);
    try {
      onSaved(await saveTheme(value));
    } catch (cause) {
      setTheme(previous);
      onTheme(previous);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const chooseWallpaper = async (value: string) => {
    const previous = wallpaper;
    setWallpaper(value);
    try {
      onSaved(await saveWallpaper(value));
    } catch (cause) {
      setWallpaper(previous);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  /** 폰 갤러리에서 고른 사진을 배경으로. 올리기 전에 줄인다. */
  const pickWallpaper = async () => {
    setWallBusy(true);
    setError(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return;
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) return;
      const small = await prepareImage(asset.uri, asset.width, asset.height);
      const attachment = await uploadFile(small.uri, 'image', 'image/jpeg', { width: small.width, height: small.height });
      await chooseWallpaper(photoWallpaper(attachment.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWallBusy(false);
    }
  };

  const submitPasscode = async () => {
    if (next !== again) {
      setPassError(t('settings.passcodeMismatch'));
      return;
    }
    setPassBusy(true);
    setPassError(null);
    setPassDone(false);
    try {
      onToken(await changePasscode(current, next));
      setCurrent('');
      setNext('');
      setAgain('');
      setPassDone(true);
    } catch (cause) {
      // 사유는 코드로 온다. 문구는 읽는 사람의 언어로 여기서 붙인다.
      const code = (cause as { code?: string }).code;
      setPassError(
        code === 'wrongCurrent'
          ? t('settings.passcodeWrong')
          : code === 'tooShort'
            ? t('settings.passcodeShort')
            : code === 'same'
              ? t('settings.passcodeSame')
              : cause instanceof Error
                ? cause.message
                : String(cause),
      );
    } finally {
      setPassBusy(false);
    }
  };

  useEffect(() => {
    void pushState().then(setPush);
  }, []);

  const togglePush = async (want: boolean) => {
    setPushBusy(true);
    setError(null);
    setTested(null);
    try {
      setPush(want ? await enablePush() : await disablePush());
    } catch {
      setError(t('settings.notifyFailed'));
    } finally {
      setPushBusy(false);
    }
  };

  const tryPush = async () => {
    setPushBusy(true);
    setTested(null);
    try {
      const sent = await testPush();
      setTested(sent > 0 ? t('settings.notifyTestSent', { count: String(sent) }) : t('settings.notifyTestNone'));
    } catch {
      setTested(t('settings.notifyFailed'));
    } finally {
      setPushBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await saveSettings(nativeLang, displayLangs, { gender, region: region.trim() }));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const langLabel = (lang: LangCode) => LANGUAGE_NAMES[lang];
  const version = `${Constants.expoConfig?.version ?? '?'} (${Application.nativeBuildVersion ?? '?'})`;

  return (
    <Sheet onClose={onClose} full>
      <SheetHeader title={t('settings.title')} onClose={onClose} />
      <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
        <Section title={t('settings.myLang')} hint={t('settings.myLangHint')}>
          <Chips items={LANGUAGES} value={nativeLang} onChange={setNativeLang} label={langLabel} />
        </Section>

        <Section title={t('settings.readLang')} hint={t('settings.readLangHint')}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {LANGUAGES.map((lang) => {
              const on = displayLangs.includes(lang);
              return (
                <Pressable
                  key={lang}
                  onPress={() => toggleDisplay(lang)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 7,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: on ? p.accent : p.border,
                    backgroundColor: on ? p.accentSoft : 'transparent',
                  }}
                >
                  <Text style={{ color: p.text, fontWeight: on ? '800' : '500' }}>{langLabel(lang)}</Text>
                </Pressable>
              );
            })}
          </View>
          {displayLangs.length > 1 && (
            <View style={st.order}>
              {displayLangs.map((lang, index) => (
                <Pressable key={lang} style={st.orderItem} onPress={() => promote(lang)}>
                  <Text style={{ color: p.text }}>
                    {index === 0 ? '★ ' : ''}
                    {langLabel(lang)}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </Section>

        <Section title={t('settings.view')} hint={t('settings.viewHint')}>
          <Chips items={BUBBLE_VIEWS} value={view} onChange={onChangeView} label={(item) => t(`view.${item}` as StringKey)} />
        </Section>

        <Section title={t('settings.about')} hint={t('settings.aboutHint')}>
          <Chips items={GENDERS} value={gender} onChange={setGender} label={(item) => t(`gender.${item}` as StringKey)} />
          <TextInput
            style={st.input}
            value={region}
            placeholder={t('settings.regionPlaceholder')}
            placeholderTextColor={p.textMuted}
            onChangeText={setRegion}
          />
        </Section>

        <Section title={t('settings.theme')} hint={t('settings.themeHint')}>
          <View style={st.themes}>
            {THEMES.map((id) => (
              <Pressable
                key={id}
                onPress={() => void chooseTheme(id)}
                accessibilityLabel={t(`theme.${id}` as StringKey)}
                style={[st.dot, theme === id && st.dotOn]}
              >
                <LinearGradient
                  colors={THEME_COLORS[id]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ flex: 1 }}
                />
              </Pressable>
            ))}
          </View>
        </Section>

        <Section title={t('settings.wallpaper')} hint={t('settings.wallpaperHint')}>
          <View style={st.walls}>
            {WALLPAPERS.map((id) => {
              const colors = id === 'default' ? [p.bg, p.bg, p.bg] : WALLPAPER_COLORS[id];
              return (
                <Pressable key={id} onPress={() => void chooseWallpaper(id)} style={[st.wall, wallpaper === id && st.wallOn]}>
                  <LinearGradient colors={colors as [string, string, string]} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
                  <Text style={st.wallText}>{t(`wall.${id}` as StringKey)}</Text>
                </Pressable>
              );
            })}
            {photoWall && (
              <Pressable
                onPress={() => void chooseWallpaper(profile.wallpaper as string)}
                style={[st.wall, wallpaper === profile.wallpaper && st.wallOn]}
              >
                <ImageBackground
                  source={{ uri: attachmentUrl(photoWall) }}
                  style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
                />
                <Text style={st.wallText}>{t('wall.photo')}</Text>
              </Pressable>
            )}
          </View>
          <View style={{ alignItems: 'flex-start' }}>
            <TextButton
              label={wallBusy ? t('composer.uploading') : t('settings.wallpaperPick')}
              onPress={() => void pickWallpaper()}
              disabled={wallBusy}
            />
          </View>
        </Section>

        <Section title={t('settings.passcode')} hint={t('settings.passcodeHint')}>
          <TextInput style={st.input} secureTextEntry autoCapitalize="none" placeholder={t('settings.passcodeCurrent')} placeholderTextColor={p.textMuted} value={current} onChangeText={setCurrent} />
          <TextInput style={st.input} secureTextEntry autoCapitalize="none" placeholder={t('settings.passcodeNew')} placeholderTextColor={p.textMuted} value={next} onChangeText={setNext} />
          <TextInput style={[st.input, mismatch && st.wrong]} secureTextEntry autoCapitalize="none" placeholder={t('settings.passcodeConfirm')} placeholderTextColor={p.textMuted} value={again} onChangeText={setAgain} />
          <View style={{ alignItems: 'flex-start' }}>
            <TextButton
              label={passBusy ? t('settings.saving') : t('settings.passcodeChange')}
              onPress={() => void submitPasscode()}
              disabled={passBusy || !current || !next || !again || mismatch}
              filled
            />
          </View>
          {mismatch && <Text style={{ color: p.danger }}>{t('settings.passcodeMismatch')}</Text>}
          {passError && !mismatch && <Text style={{ color: p.danger }}>{passError}</Text>}
          {passDone && <Text style={st.done}>{t('settings.passcodeChanged')}</Text>}
        </Section>

        {/* 고쳤다는데 그대로일 때 여기부터 본다 — 번호가 옛것이면 아직 새 앱을 안 깐 것이다. */}
        <Section title={t('settings.version')} hint={t('settings.versionBuilt', { at: version })}>
          <View />
        </Section>

        <Section title={t('settings.notify')}>
          {push === 'unsupported' ? (
            <Text style={{ color: p.textMuted }}>{t('settings.notifyUnsupported')}</Text>
          ) : push === 'denied' ? (
            <Text style={{ color: p.textMuted }}>{t('settings.notifyDenied')}</Text>
          ) : (
            <>
              <View style={st.toggle}>
                <Text style={st.toggleText}>{t('settings.notifyOn')}</Text>
                <Switch
                  value={push === 'on'}
                  disabled={pushBusy}
                  onValueChange={(value) => void togglePush(value)}
                  trackColor={{ true: p.accent }}
                />
              </View>
              <Text style={{ color: p.textMuted, fontSize: 13 }}>{t('settings.notifyHint')}</Text>
              {push === 'on' && (
                <View style={{ alignItems: 'flex-start', gap: 6 }}>
                  <TextButton label={t('settings.notifyTest')} onPress={() => void tryPush()} disabled={pushBusy} />
                  {tested ? <Text style={{ color: p.textMuted }}>{tested}</Text> : null}
                </View>
              )}
            </>
          )}
        </Section>

        {error ? <Text style={st.error}>{error}</Text> : null}

        <View style={st.actions}>
          <TextButton label={t('settings.logout')} onPress={onLogout} danger />
          <TextButton
            label={busy ? t('settings.saving') : t('settings.save')}
            onPress={() => void submit()}
            disabled={busy || displayLangs.length === 0}
            filled
          />
        </View>
      </ScrollView>
    </Sheet>
  );
}
