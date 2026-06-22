import { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { calcEquity, parseRange, rangeToCombos, type PlayerSpec } from '@gto/engine';
import { Bar, Card, Field, StatRow, styles } from '../components/ui';
import { theme } from '../theme';

function specFor(input: string): PlayerSpec {
  const t = input.trim();
  if (/^([2-9TJQKA][cdhs]){2}$/i.test(t)) return { cards: t };
  const combos = rangeToCombos(parseRange(t)).map((x) => x.combo);
  if (!combos.length) throw new Error(`해석 불가: "${input}"`);
  return { combos };
}

export default function EquityScreen() {
  const [hero, setHero] = useState('AsKs');
  const [villain, setVillain] = useState('QQ-99, AQs+');
  const [board, setBoard] = useState('');
  const [result, setResult] = useState<{ eq: number[]; iters: number } | null>(null);
  const [error, setError] = useState('');

  function run() {
    setError('');
    try {
      const res = calcEquity([specFor(hero), specFor(villain)], {
        board: board.trim() || undefined,
        iterations: 15000,
        seed: 12345,
      });
      setResult({ eq: res.equities, iters: res.iterations });
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.h1}>에쿼티 계산기</Text>
      <Text style={styles.sub}>핸드(AsKs) 또는 레인지(QQ-99, AQs+)를 입력하세요.</Text>

      <Card>
        <Field label="히어로" value={hero} onChangeText={setHero} />
        <Field label="빌런" value={villain} onChangeText={setVillain} />
        <Field label="보드 (선택)" value={board} onChangeText={setBoard} placeholder="Ah7d2c" />
        <TouchableOpacity style={styles.button} onPress={run}>
          <Text style={styles.buttonText}>에쿼티 계산</Text>
        </TouchableOpacity>
        {error ? <Text style={{ color: theme.danger, marginTop: 10 }}>{error}</Text> : null}
      </Card>

      {result && (
        <Card>
          <Text style={[styles.h1, { fontSize: 17 }]}>
            결과 ({result.iters.toLocaleString()} 시뮬)
          </Text>
          {['히어로', '빌런'].map((label, i) => (
            <View key={i} style={{ marginTop: 10 }}>
              <StatRow label={label} value={`${(result.eq[i] * 100).toFixed(2)}%`} />
              <Bar pct={result.eq[i] * 100} />
            </View>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}
