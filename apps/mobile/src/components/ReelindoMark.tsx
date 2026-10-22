import Svg, { Circle, Path } from 'react-native-svg';
export function ReelindoMark({ size = 64 }: { size?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 100 100"><Circle cx="50" cy="50" r="45" fill="#0E9F95" /><Circle cx="50" cy="50" r="34" fill="none" stroke="#55C9BC" strokeWidth="5" strokeDasharray="4 8" /><Path d="M43 30c-3-2-7 0-7 4v32c0 4 4 6 7 4l25-16c3-2 3-6 0-8L43 30Z" fill="#fff" /></Svg>;
}
