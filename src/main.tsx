import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ThemeProvider } from './theme';
import { LanguageProvider } from './i18n';
import { RecipeCatalogProvider } from './plugins/RecipeCatalog';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <LanguageProvider>
        <RecipeCatalogProvider><App /></RecipeCatalogProvider>
      </LanguageProvider>
    </ThemeProvider>
  </StrictMode>,
);
