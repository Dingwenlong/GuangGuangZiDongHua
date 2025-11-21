import path from 'path';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { builtinModules } from 'module';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import alias from '@rollup/plugin-alias';
import json from '@rollup/plugin-json';
import esbuild from 'rollup-plugin-esbuild';
import { defineConfig } from 'rollup';
import { getConfig } from './utils';

const config = getConfig();

export default (env = 'production', type = 'main') => {
  return defineConfig({
    input:
      type === 'main'
        ? path.join(__dirname, '..', 'src', 'main', 'index.ts')
        : path.join(__dirname, '..', 'src', 'preload', 'index.ts'),
    output: {
      file: path.join(
        __dirname,
        '..',
        'dist',
        'electron',
        'main',
        `${type === 'main' ? type : 'preload'}.js`
      ),
      format: 'cjs',
      name: type === 'main' ? 'MainProcess' : 'MainPreloadProcess',
      sourcemap: false,
    },
    plugins: [
      // 处理 .onnx 文件导入的插件
      {
        name: 'ignore-onnx-imports',
        resolveId(source) {
          // 完全忽略 .onnx 文件的导入
          if (source.endsWith('.onnx')) {
            // 返回一个虚拟模块ID
            return { id: '\0onnx-virtual-module', external: false };
          }
          return null;
        },
        load(id) {
          // 对于 .onnx 文件，返回空内容
          if (id === '\0onnx-virtual-module') {
            return 'export default "";';
          }
          return null;
        },
      },
      replace({
        preventAssignment: true,
        'process.env.userConfig': config ? JSON.stringify(config) : '{}',
        'process.env.NODE_ENV': JSON.stringify(env),
      }),
      nodeResolve({
        preferBuiltins: true,
        browser: false,
        extensions: ['.mjs', '.ts', '.js', '.json', '.node'],
      }),
      commonjs({
        sourceMap: false,
        ignoreDynamicRequires: true,
      }),
      json(),
      esbuild({
        include: /\.[jt]s?$/,
        sourceMap: false,
        minify: env === 'production',
        target: 'es2017',
        define: {
          __VERSION__: '"x.y.z"',
        },
        loaders: {
          '.json': 'json',
          '.js': 'jsx',
        },
      }),
      alias({
        entries: [
          { find: '@main', replacement: path.join(__dirname, '../src/main') },
          {
            find: '@config',
            replacement: path.join(__dirname, '..', 'config'),
          },
          {
            find: '@shared',
            replacement: path.join(__dirname, '../src/shared'),
          },
        ],
      }),
    ],
    external: [
      ...builtinModules,
      'electron',
      'electron-updater',
      'express',
      'ffi-napi',
      'ref-napi',
      'ref-struct-napi',
      'semver',
      'glob',
      'sqlite3',
      'onnxruntime-node',
      'sharp',
      /\.node$/,
    ],
  });
};
