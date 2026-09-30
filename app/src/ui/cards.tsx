import type { ReactNode } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Icon from '../Icon';
import { usePalette } from '../theme';

/** 저장한 문장·단어 카드. */
export function Card({ children, faded }: { children: ReactNode; faded?: boolean }) {
  const p = usePalette();
  return (
    <View
      style={{
        marginHorizontal: 16,
        marginVertical: 6,
        padding: 14,
        gap: 4,
        borderRadius: 18,
        backgroundColor: p.surface,
        borderWidth: 1,
        borderColor: p.border,
        opacity: faded ? 0.7 : 1,
      }}
    >
      {children}
    </View>
  );
}

/** 카드 밑에 놓는 작은 글자 단추. */
export function Tool({ label, onPress, danger, disabled }: { label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  const p = usePalette();
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={6} style={{ opacity: disabled ? 0.5 : 1 }}>
      <Text style={{ color: danger ? p.danger : p.accent, fontWeight: '700', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

/** 소리 버튼. 누르면 읽고, 다시 누르면 멈춘다. */
export function SpeakButton({
  on,
  onPress,
  label,
  style,
}: {
  on: boolean;
  onPress: () => void;
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      hitSlop={8}
      style={[
        {
          width: 24,
          height: 24,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: on ? p.accent : p.accentSoft,
        },
        style,
      ]}
    >
      <Icon name={on ? 'stop' : 'play'} size={12} color={on ? p.onAccent : p.accent} />
    </Pressable>
  );
}

/** 목록이 비었을 때. */
export function Empty({ text }: { text: string }) {
  const p = usePalette();
  return (
    <View style={{ alignItems: 'center', padding: 32, gap: 8 }}>
      <Icon name="sparkle" size={34} color={p.accent} />
      <Text style={{ color: p.textMuted, textAlign: 'center' }}>{text}</Text>
    </View>
  );
}
