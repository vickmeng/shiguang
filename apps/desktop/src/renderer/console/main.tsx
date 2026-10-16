/**
 * 后台 console 渲染入口（任务 13）：按输入框入口同款方式 createRoot 挂载 <App />。
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '../index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('console renderer: #root container not found');
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
