// Configuracao do Sistema de Registro de Atividades
// Altere a URL abaixo apos publicar o Google Apps Script como Web App

const CONFIG = {
  // URL do Google Apps Script publicado como Web App
  API_URL: 'https://script.google.com/macros/s/AKfycbyxs81ApDbFu_qPAWrUYjXLLdkRggkFQqe1qiYvG_h1Zo4oXlvKiNymsZpWLQj8sxHB/exec',

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

  // Timeout para requisicoes HTTP (ms)
  REQUEST_TIMEOUT: 15000
};
