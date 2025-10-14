import { createRouter, createWebHashHistory } from "vue-router";
import routerMap from "./constant-router-map";

const router = createRouter({
  history: createWebHashHistory(),
  routes: routerMap,
});
export default router;
