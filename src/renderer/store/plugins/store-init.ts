import type { PiniaPluginContext } from 'pinia';

export function storeInitPlugin({ store }: PiniaPluginContext) {
  if (store.$id === 'user') {
    store.init(); // 调用 store 的初始化 action
  }
}
