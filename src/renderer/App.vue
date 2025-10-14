<template>
  <router-view />
  <contextHolder />
</template>

<script lang="ts" setup>
import { contextHolder } from "@renderer/hooks/message";
</script>
