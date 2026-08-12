import { Image } from 'expo-image';
import { useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  clamp,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

const COLLAPSED_HEIGHT = 108;
const TAB_BAR_HEIGHT = 72;

const EXPAND_SPRING = {
  damping: 28,
  overshootClamping: true,
  stiffness: 240,
} as const;

type Surface = 'calendar' | 'todos';

export default function Index() {
  const [selectedSurface, setSelectedSurface] = useState<Surface>('calendar');
  const [isExpanded, setIsExpanded] = useState(false);
  const availableHeight = useSharedValue(0);
  const dockHeight = useSharedValue(COLLAPSED_HEIGHT);
  const dragStartHeight = useSharedValue(COLLAPSED_HEIGHT);

  const handleLayout = (event: LayoutChangeEvent) => {
    availableHeight.value = event.nativeEvent.layout.height;
  };

  const selectSurface = (surface: Surface) => {
    setSelectedSurface(surface);

    if (dockHeight.value < availableHeight.value * 0.5) {
      setIsExpanded(true);
      dockHeight.value = withSpring(availableHeight.value * 0.62, EXPAND_SPRING);
    }
  };

  const finishResize = (height: number) => {
    setIsExpanded(height > COLLAPSED_HEIGHT + 64);
  };

  const resizeGesture = Gesture.Pan()
    .minDistance(4)
    .onBegin(() => {
      dragStartHeight.value = dockHeight.value;
    })
    .onUpdate((event) => {
      dockHeight.value = clamp(
        dragStartHeight.value - event.translationY,
        COLLAPSED_HEIGHT,
        availableHeight.value,
      );
    })
    .onEnd(() => {
      if (dockHeight.value < COLLAPSED_HEIGHT + 90) {
        dockHeight.value = withSpring(COLLAPSED_HEIGHT, EXPAND_SPRING);
        scheduleOnRN(finishResize, COLLAPSED_HEIGHT);
        return;
      }

      scheduleOnRN(finishResize, dockHeight.value);
    });

  const dockStyle = useAnimatedStyle(() => ({
    height: dockHeight.value,
  }));

  const mainPanelStyle = useAnimatedStyle(() => ({
    bottom: Math.max(dockHeight.value - 20, 0),
  }));

  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      dockHeight.value,
      [COLLAPSED_HEIGHT + 70, COLLAPSED_HEIGHT + 150],
      [0, 1],
      Extrapolation.CLAMP,
    ),
    transform: [{
      translateY: interpolate(
        dockHeight.value,
        [COLLAPSED_HEIGHT, COLLAPSED_HEIGHT + 160],
        [22, 0],
        Extrapolation.CLAMP,
      ),
    }],
  }));

  const tabBarStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      dockHeight.value,
      [COLLAPSED_HEIGHT, COLLAPSED_HEIGHT + 100],
      [1, 0],
      Extrapolation.CLAMP,
    ),
    transform: [{
      translateY: interpolate(
        dockHeight.value,
        [COLLAPSED_HEIGHT, COLLAPSED_HEIGHT + 100],
        [0, 12],
        Extrapolation.CLAMP,
      ),
    }],
  }));

  const handleStyle = useAnimatedStyle(() => ({
    opacity: 1,
  }));

  return (
    <View style={styles.screen} onLayout={handleLayout}>
      <GestureDetector gesture={resizeGesture}>
        <Animated.View
          collapsable={false}
          style={[styles.dockShell, dockStyle]}
        >
          <Animated.View pointerEvents="none" style={[styles.handleContainer, handleStyle]}>
            <View style={styles.handle} />
          </Animated.View>

          <Animated.View pointerEvents="none" style={[styles.content, contentStyle]}>
            {selectedSurface === 'calendar' ? <CalendarSurface /> : <TodosSurface />}
          </Animated.View>

          <Animated.View
            pointerEvents={isExpanded ? 'none' : 'auto'}
            style={[styles.tabBar, tabBarStyle]}
          >
            <DockTab
              active={selectedSurface === 'calendar'}
              icon="sf:calendar"
              label="Calendar"
              onPress={() => selectSurface('calendar')}
            />

            <View style={styles.createSlot}>
              <Pressable
                accessibilityHint="Creating events will be added later"
                accessibilityLabel="Create"
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.createButton,
                  pressed && styles.pressedControl,
                ]}
              >
                <Image source="sf:plus" style={styles.createIcon} tintColor="#08080A" />
              </Pressable>
            </View>

            <DockTab
              active={selectedSurface === 'todos'}
              icon="sf:checklist"
              label="Todos"
              onPress={() => selectSurface('todos')}
            />
          </Animated.View>
        </Animated.View>
      </GestureDetector>

      <Animated.View
        pointerEvents="none"
        style={[styles.mainPanel, mainPanelStyle]}
      />
    </View>
  );
}

