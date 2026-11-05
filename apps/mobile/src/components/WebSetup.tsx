import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, Text, View } from 'react-native';
import { enableWebPush, refreshWebPush, webPushState, type WebPushState } from '@/lib/webPush';
import { space, useTheme } from '@/lib/theme';
import { Icon } from './Icon';

const DISMISS_KEY = 'clases.setupDismissed';
const dismissed = () => {
  try {
    return globalThis.localStorage?.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * Web beta only: on iPhone Safari, explains "Add to Home Screen" (needed to stay signed in and get
 * notifications); once installed, offers to turn notifications on.
 */
export function WebSetup() {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const [state, setState] = useState<WebPushState>('unsupported');
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    setState(webPushState());
    setHidden(dismissed());
    void refreshWebPush(i18n.language);
  }, [i18n.language]);

  if (Platform.OS !== 'web' || (state !== 'needs-install' && state !== 'default')) return null;
  if (state === 'needs-install' && hidden) return null;

  const dismiss = () => {
    try {
      globalThis.localStorage?.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    setHidden(true);
  };
  const turnOn = async () => {
    setBusy(true);
    await enableWebPush(i18n.language).catch(() => false);
    setState(webPushState());
    setBusy(false);
  };

  return (
    <View
      style={{
        backgroundColor: c.card,
        borderWidth: 1,
        borderColor: c.accent,
        borderRadius: 16,
        padding: space.l,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={state === 'needs-install' ? 'home' : 'clock'} size={18} color={c.accent} />
        <Text style={{ color: c.ink, fontSize: 16, fontWeight: '700', flex: 1 }}>
          {state === 'needs-install' ? t('cl.setup.installTitle') : t('cl.setup.notifyTitle')}
        </Text>
        {state === 'needs-install' ? (
          <Pressable
            onPress={dismiss}
            accessibilityRole="button"
            accessibilityLabel={t('cl.setup.later')}
            style={{ minHeight: 32, paddingHorizontal: 6, justifyContent: 'center' }}
          >
            <Text style={{ color: c.muted, fontWeight: '600' }}>{t('cl.setup.later')}</Text>
          </Pressable>
        ) : null}
      </View>
      {state === 'needs-install' ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: c.ink, fontSize: 14, lineHeight: 20 }}>{t('cl.setup.step1')}</Text>
          <Text style={{ color: c.ink, fontSize: 14, lineHeight: 20 }}>{t('cl.setup.step2')}</Text>
          <Text style={{ color: c.ink, fontSize: 14, lineHeight: 20 }}>{t('cl.setup.step3')}</Text>
          <Text style={{ color: c.muted, fontSize: 13, lineHeight: 18 }}>{t('cl.setup.why')}</Text>
        </View>
      ) : (
        <>
          <Text style={{ color: c.ink, fontSize: 14, lineHeight: 20 }}>{t('cl.setup.notifyBody')}</Text>
          <Pressable
            onPress={() => void turnOn()}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => ({
              minHeight: 46,
              borderRadius: 12,
              backgroundColor: pressed ? c.accentPressed : c.accent,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: busy ? 0.6 : 1,
            })}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>
              {t('cl.setup.notifyButton')}
            </Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
