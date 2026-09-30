import { useMemo, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon, { type IconName } from '../Icon';
import { RADIUS, usePalette, type Palette } from '../theme';

/** 화면마다 되풀이되는 스타일 만들기. 팔레트가 바뀔 때만 다시 만든다. */
export function useStyles<T extends StyleSheet.NamedStyles<T>>(factory: (p: Palette) => T): T {
  const p = usePalette();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => StyleSheet.create(factory(p)), [p]);
}

/** 분홍-보라 그라디언트. 단추와 강조에 쓴다. */
export function Accent({ style, children }: { style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const p = usePalette();
  return (
    <LinearGradient colors={[p.c1, p.c2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={style}>
      {children}
    </LinearGradient>
  );
}

/** 안전 영역(상태 표시줄·제스처 바)을 피하는 바탕. */
export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return (
    <SafeAreaView style={[{ flex: 1, backgroundColor: p.bg }, style]} edges={['top', 'left', 'right', 'bottom']}>
      {children}
    </SafeAreaView>
  );
}

/** 위쪽 줄: 뒤로 · 제목 · 오른쪽 단추들. */
export function Header({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  const p = usePalette();
  const st = useStyles((c) => ({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingVertical: 8,
      gap: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
      backgroundColor: c.surface,
    },
    who: { flex: 1, paddingHorizontal: 6 },
    title: { color: c.text, fontSize: 17, fontWeight: '700' },
    sub: { color: c.textMuted, fontSize: 12, marginTop: 1 },
    right: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  }));
  return (
    <View style={st.bar}>
      {onBack && <IconButton name="back" size={22} onPress={onBack} color={p.text} />}
      <View style={st.who}>
        <Text style={st.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={st.sub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={st.right}>{right}</View>
    </View>
  );
}

export function IconButton({
  name,
  onPress,
  size = 20,
  color,
  disabled,
  label,
  style,
}: {
  name: IconName;
  onPress: () => void;
  size?: number;
  color?: string;
  disabled?: boolean;
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [
        { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
        pressed && { backgroundColor: p.accentSoft },
        disabled && { opacity: 0.35 },
        style,
      ]}
    >
      <Icon name={name} size={size} color={color ?? p.text} />
    </Pressable>
  );
}

/** 글자 단추. 테두리만 있는 것과 채운 것. */
export function TextButton({
  label,
  onPress,
  filled,
  disabled,
  danger,
}: {
  label: string;
  onPress: () => void;
  filled?: boolean;
  disabled?: boolean;
  danger?: boolean;
}) {
  const p = usePalette();
  const body = (
    <Text
      style={{
        color: filled ? p.onAccent : danger ? p.danger : p.text,
        fontWeight: '700',
        fontSize: 14,
      }}
    >
      {label}
    </Text>
  );
  const base: ViewStyle = {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: disabled ? 0.45 : 1,
  };
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button">
      {filled ? (
        <Accent style={base}>{body}</Accent>
      ) : (
        <View style={[base, { borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }]}>{body}</View>
      )}
    </Pressable>
  );
}

/** 아래에서 올라오는 창. 바깥을 누르거나 뒤로가기를 누르면 닫힌다. */
export function Sheet({
  onClose,
  children,
  full,
}: {
  onClose: () => void;
  children: ReactNode;
  /** 화면을 거의 다 덮는 창. 목록이 긴 것에 쓴다. */
  full?: boolean;
}) {
  const p = usePalette();
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: p.surface,
            borderTopLeftRadius: RADIUS,
            borderTopRightRadius: RADIUS,
            maxHeight: full ? '92%' : '85%',
            ...(full ? { height: '92%' } : {}),
            overflow: 'hidden',
          }}
        >
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** 한 줄 짜리 눌러 볼 수 있는 항목. */
export function Row({
  title,
  hint,
  onPress,
  right,
}: {
  title: string;
  hint?: string;
  onPress?: () => void;
  right?: ReactNode;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 18,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: pressed ? p.accentSoft : 'transparent',
      })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: p.text, fontSize: 15, fontWeight: '600' }}>{title}</Text>
        {hint ? <Text style={{ color: p.textMuted, fontSize: 12, marginTop: 2 }}>{hint}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

/** 창 위쪽: 제목과 닫기. */
export function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  const p = usePalette();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: 20,
        paddingRight: 8,
        paddingVertical: 8,
      }}
    >
      <Text style={{ color: p.text, fontSize: 18, fontWeight: '800' }}>{title}</Text>
      <IconButton name="close" size={18} onPress={onClose} color={p.text} />
    </View>
  );
}

/** 고르는 알약들. 한 줄에 다 안 들어가면 줄바꿈한다. */
export function Chips<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: readonly T[];
  value: T | null;
  onChange: (item: T) => void;
  label: (item: T) => string;
}) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20, paddingVertical: 6 }}>
      {items.map((item) => {
        const on = item === value;
        return (
          <Pressable
            key={item}
            onPress={() => onChange(item)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 7,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: on ? p.accent : p.border,
              backgroundColor: on ? p.accentSoft : 'transparent',
            }}
          >
            <Text style={{ color: p.text, fontWeight: on ? '800' : '500' }}>{label(item)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
