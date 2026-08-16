import { useCssElement } from 'react-native-css';
import type { ComponentProps, ComponentType, ReactElement } from 'react';
import {
  Pressable as RNPressable,
  Text as RNText,
  View as RNView,
} from 'react-native';

type WithClassName<T> = T & { className?: string };

export function View(props: WithClassName<ComponentProps<typeof RNView>>) {
  return useCssElement(RNView, props, { className: 'style' }) as ReactElement;
}

export function Text(props: WithClassName<ComponentProps<typeof RNText>>) {
  return useCssElement(RNText, props, { className: 'style' }) as ReactElement;
}

export function Pressable(props: WithClassName<ComponentProps<typeof RNPressable>>) {
  return useCssElement(
    RNPressable as unknown as ComponentType<Record<string, unknown>>,
    props as Record<string, unknown>,
    { className: 'style' },
  ) as ReactElement;
}
