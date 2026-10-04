import type { StyleProp, ViewStyle } from 'react-native';

declare module 'react-native' {
  interface ViewProps {
    style?: StyleProp<ViewStyle> | undefined;
  }
  interface ScrollViewProps {
    contentContainerStyle?: StyleProp<ViewStyle> | undefined;
  }
}
