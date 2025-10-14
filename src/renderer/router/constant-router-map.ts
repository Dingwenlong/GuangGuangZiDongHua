import type { RouteRecordRaw } from "vue-router";
import Layout from "@renderer/components/layout/index.vue";

const routes: Array<RouteRecordRaw> = [
  {
    path: "/:pathMatch(.*)*",
    component: () => import("@renderer/views/404.vue"),
  },
  {
    path: "/",
    component: Layout,
    meta: { requiresAuth: true },
    children: [
      {
        path: "",
        name: "总览",
        component: import("@renderer/views/landing-page/LandingPage.vue"),
      },
    ],
  },
  {
    path: "/login",
    name: "登录",
    component: () => import("@renderer/views/login-page/index.vue"),
  },
  {
    path: "/setting",
    name: "设置",
    component: () => import("@renderer/views/setting-page/index.vue"),
  },
];

export default routes;
