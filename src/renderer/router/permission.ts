import router from '.'
import Performance from '@renderer/utils/performance'
import { useStoreUserWithOut } from "@renderer/store/modules/user";

const storeUser = useStoreUserWithOut();
var end: Function | null = null

router.beforeEach(async (to, from, next) => {
  end = Performance.startExecute(`${from.path} => ${to.path} 路由耗时`) /// 路由性能监控
  if (to.matched.some((record) => record.meta.requiresAuth)) {
    const loginState = await storeUser.loginState();
    console.log("router.beforeEach.检查用户是否已登录", loginState);
    if (!loginState) {
      next({
        path: "/login",
        query: { redirect: to.fullPath }, // 保存要跳转的路由地址
      });
    } else {
      next(); // 登录状态验证通过，继续路由跳转
    }
  } else {
    next(); // 如果路由不需要验证，则直接跳转
  }
  setTimeout(() => {
    end!()
  }, 0)
})

router.afterEach(() => {})
