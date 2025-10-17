<template>
  <div class="select-none drag flex justify-between w-[calc(100%-136px)] h-40 text-center text-white text-[14px] z-99999" v-if="!IsUseSysTitle && isNotMac && !IsWeb">
    <div class="flex items-center">
      <div class="w-28 ml-20 mr-5">
        <img src="@renderer/assets/icons/svg/meike-logo.svg" class="fill-current overflow-hidden" />
      </div>{{ i18nt.appTitle }}
    </div>
    <div class="no-drag flex items-center gap-8 text-xs leading-tight px-5 border-r">
      <div class="h-2/3 flex items-center rounded-sm gap-4 px-4 transition-all hover:bg-white/30">
        <img :src="NavUser" alt="用户" class="h-[18px] w-[18px] rounded-full" />
        {{userStore.userData?.realName}}&nbsp;&nbsp;{{userStore.userData?.mobile}}
      </div>
      <div
          class="h-2/3 flex cursor-pointer items-center rounded-sm gap-4 px-4 transition-all hover:bg-white/30"
          @click="handleLogout"
        >
          <img :src="NavLogout" alt="登出" class="h-[18px] w-[18px]" />登出
        </div>
      <div
        class="h-2/3 flex cursor-pointer items-center rounded-sm gap-4 px-4 transition-all hover:bg-white/30"
        @click="handleSetting"
      >
        <SettingFilled />设置
      </div>
      <div
        class="h-2/3 flex cursor-pointer items-center rounded-sm px-4 transition-all hover:bg-white/30"
        @click="() => ipcRendererChannel.OpenDevTools.invoke()"
      >
        <img :src="NavLBug" alt="调试" width="16" height="16" />
      </div>
    </div>
  </div>
  <div v-else-if="!IsUseSysTitle && !isNotMac" class="select-none drag flex fixed top-0 w-full h-40 z-99999"></div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { i18nt } from "@renderer/i18n";
import { SettingFilled } from '@ant-design/icons-vue';
import { useStoreUser } from "@renderer/store/modules/user"
import NavUser from '@renderer/assets/icons/webp/layout-nav-user.webp';
import NavLogout from '@renderer/assets/icons/webp/layout-nav-logout.webp';
import NavLBug from '@renderer/assets/icons/png/layout-nav-bug.png';

const { ipcRendererChannel, systemInfo } = window;

const userStore = useStoreUser();
const IsUseSysTitle = ref(false);
const mix = ref(false);
const isNotMac = ref(false);
const IsWeb = ref(Boolean(__ISWEB__));
const creating = ref(false);

if (systemInfo) isNotMac.value = systemInfo.platform !== "darwin";

ipcRendererChannel.IsUseSysTitle.invoke().then((res) => {
  IsUseSysTitle.value = res;
});

const handleLogout = async () => {
  await userStore.logoutAction();
};
const handleSetting = async () => {
  if(creating.value) return;

  creating.value = true;
  await ipcRendererChannel.OpenWin.invoke({
    url: '/setting',
    winId: 'setting'
  });
  creating.value = false;
};
</script>
