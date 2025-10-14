import { createApp } from "vue";
import { createPinia } from "pinia";

import "./styles/index.scss";
import "./styles/tailwind.css";
import "./router/permission";
import "./hooks/index"
import App from "./App.vue";
import router from "./router";
import { errorHandler } from "./error";
import "./utils/hackIpcRenderer";

const app = createApp(App);
const store = createPinia();
app.use(router);
app.use(store);
errorHandler(app);

app.mount("#app");
