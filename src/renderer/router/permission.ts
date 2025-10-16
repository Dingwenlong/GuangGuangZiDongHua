import router from '.'
import Performance from '@renderer/utils/performance'
import { useStoreUserWithOut } from "@renderer/store/modules/user";

const storeUser = useStoreUserWithOut();

router.beforeEach(async (to, from, next) => {
  var end: Function | null = Performance.startExecute(`${from.path} => ${to.path} 路由耗时`) /// 路由性能监控
  if (to.matched.some((record) => record.meta.requiresAuth)) {
    const loginState = await storeUser.loginState();
    if (!loginState) {
      next({
        path: "/login"
      });
    } else {
      next(); // 登录状态验证通过，继续路由跳转
    }
  } else {
    next(); // 如果路由不需要验证，则直接跳转
  }
  setTimeout(() => {
    end!()
    end = null
  }, 0)
})

router.afterEach(() => {})
