import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

export type AppIconName = 'home' | 'search' | 'create' | 'inbox' | 'profile' | 'settings' | 'grid' | 'play' | 'camera' | 'send' | 'back' | 'heart' | 'comment' | 'bookmark';

export function AppIcon({ name, color, size = 24, filled = false }: { name: AppIconName; color: string; size?: number; filled?: boolean }) {
  const fill = filled ? color : 'none';
  const common = { stroke: color, strokeWidth: filled ? 2.4 : 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
    {name === 'home' ? <Path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" {...common} fill={fill} /> : null}
    {name === 'search' ? <><Circle cx="10.8" cy="10.8" r="6.8" {...common} /><Line x1="16" y1="16" x2="21" y2="21" {...common} /></> : null}
    {name === 'create' ? <><Rect x="3" y="3" width="18" height="18" rx="5" {...common} /><Line x1="12" y1="7" x2="12" y2="17" {...common} /><Line x1="7" y1="12" x2="17" y2="12" {...common} /></> : null}
    {name === 'inbox' ? <><Path d="M4 5.5h16v13H4z" {...common} fill={fill} /><Path d="M4 13h4l1.5 2h5L16 13h4" {...common} /></> : null}
    {name === 'profile' ? <><Circle cx="12" cy="8" r="3.5" {...common} fill={fill} /><Path d="M4.5 21a7.5 7.5 0 0 1 15 0" {...common} /></> : null}
    {name === 'settings' ? <><Circle cx="12" cy="12" r="3" {...common} /><Path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.5.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.5-.9l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.8l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.5-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.5.9l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 1.7Z" {...common} /></> : null}
    {name === 'grid' ? <><Rect x="4" y="4" width="6" height="6" rx="1" {...common} /><Rect x="14" y="4" width="6" height="6" rx="1" {...common} /><Rect x="4" y="14" width="6" height="6" rx="1" {...common} /><Rect x="14" y="14" width="6" height="6" rx="1" {...common} /></> : null}
    {name === 'play' ? <><Rect x="3" y="3" width="18" height="18" rx="5" {...common} /><Path d="m10 8 6 4-6 4z" {...common} fill={filled ? color : 'none'} /></> : null}
    {name === 'camera' ? <><Path d="M4 7h3l1.5-2h7L17 7h3v13H4z" {...common} /><Circle cx="12" cy="13" r="3.5" {...common} /></> : null}
    {name === 'send' ? <Path d="m21 3-7.5 18-3.2-7.3L3 10.5zM10.3 13.7 21 3" {...common} fill={fill} /> : null}
    {name === 'back' ? <Path d="m15 18-6-6 6-6M9 12h12" {...common} /> : null}
    {name === 'heart' ? <Path d="M20.8 8.8c0 4.2-8.8 10-8.8 10s-8.8-5.8-8.8-10A4.6 4.6 0 0 1 12 6.4a4.6 4.6 0 0 1 8.8 2.4Z" {...common} fill={fill} /> : null}
    {name === 'comment' ? <Path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.6 8.6 0 0 1-3.6-.8L4 20l1.3-3.8A7.1 7.1 0 0 1 4 11.5 7.5 7.5 0 0 1 12 4a7.5 7.5 0 0 1 8 7.5Z" {...common} /> : null}
    {name === 'bookmark' ? <Path d="M6 4h12v17l-6-4-6 4z" {...common} fill={fill} /> : null}
  </Svg>;
}
