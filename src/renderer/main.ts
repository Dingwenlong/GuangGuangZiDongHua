import { createApp } from 'vue';
import { createPinia } from 'pinia';

import './styles/index.scss';
import './styles/tailwind.css';
import './router/permission';
import './hooks/index';
import App from './App.vue';
import router from './router';
import { errorHandler } from './error';
import './utils/hack-ipc-renderer';
import { storeInitPlugin } from './store/plugins/store-init';

const app = createApp(App);
const pinia = createPinia();
pinia.use(storeInitPlugin);
app.use(router);
app.use(pinia);
errorHandler(app);

app.mount('#app');
