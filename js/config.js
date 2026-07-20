// Configuracao do Sistema de Registro de Atividades
// Altere a URL abaixo apos publicar o Google Apps Script como Web App

const CONFIG = {
  // Versao do app — bumpar aqui e em CACHE_NAME do service-worker.js a cada deploy
  APP_VERSION: 'v8',

  // URL do Google Apps Script publicado como Web App
  API_URL: 'https://script.google.com/macros/s/AKfycbxHi0dk9WWQWsstCv0rjngCVyt7GcIOVzktnXWWUE380qu0dW3sHFqBMK24nVDukkFr/exec',

  // Tempo em ms para considerar alerta (3 horas = 10800000 ms)
  ALERTA_MS: 3 * 60 * 60 * 1000,

  // Tempo em ms para timeout (4 horas = 14400000 ms)
  TIMEOUT_MS: 4 * 60 * 60 * 1000,

  // Intervalo de atualizacao do cronometro (1 segundo)
  INTERVALO_CRONOMETRO: 1000,

  // Intervalo de atualizacao do painel do gestor (30 segundos)
  INTERVALO_PAINEL_GESTOR: 30000,

  // Intervalo para verificar outros trabalhadores na mesma carga (15 segundos)
  INTERVALO_VERIFICAR_CARGA: 15000,

  // Tempo de inatividade (sem tarefa ativa) para logout automatico: 30 minutos
  IDLE_LOGOUT_MS: 30 * 60 * 1000,

  // Timeout por tentativa HTTP (ms)
  REQUEST_TIMEOUT: 10000,

  // Numero maximo de tentativas antes de desistir
  MAX_TENTATIVAS: 3,

  // Espera entre tentativas (ms) — dobra a cada retry: 2s, 4s
  DELAY_RETRY_MS: 2000,

  // Timeout curto para primeira tentativa de login (fail-fast se servidor offline)
  LOGIN_REQUEST_TIMEOUT: 5000,

  // Max tentativas no login (menos retries para evitar travamento no login)
  LOGIN_MAX_TENTATIVAS: 2
};

// Kill-switch de atualizacao: apaga TODO o cache, desregistra o Service Worker
// e recarrega limpo. Usado quando APP_VERSION muda, para nunca ficar preso em
// versao antiga no PWA instalado (coletor Zebra).
CONFIG.forcarAtualizacao = async function() {
  try {
    if (window.caches) {
      const chaves = await caches.keys();
      await Promise.all(chaves.map(c => caches.delete(c)));
    }
  } catch (e) {}
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch (e) {}
  // recarrega forcando rede (ignora cache HTTP)
  location.reload();
};