type DockTabProps = {
  active: boolean;
  icon: `sf:${string}`;
  label: string;
  onPress: () => void;
};

function DockTab({ active, icon, label, onPress }: DockTabProps) {
  const color = active ? '#FFFFFF' : '#8E8E93';

  return (
    <Pressable
      accessibilityLabel={`Show ${label}`}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.tab, pressed && styles.pressedControl]}
    >
      <Image source={icon} style={styles.tabIcon} tintColor={color} />
    </Pressable>
  );
}

function CalendarSurface() {
  return (
    <View style={styles.surface}>
      <Text style={styles.eyebrow}>JULY 2026</Text>
      <Text style={styles.title}>Calendar</Text>
      <View style={styles.placeholderRule} />
      <View style={styles.placeholderRuleShort} />
    </View>
  );
}

function TodosSurface() {
  return (
    <View style={styles.surface}>
      <Text style={styles.eyebrow}>TODAY</Text>
      <Text style={styles.title}>Todos</Text>
      <View style={styles.todoRow}>
        <View style={styles.todoCircle} />
        <View style={styles.todoLine} />
      </View>
      <View style={styles.todoRow}>
        <View style={styles.todoCircle} />
        <View style={[styles.todoLine, styles.todoLineShort]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#08080A',
  },
  mainPanel: {
    position: 'absolute',
    top: -60,
    right: 0,
    left: 0,
    overflow: 'hidden',
    borderBottomLeftRadius: 60,
    borderBottomRightRadius: 60,
    borderCurve: 'circular',
    backgroundColor: '#F7F6F3',
  },
  dockShell: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
    backgroundColor: '#08080A',
    boxShadow: '0 -10px 30px rgba(0, 0, 0, 0.16)',
  },
  content: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  surface: {
    flex: 1,
    paddingTop: 38,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  handleContainer: {
    position: 'absolute',
    top: 24,
    right: 0,
    left: 0,
    zIndex: 2,
    alignItems: 'center',
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(235, 235, 245, 0.42)',
  },
  eyebrow: {
    color: '#98989D',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  title: {
    paddingTop: 6,
    color: '#F5F5F7',
    fontSize: 38,
    fontWeight: '700',
    letterSpacing: -1.4,
  },
  placeholderRule: {
    width: '100%',
    height: StyleSheet.hairlineWidth,
    marginTop: 26,
    backgroundColor: 'rgba(235, 235, 245, 0.2)',
  },
  placeholderRuleShort: {
    width: '68%',
    height: StyleSheet.hairlineWidth,
    marginTop: 58,
    backgroundColor: 'rgba(235, 235, 245, 0.14)',
  },
  todoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 26,
  },
  todoCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#A1A1A8',
  },
  todoLine: {
    width: '68%',
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(235, 235, 245, 0.24)',
  },
  todoLineShort: {
    width: '48%',
  },
  tabBar: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    height: TAB_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tab: {
    flex: 1,
    height: 62,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
  },
  tabIcon: {
    width: 20,
    height: 20,
  },
  createSlot: {
    flex: 1,
    height: 62,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
  },
  createIcon: {
    width: 18,
    height: 18,
  },
  pressedControl: {
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
  },
});
