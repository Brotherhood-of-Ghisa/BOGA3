import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Card, FigureText, uiSpace, uiText } from '@/components/ui';
import { useDateFormat } from '@/src/preferences/hooks';
import type { CoWStreamItemWire } from '@/src/groups/competition-wire';
import { buildCoWStreamCard } from '@/src/groups/cow-stream-view-model';

/** A lifecycle snapshot opens its exact CoW, including cancelled/replaced weeks. */
export function CoWStreamCard({ item,userId }: { item: CoWStreamItemWire; userId: string | null }) {
  const router=useRouter();
  const model=buildCoWStreamCard(item,userId,useDateFormat());
  return <Card style={styles.card} accessibilityLabel={model.accessibilityLabel} onPress={() => router.push(model.path)} testID={`cow-stream-${item.key}`}>
    <View style={styles.heading}>
      <Text allowFontScaling={false} style={uiText.label}>{model.label}</Text>
      <Text allowFontScaling={false} style={[uiText.meta, styles.date]}><FigureText>{model.date}</FigureText></Text>
    </View>
    <Text allowFontScaling={false} style={uiText.bodyStrong}>{model.exercise}</Text>
    <Text allowFontScaling={false} style={[uiText.meta, styles.date]}><FigureText>{model.week}</FigureText></Text>
    {model.details.map((line,index) => <Text allowFontScaling={false} key={index} style={uiText.body}><FigureText>{line}</FigureText></Text>)}
  </Card>;
}
const styles=StyleSheet.create({
  card: { padding: uiSpace.md },
  heading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: uiSpace.xs, marginBottom: uiSpace.xs },
  date: { marginLeft: 'auto', textAlign: 'right' },
});
