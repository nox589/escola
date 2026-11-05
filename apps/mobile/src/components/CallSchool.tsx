import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Modal, Pressable, Text, View } from 'react-native';
import type { Child } from '@/lib/api';
import { firstName } from '@/lib/todo';
import { useTheme } from '@/lib/theme';
import { Icon } from './Icon';

const call = (phone: string) => void Linking.openURL(`tel:${phone.replace(/\s/g, '')}`);

/**
 * Round phone button. One school: calls it. Several: asks which. None known yet: opens the
 * child's page, where the number can be added.
 */
export function CallSchoolButton({ kids, size = 44 }: { kids: Child[]; size?: number }) {
  const { t } = useTranslation();
  const c = useTheme();
  const [choose, setChoose] = useState(false);
  const schools = [...new Map(kids.filter((k) => k.schoolPhone).map((k) => [k.schoolPhone!, k])).values()];
  const press = () => {
    if (schools.length === 1) return call(schools[0]!.schoolPhone!);
    if (schools.length > 1) return setChoose(true);
    if (kids[0]) router.push({ pathname: '/child/[id]', params: { id: kids[0].id } });
  };
  return (
    <>
      <Pressable
        onPress={press}
        accessibilityRole="button"
        accessibilityLabel={t('cl.callSchool')}
        style={({ pressed }) => ({
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? c.accentSoft : 'transparent',
        })}
      >
        <Icon name="phone" color={c.accent} />
      </Pressable>
      <Modal visible={choose} transparent animationType="fade" onRequestClose={() => setChoose(false)}>
        <Pressable
          onPress={() => setChoose(false)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' }}
        >
          <View
            style={{
              backgroundColor: c.bg,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: 20,
              gap: 10,
            }}
          >
            <Text style={{ color: c.ink, fontSize: 17, fontWeight: '700' }}>{t('cl.whichSchool')}</Text>
            {schools.map((k) => (
              <Pressable
                key={k.schoolPhone}
                onPress={() => {
                  setChoose(false);
                  call(k.schoolPhone!);
                }}
                accessibilityRole="button"
                style={{
                  minHeight: 52,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: c.line,
                  backgroundColor: c.card,
                  paddingHorizontal: 14,
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: c.ink, fontSize: 15, fontWeight: '700' }}>
                  {k.schoolName ?? firstName(k.displayName)}
                </Text>
                <Text style={{ color: c.muted, fontSize: 13 }}>
                  {kids
                    .filter((x) => x.schoolPhone === k.schoolPhone)
                    .map((x) => firstName(x.displayName))
                    .join(', ')}{' '}
                  · {k.schoolPhone}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
