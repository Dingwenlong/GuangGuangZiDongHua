<template>
  <div class="text-sm w-full h-full flex flex-col items-center gap-12 py-[10%]">
    <div class="w-1/4 h-1/4 bg-gray-100 rounded-md flex items-center justify-center gap-4 ml-6">
      <Avatar
        class="w-[18px] h-[18px]"
        shape="square"
        :size="48"
        :src="storeUser.userData?.avatar || NavUser"
        style="filter: invert(1)"
      >
        <template #icon><UserOutlined /></template>
      </Avatar>
      <div>
        <p>{{ storeUser.userData?.realName }}</p>
        <p>{{ storeUser.userData?.mobile }}</p>
      </div>
    </div>

    <div class="select-none flex items-center gap-4 cursor-pointer" @click="() => (resetPwd = !resetPwd)">
      <img :src="Warning" width="24" height="24" />
      <span class="ps-2">重设密码</span>
    </div>

    <Form
      v-if="resetPwd"
      class="w-1/3"
      ref="formRef"
      :model="formState"
      :rules="rules"
      :label-col="{ span: 8 }"
      :wrapper-col="{ span: 16 }"
      autocomplete="off"
    >
      <FormItem has-feedback name="pass">
        <InputPassword
          v-model:value="formState.pass"
          placeholder="请输入登陆密码"
          :maxlength="18"
          autocomplete="off"
        />
      </FormItem>
      <FormItem has-feedback name="checkPass">
        <InputPassword
          v-model:value="formState.checkPass"
          placeholder="请再次输入登陆密码"
          :maxlength="18"
          :visibilityToggle="false"
          autocomplete="off"
        />
      </FormItem>
    </Form>
    <Button
      v-if="resetPwd"
      type="primary"
      @click="handleResetPassword"
    >
      重设
    </Button>
  </div>
</template>

<script lang="ts" setup>
import { ref, reactive } from 'vue';
import { UserOutlined } from '@ant-design/icons-vue';
import NavUser from '@renderer/assets/icons/webp/layout-nav-user.webp';
import Warning from '@renderer/assets/icons/webp/warning.webp';
import { Form, FormItem, Avatar, InputPassword, Button } from 'ant-design-vue';
import { useStoreUser } from "@renderer/store/modules/user";
import { messageApi } from '@renderer/hooks/message';
import type { Rule } from 'ant-design-vue/es/form';
import type { FormInstance } from 'ant-design-vue';

interface FormState {
  pass: string;
  checkPass: string;
}
const { ipcRendererChannel } = window;
const storeUser = useStoreUser();
const formRef = ref<FormInstance>();
const resetPwd = ref(false);
const formState = reactive<FormState>({
  pass: '',
  checkPass: ''
});

const validatePass = async (_rule: Rule, value: string) => {
  if (value === '') {
    return Promise.reject('请输入密码');
  } else if (value.length < 6) {
    return Promise.reject('密码长度不能低于6位');
  } else {
    if (formState.checkPass !== '') {
      formRef.value?.validateFields('checkPass');
    }
    return Promise.resolve();
  }
};

const validatePass2 = async (_rule: Rule, value: string) => {
  if (value === '') {
    return Promise.reject('请再次输入密码');
  } else if (value !== formState.pass) {
    return Promise.reject('二次输入不一致');
  } else {
    return Promise.resolve();
  }
};

const rules: Record<string, Rule[]> = {
  pass: [{ required: true, validator: validatePass, trigger: 'change' }],
  checkPass: [{ validator: validatePass2, trigger: 'change' }]
};

const handleResetPassword = async () => {
  if(await storeUser.changeAccountPwd({ password: formState.pass })) {
    ipcRendererChannel.OpenMessageBox.invoke({
      title: "提示",
      message: "修改成功",
      type: "info",
    });
  }
};
</script>
