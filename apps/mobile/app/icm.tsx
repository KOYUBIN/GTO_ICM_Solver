import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { icm, riskPremium } from '@gto/engine';
import { Bar, Card, Field, StatRow, styles } from '../components/ui';
import { theme } from '../theme';

function parseNums(s: string): number[] {
  return s
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => !Number.isNaN(n));
}

export default function IcmScreen() {
  const [stacksStr, setStacksStr] = useState('5000, 3000, 1500, 500');
  const [payoutsStr, setPayoutsStr] = useState('50, 30, 20');

  const stacks = useMemo(() => parseNums(stacksStr), [stacksStr]);
  const payouts = useMemo(() => parseNums(payoutsStr), [payoutsStr]);

  const result = useMemo(
    () => (stacks.length >= 2 && payouts.length >= 1 ? icm(stacks, payouts) : null),
    [stacks, payouts],
  );
  const rp = useMemo(
    () =>
      stacks.length >= 2
        ? riskPremium(stacks, payouts, 0, 1, Math.min(stacks[0], stacks[1]))
        : null,
    [stacks, payouts],
  );
  const totalPrize = payouts.reduce((a, b) => a + b, 0);

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.h1}>ICM 계산기</Text>
      <Text style={styles.sub}>Malmuth-Harville 모델 · 버블 리스크 프리미엄</Text>

      <Card>
        <Field label="스택 (쉼표 구분)" value={stacksStr} onChangeText={setStacksStr} />
        <Field label="상금 구조 (쉼표 구분)" value={payoutsStr} onChangeText={setPayoutsStr} />
      </Card>

      {result && (
        <Card>
          <Text style={[styles.h1, { fontSize: 17 }]}>플레이어별 ICM 기대값</Text>
          {result.equities.map((eq, i) => {
            const pct = totalPrize ? (eq / totalPrize) * 100 : 0;
            return (
              <View key={i} style={{ marginTop: 10 }}>
                <StatRow
                  label={`P${i + 1} · ${stacks[i].toLocaleString()} 칩`}
                  value={`${eq.toFixed(2)} (${pct.toFixed(1)}%)`}
                />
                <Bar pct={pct} />
              </View>
            );
          })}
        </Card>
      )}

      {rp !== null && (
        <Card>
          <Text style={[styles.h1, { fontSize: 17 }]}>버블 리스크 프리미엄</Text>
          <StatRow label="리스크 프리미엄" value={`${(rp * 100).toFixed(2)}%p`} />
          <StatRow label="필요 콜 에쿼티" value={`${((0.5 + rp) * 100).toFixed(1)}%`} />
        </Card>
      )}
    </ScrollView>
  );
}
