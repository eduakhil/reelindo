import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { Screen } from './Screen';

jest.mock('@/src/theme/useAppTheme', () => ({
  useAppTheme: () => ({ colors: { background: '#000000' } }),
}));

describe('Screen', () => {
  it('renders its children and forwards view props', async () => {
    const { getByTestId, getByText } = await render(<Screen testID="screen-root"><Text>Feed is ready</Text></Screen>);
    expect(getByTestId('screen-root')).toBeTruthy();
    expect(getByText('Feed is ready')).toBeTruthy();
  });

  it('supports an interactive child control', async () => {
    const onPress = jest.fn();
    const { getByRole } = await render(<Screen><Text accessibilityRole="button" onPress={onPress}>Open feed</Text></Screen>);
    fireEvent.press(getByRole('button', { name: 'Open feed' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
