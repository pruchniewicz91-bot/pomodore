import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { installTriggers } from './lib/sync'
import { initCloud } from './lib/auth'

// Chmura i wyzwalacze startuja POZA Reactem, przed pierwszym renderem.
// Gdyby zalezaly od zamontowania jakiegokolwiek komponentu, synchronizacja
// nie dzialalaby dla kogos, kto tylko otwiera aplikacje, czyta i wychodzi.
installTriggers()
initCloud()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

// Service worker rejestrujemy tylko w buildzie - w dev przeszkadza w odswiezaniu.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((e) => console.warn('[sw] rejestracja nieudana', e))
  })
}
