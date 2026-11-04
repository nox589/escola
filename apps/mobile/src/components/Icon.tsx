import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'home'
  | 'calendar'
  | 'gear'
  | 'search'
  | 'back'
  | 'chevron'
  | 'clock'
  | 'file'
  | 'check'
  | 'send'
  | 'alert'
  | 'sparkle';

/** Stroke icons drawn to match the clases mockup. Decorative unless given a label by the parent. */
export function Icon({ name, size = 22, color = '#203B39', strokeWidth = 2 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const p = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {name === 'home' ? (
        <>
          <Path d="M3 11 12 4l9 7" {...p} />
          <Path d="M5 10v10h14V10" {...p} />
        </>
      ) : name === 'calendar' ? (
        <>
          <Rect x={3} y={5} width={18} height={16} rx={3} {...p} />
          <Path d="M3 10h18M8 3v4M16 3v4" {...p} />
        </>
      ) : name === 'gear' ? (
        <>
          <Circle cx={12} cy={12} r={3} {...p} />
          <Path
            d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
            {...p}
            strokeWidth={strokeWidth * 0.9}
          />
        </>
      ) : name === 'search' ? (
        <>
          <Circle cx={11} cy={11} r={7} {...p} />
          <Path d="m20 20-3.5-3.5" {...p} />
        </>
      ) : name === 'back' ? (
        <Path d="m15 18-6-6 6-6" {...p} />
      ) : name === 'chevron' ? (
        <Path d="m9 18 6-6-6-6" {...p} />
      ) : name === 'clock' ? (
        <>
          <Circle cx={12} cy={12} r={9} {...p} />
          <Path d="M12 7v5l3 2" {...p} />
        </>
      ) : name === 'file' ? (
        <>
          <Path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" {...p} />
          <Path d="M14 3v5h5" {...p} />
        </>
      ) : name === 'check' ? (
        <Path d="m5 12 5 5 9-10" {...p} />
      ) : name === 'alert' ? (
        <>
          <Circle cx={12} cy={12} r={9} {...p} />
          <Path d="M12 7.5v5.5M12 16.5v.01" {...p} />
        </>
      ) : name === 'send' ? (
        <Path d="M5 12h14M13 6l6 6-6 6" {...p} />
      ) : (
        <Path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" {...p} />
      )}
    </Svg>
  );
}
