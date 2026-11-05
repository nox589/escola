import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackLink } from '@/components/Clases';
import { api } from '@/lib/api';
import { space, useTheme } from '@/lib/theme';

// Served with the app (copied from pdfjs-dist by scripts/build-web.sh), no third-party CDN.
const PDFJS = '/pdfjs/pdf.min.js';
const PDFJS_WORKER = '/pdfjs/pdf.worker.min.js';

type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => {
    promise: Promise<void>;
  };
};
type PdfLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { data: Uint8Array }) => {
    promise: Promise<{ numPages: number; getPage: (n: number) => Promise<PdfPage> }>;
  };
};

let pdfjs: Promise<PdfLib> | null = null;
function loadPdfJs(): Promise<PdfLib> {
  pdfjs ??= new Promise((resolve, reject) => {
    const w = window as unknown as { pdfjsLib?: PdfLib };
    if (w.pdfjsLib) return resolve(w.pdfjsLib);
    const s = document.createElement('script');
    s.src = PDFJS;
    s.onload = () => {
      w.pdfjsLib!.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      resolve(w.pdfjsLib!);
    };
    s.onerror = () => {
      pdfjs = null;
      reject(new Error('pdf viewer failed to load'));
    };
    document.head.appendChild(s);
  });
  return pdfjs;
}

/**
 * Opens a school document inside MiCole. Web (the beta): PDF pages are drawn in the app with
 * pdf.js; images are shown directly. Native: the in-app browser sheet, which stays in the app.
 */
export default function Doc() {
  const { id, name, file } = useLocalSearchParams<{ id: string; name?: string; file?: string }>();
  const { t } = useTranslation();
  const c = useTheme();
  const box = useRef<ComponentRef<typeof View>>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const isImage = /\.(png|jpe?g|gif|webp)$/i.test(file ?? name ?? '');

  useEffect(() => {
    let dead = false;
    void (async () => {
      try {
        const r = await api<{ url: string }>(`/attachments/${id}/url`);
        if (dead) return;
        setUrl(r.url);
        if (Platform.OS !== 'web') {
          await WebBrowser.openBrowserAsync(r.url);
          return setState('ready');
        }
        if (isImage) return setState('ready');
        const [lib, bytes] = await Promise.all([
          loadPdfJs(),
          fetch(r.url).then((x) => (x.ok ? x.arrayBuffer() : Promise.reject(new Error(String(x.status))))),
        ]);
        const doc = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
        const host = box.current as unknown as HTMLElement | null;
        if (!host || dead) return;
        host.innerHTML = '';
        const width = Math.min(host.clientWidth || 360, 900);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let n = 1; n <= doc.numPages && !dead; n++) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: (width / base.width) * dpr });
          const canvas = document.createElement('canvas');
          canvas.width = vp.width;
          canvas.height = vp.height;
          Object.assign(canvas.style, {
            width: `${width}px`,
            height: `${vp.height / dpr}px`,
            display: 'block',
            margin: '0 auto 12px',
            borderRadius: '8px',
            background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
          });
          canvas.setAttribute('aria-label', `${name ?? ''} ${n}/${doc.numPages}`);
          host.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
          if (n === 1) setState('ready');
        }
        setState('ready');
      } catch (e) {
        console.warn('document viewer:', e instanceof Error ? e.message : e);
        if (!dead) setState('error');
      }
    })();
    return () => {
      dead = true;
    };
  }, [id, isImage, name]);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: c.bg }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: space.l,
          borderBottomWidth: 1,
          borderBottomColor: c.line,
        }}
      >
        <BackLink label={t('common.back')} />
        <Text style={{ flex: 1, color: c.ink, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
          {name ?? ''}
        </Text>
        {url ? (
          <Pressable
            onPress={() => void WebBrowser.openBrowserAsync(url)}
            accessibilityRole="link"
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={{ color: c.accent, fontWeight: '700', fontSize: 14 }}>{t('cl.doc.download')}</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={{ padding: space.m, flexGrow: 1 }}>
        {state === 'loading' ? <ActivityIndicator color={c.accent} style={{ marginTop: 40 }} /> : null}
        {state === 'error' ? (
          <View style={{ alignItems: 'center', gap: 12, marginTop: 40 }}>
            <Text style={{ color: c.mutedOnBg, textAlign: 'center' }}>{t('cl.doc.error')}</Text>
            {url ? (
              <Pressable
                onPress={() => void WebBrowser.openBrowserAsync(url)}
                accessibilityRole="link"
                style={{ minHeight: 44, justifyContent: 'center' }}
              >
                <Text style={{ color: c.accent, fontWeight: '700' }}>{t('cl.doc.download')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {isImage && url ? (
          <Image
            source={{ uri: url }}
            accessibilityLabel={name ?? ''}
            style={{ width: '100%', aspectRatio: 0.75 }}
            resizeMode="contain"
          />
        ) : null}
        <View ref={box} style={{ width: '100%' }} />
      </ScrollView>
    </SafeAreaView>
  );
}
