import { useEffect, useRef } from 'react';
import { useNavigation } from 'expo-router';

type TabPressNavigation = {
  addListener: (event: 'tabPress', listener: () => void) => () => void;
  isFocused: () => boolean;
};

export function useTabScrollToTop(scrollToTop: () => void) {
  const navigation = useNavigation<TabPressNavigation>();
  const scrollToTopRef = useRef(scrollToTop);
  scrollToTopRef.current = scrollToTop;

  useEffect(() => navigation.addListener('tabPress', () => {
    if (navigation.isFocused()) scrollToTopRef.current();
  }), [navigation]);
}
