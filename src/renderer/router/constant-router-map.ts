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
        name: "工作流",
        component: () => import("@renderer/views/home/index.vue"),
      },
      {
        path: "setting",
        name: "设置",
        component: () => import("@renderer/views/setting/index.vue"),
      },
      {
        path: "landing",
        name: "总览",
        component: import("@renderer/views/landing/index.vue"),
      }
    ],
  },
  {
    path: "/login",
    name: "登录",
    component: () => import("@renderer/views/login/index.vue"),
  },
];

export default routes;
