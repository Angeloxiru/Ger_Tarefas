// Configuracao do Sistema de Registro de Atividades
// Altere a URL abaixo apos publicar o Google Apps Script como Web App

const CONFIG = {
  // Versao do app no formato MAIOR.MENOR.CORRECAO (ver "Versionamento" no README).
  // Bumpar aqui, em CACHE_NAME do service-worker.js e no ?v= dos 4 HTMLs a cada deploy.
  APP_VERSION: '1.1.1',

  // Banco de dados Turso (desde a v11 o app fala direto com o banco).
  // ATENCAO: este token da leitura e escrita no banco e fica visivel no repositorio
  // publico (risco assumido pelo responsavel). Para trocar: gere um token novo no
  // Turso, cole aqui, publique e invalide o antigo.
  TURSO_URL: 'libsql://tarefas-angeloxiru.aws-us-east-1.turso.io',
  TURSO_TOKEN: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTUxMTY0MTgsImlkIjoiMDFhMWY1NDUtY2QwMS03ZGRmLTlhYmEtNTZkZTFlMzdjNjZmIiwia2lkIjoibzJ2UkRHUzNLTFFjbGZCUlVRQV9iWDZDRzJYRF94cnpQMlcyYWl2Q2d2WSIsInJpZCI6IjE0NDg2MGQyLWZiZTQtNGEyMC05OGZkLTE1N2FlNGEwNmIzNyJ9.b-S90Rv8ZsdsMxifU9dGZ_eYxCK9aBqQNkH1-6n2bJGvC-71rlX2OdglilRAuoDHLOImrWIgMVoRczKQqpnGCw',

  // Coletor: leituras erradas seguidas antes da tela "Chame o responsavel"
  COLETOR_TENTATIVAS_MAX: 3,

  // Coletor: segundos do aviso "responsavel esta executando tarefas" antes do logout
  COLETOR_AVISO_BLOQUEIO_S: 10,

  // Coletor: segundos da confirmacao de devolucao antes do logout
  COLETOR_CONFIRMA_DEVOLUCAO_S: 3,

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
