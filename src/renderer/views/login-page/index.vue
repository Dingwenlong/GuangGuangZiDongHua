<template>
  <div class="w-full h-full flex flex-col items-center">
    <div class="drag w-full h-30">
      <div
        class="no-drag cursor-pointer w-30 text-gray-500 hover:text-gray-900 float-right"
        @click="() => ipcRendererChannel.AppClose.invoke()"
      >
        <CloseIcon />
      </div>
    </div>
    <div class="flex-1 flex flex-col items-center py-60 gap-12">
      <img :src="logoImage" width="90" height="90" alt="logo" class="block" />
      <h1 class="text-[20px] text-[#010101] font-serif font-extrabold">
        {{ i18nt.appTitle }}
      </h1>
      <h3 class="text-[14px] text-[#8f8f8f] font-serif font-extrabold">
        {{ i18nt.appDescription }}
      </h3>
      <Form
        :model="reactiveState"
        :label-col="{ span: 8 }"
        :wrapper-col="{ span: 16 }"
        autocomplete="off"
        @finish="handleLogin"
      >
        <FormItem
          label="账号"
          name="userName"
          :rules="[{ required: true, message: '请输入你的手机号码！' }]"
        >
          <Input
            placeholder="请输入你的手机号码"
            :maxlength="11"
            v-model:value="reactiveState.userName"
          />
        </FormItem>
        <FormItem
          label="密码"
          name="password"
          :rules="[{ required: true, message: '请输入密码！' }]"
        >
          <InputPassword
            placeholder="请输入密码"
            v-model:value="reactiveState.password"
          />
        </FormItem>
      </Form>
      <Button
        type="primary"
        class="w-140"
        :loading="loginLoading"
        @click="handleLogin"
      >
        登录
      </Button>
      <span class="cursor-pointer text-[14px] text-[#999] font-light"
        >忘记密码？</span
      >
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, reactive } from "vue";
import { Input, InputPassword, Form, FormItem, Button } from "ant-design-vue";
import logoImage from "@renderer/assets/icons/svg/meike-logo.svg";
import CloseIcon from "@iconify-vue/material-symbols/close";
import { useStoreUser } from "@renderer/store/modules/user";
import { cloneDeep } from "lodash-es";
import { i18nt } from "@renderer/i18n";

const { ipcRendererChannel } = window;
const storeUser = useStoreUser();
const loginLoading = ref(false);
const reactiveState = reactive(
  (() => {
    const localAccount = storeUser.getLocalAccount();
    if (localAccount) {
      return localAccount;
    }
    return {
      userName: "",
      password: "",
    };
  })()
);

const handleLogin = async () => {
  if (loginLoading.value) {
    return;
  }
  if (!reactiveState.userName.trim()) {
    ipcRendererChannel.OpenMessageBox.invoke({
      title: "四毛提普斯",
      message: "请输入你的手机号码",
      type: "info",
    });
    return;
  }
  if (!reactiveState.password.trim()) {
    ipcRendererChannel.OpenMessageBox.invoke({
      title: "四毛提普斯",
      message: "请输入密码",
      type: "info",
    });
    return;
  }

  loginLoading.value = true;
  try {
    const submitData = cloneDeep(reactiveState);
    await storeUser.loginAction(submitData);
  } catch (error) {
    console.error(error);
  } finally {
    loginLoading.value = false;
  }
};
</script>
