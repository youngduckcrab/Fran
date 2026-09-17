import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyTheme } from './theme';
import './styles.css';

// 화면이 뜨기 전에 색부터 입힌다. 기본색으로 한 번 번쩍이지 않도록.
applyTheme(undefined);

const container = document.getElementById('root');
if (!container) throw new Error('#root 엘리먼트를 찾을 수 없습니다.');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
