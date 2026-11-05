import * as WebBrowser from 'expo-web-browser';
import { Linking, Pressable, Text, View, type TextStyle } from 'react-native';
import { useTheme } from '@/lib/theme';
import { Icon } from './Icon';

const URL_RE = /(https?:\/\/[^\s<>"')]+|www\.[^\s<>"')]+|[\w.+-]+@[\w-]+\.[\w.-]+)/g;

export function openLink(url: string) {
  if (/^(mailto:|tel:)/i.test(url)) return void Linking.openURL(url);
  void WebBrowser.openBrowserAsync(url.startsWith('www.') ? `https://${url}` : url);
}

/** Text with web addresses and emails made tappable. */
export function LinkedText({ children, style }: { children: string; style?: TextStyle }) {
  const c = useTheme();
  const parts = children.split(URL_RE);
  return (
    <Text style={style} selectable>
      {parts.map((p, i) => {
        if (i % 2 === 0) return p;
        const clean = p.replace(/[.,;:]+$/, '');
        const tail = p.slice(clean.length);
        const url = clean.includes('@') && !clean.startsWith('http') ? `mailto:${clean}` : clean;
        return (
          <Text key={i}>
            <Text accessibilityRole="link" onPress={() => openLink(url)} style={{ color: c.accent, textDecorationLine: 'underline', fontWeight: '600' }}>
              {clean}
            </Text>
            {tail}
          </Text>
        );
      })}
    </Text>
  );
}

/** The message's links as buttons (they are often lost in the plain text and translation). */
export function LinkList({ links }: { links?: { url: string; label: string }[] }) {
  const c = useTheme();
  if (!links?.length) return null;
  return (
    <View style={{ gap: 8 }}>
      {links.map((l) => (
        <Pressable
          key={l.url}
          onPress={() => openLink(l.url)}
          accessibilityRole="link"
          accessibilityHint={l.url}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: pressed ? c.accentSoft : c.card })}
        >
          <Icon name="send" size={16} color={c.accent} />
          <Text style={{ flex: 1, color: c.accent, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>
            {l.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
