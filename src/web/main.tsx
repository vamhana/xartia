// F.4.01.06
import 'leaflet/dist/leaflet.css';
import 'react-grid-layout/css/styles.css';
// import 'react-resizable/css/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { loadTokensFromStorage } from './api/client';
import { App } from './App';


// Отключаем pointer-events у служебных слоёв RGL — иначе они перехватывают
// elementFromPoint при drag-drop в Конструкторе.
const rglFix = document.createElement('style');
rglFix.textContent = `
  .react-grid-placeholder { display: none !important; }
  .react-grid-item.react-draggable-dragging { pointer-events: none !important; }
  .react-grid-item.react-grid-placeholder { pointer-events: none !important; }
`;
document.head.appendChild(rglFix);

const style = document.createElement('style');
style.textContent = `
  .react-grid-placeholder { pointer-events: none !important; }
`;
document.head.appendChild(style);
// Загружаем токены из localStorage ДО первого рендера.
// Иначе WS-клиент в Header попытается подключиться с пустыми токенами
// (React запускает useEffect дочерних компонентов раньше родительских).
loadTokensFromStorage();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);