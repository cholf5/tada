import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

type PointerActivator = (typeof PointerSensor.activators)[number];

/**
 * PointerSensor 的鼠标版本：触摸事件交给 TouchSensor。
 *
 * 两个传感器都监听时会抢手势——PointerSensor 只要移动几像素就启动，
 * 于是触摸用户在侧栏里想滚动列表却触发了拖拽。这里让 PointerSensor
 * 忽略 touch，触摸统一走 TouchSensor 的「长按 220ms 再拖」。
 */
const mouseOnlyPointerActivators = PointerSensor.activators.map((activator: PointerActivator) => ({
  eventName: activator.eventName,
  handler: (event: ReactPointerEvent, options: Parameters<PointerActivator['handler']>[1]) => {
    const pointerType = (event.nativeEvent as unknown as { pointerType?: string }).pointerType;
    if (pointerType === 'touch') return false;
    return activator.handler(event, options);
  },
}));

class MousePointerSensor extends PointerSensor {
  static activators = mouseOnlyPointerActivators;
}

/**
 * 桌面用 PointerSensor（移动 6px 才启动，普通点击不受影响），
 * 触摸用 TouchSensor（长按 220ms 再拖，避免和列表滚动抢手势），
 * 键盘用 KeyboardSensor（空格拾起、方向键移动）。
 */
export function useSortableSensors() {
  return useSensors(
    useSensor(MousePointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}
