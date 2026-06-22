import { ReactNode } from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { theme } from '../theme';

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function Field({
  label,
  ...props
}: { label: string } & TextInputProps) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={theme.dim}
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
        style={styles.input}
      />
    </View>
  );
}

export function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statVal}>{value}</Text>
    </View>
  );
}

export function Bar({ pct }: { pct: number }) {
  return (
    <View style={styles.bar}>
      <View style={[styles.barFill, { width: `${Math.max(0, Math.min(100, pct))}%` }]} />
    </View>
  );
}

export const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    marginBottom: 14,
  },
  label: { color: theme.dim, fontSize: 13, marginBottom: 6, fontWeight: '500' },
  input: {
    backgroundColor: theme.bg,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    color: theme.text,
    paddingHorizontal: 11,
    paddingVertical: 9,
    fontSize: 15,
  },
  stat: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 9,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  statLabel: { color: theme.text, fontSize: 14 },
  statVal: { color: theme.text, fontSize: 14, fontWeight: '700' },
  bar: { height: 8, borderRadius: 4, backgroundColor: theme.bg, overflow: 'hidden', marginTop: 4 },
  barFill: { height: '100%', backgroundColor: theme.accent },
  h1: { color: theme.text, fontSize: 22, fontWeight: '700', marginBottom: 4 },
  sub: { color: theme.dim, fontSize: 14, marginBottom: 16 },
  button: {
    backgroundColor: theme.accent,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
  },
  buttonText: { color: '#06210c', fontWeight: '700', fontSize: 15 },
});
