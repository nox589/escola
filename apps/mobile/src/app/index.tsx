import { Redirect } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loading } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useAccounts, useConsents, useMe } from '@/lib/hooks';

/** Routes the user to the right step: sign in → consent → link GestIB → home. */
export default function Index() {
  const tokens = useAuth((s) => s.tokens);
  const { i18n } = useTranslation();
  const me = useMe();
  const consents = useConsents();
  const accounts = useAccounts();

  useEffect(() => {
    if (me.data?.locale && me.data.locale !== i18n.language) void i18n.changeLanguage(me.data.locale);
  }, [me.data?.locale, i18n]);

  if (!tokens) return <Redirect href="/welcome" />;
  if (me.isLoading || consents.isLoading || accounts.isLoading) return <Loading />;
  if (me.isError) return <Redirect href="/welcome" />;
  if (!consents.data?.some((c) => c.kind === 'mandate_read')) return <Redirect href="/consent" />;
  if (!accounts.data?.length) return <Redirect href="/link-gestib" />;
  return <Redirect href="/(tabs)" />;
}
