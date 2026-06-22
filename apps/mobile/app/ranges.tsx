import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { allGridLabels, parseRange, rangePercent } from '@gto/engine';
import { Card, Field, StatRow, styles } from '../components/ui';
import { theme } from '../theme';

export default function RangesScreen() {
  const [input, setInput] = useState('55+, ATs+, KQs, AQo+, KQo');

  const { range, percent, error } = useMemo(() => {
    try {
      const r = parseRange(input);
      return { range: r, percent: rangePercent(r), error: '' };
    } catch (e) {
      return { range: new Map<string, number>(), percent: 0, error: (e as Error).message };
    }
  }, [input]);

  const labels = allGridLabels();

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.h1}>레인지 뷰어</Text>
      <Text style={styles.sub}>22+, ATs+, A5s-A2s, AKo 표기 지원</Text>

      <Card>
        <Field label="레인지" value={input} onChangeText={setInput} />
        {error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}
      </Card>

      <Card>
        <StatRow label="핸드 비중" value={`${percent.toFixed(1)}%`} />
        <StatRow label="그리드 셀" value={`${range.size} / 169`} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 }}>
          {labels.map((label) => {
            const on = (range.get(label) ?? 0) > 0;
            return (
              <View
                key={label}
                style={{
                  width: `${100 / 13}%`,
                  aspectRatio: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: on ? theme.accent : theme.elevated,
                  borderColor: theme.bg,
                  borderWidth: 1,
                }}
              >
                <Text
                  style={{
                    fontSize: 8,
                    fontWeight: '600',
                    color: on ? '#06210c' : theme.dim,
                  }}
                >
                  {label}
                </Text>
              </View>
            );
          })}
        </View>
      </Card>
    </ScrollView>
  );
}
