import { useCssElement } from 'react-native-css';
import type { ComponentProps, ComponentType, ReactElement } from 'react';
import {
  Pressable as RNPressable,
  Text as RNText,
  View as RNView,
} from 'react-native';

type WithClassName<T> = T & { className?: string };

export function View(props: WithClassName<ComponentProps<typeof RNView>>) {
  return useCssElement(RNView as ComponentType<any>, props, { className: 'style' }) as ReactElement;
}

export function Text(props: WithClassName<ComponentProps<typeof RNText>>) {
  return useCssElement(RNText as ComponentType<any>, props, { className: 'style' }) as ReactElement;
}

export function Pressable(props: WithClassName<ComponentProps<typeof RNPressable>>) {
  return useCssElement(RNPressable as ComponentType<any>, props, { className: 'style' }) as ReactElement;
}
