import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Phase1App from './ui/Phase1App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Phase1App />
  </StrictMode>,
);
