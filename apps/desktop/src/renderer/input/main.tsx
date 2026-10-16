/**
 * 输入框渲染入口（任务 18）：createRoot 挂载 <App />。
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '../index.css';

const container = document.getElementById('app');
if (!container) {
  throw new Error('input renderer: #app container not found');
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
