// Infraestrutura do Submissões Allos no Railway (substitui o railway.json).
//
// Este arquivo NÃO é aplicado sozinho no push: só vale com `railway config plan`
// (mostra o que mudaria) e `railway config apply` (aplica). O push no main
// continua fazendo o deploy do código, como antes.
//
// VARIÁVEIS: todas como preserve() — o valor fica só no Railway (painel →
// Variables) e nunca neste arquivo, que está num repositório público. Um apply
// APAGA variável que não estiver listada aqui: ao criar uma variável nova no
// painel, acrescente o nome abaixo com preserve().
import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  // O banco SQLite mora aqui. Não remover: apagaria os dados.
  const submissoesAllosVolume = volume("submissoes-allos-volume", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: "us-east4-eqdc4a",
    sizeMB: 5000,
  });

  const submissoesAllos = service("submissoes-allos", {
    source: github("arthurbpinho/submissoes-allos"),
    build: { builder: "NIXPACKS", buildCommand: "npm install && npm run build" },
    // Reinício em falha (ON_FAILURE) é o padrão do Railway, que o guarda como
    // vazio; declarar o tipo deixaria o plano sempre com uma diferença falsa.
    deploy: { startCommand: "npm start", restartPolicyMaxRetries: 5 },
    // Uma réplica só: o SQLite aceita um processo escrevendo, não vários.
    replicas: { "us-east4-eqdc4a": 1 },
    domains: ["submissao.allos.org.br"],
    volumeMounts: { "/data": submissoesAllosVolume },
    env: {
      NODE_ENV: preserve(),
      DATA_DIR: preserve(),
      JWT_SECRET: preserve(),
      ADMIN_INITIAL_PASSWORD: preserve(),
      APP_BASE_URL: preserve(),
      // IA da avaliação
      OPENAI_API_KEY: preserve(),
      OPENAI_MODEL: preserve(),
      AVALIACAO_MODO: preserve(),
      AVALIADOR_EFFORT: preserve(),
      SINTETIZADOR_EFFORT: preserve(),
      AVALIACAO_INTERVALO_MS: preserve(),
      BATCH_MAX_SUBMISSOES: preserve(),
      // E-mail (Microsoft Graph / Entra)
      GRAPH_TENANT_ID: preserve(),
      GRAPH_CLIENT_ID: preserve(),
      GRAPH_CERT_THUMBPRINT: preserve(),
      GRAPH_CERT_PRIVATE_KEY: preserve(),
      GRAPH_CLIENT_SECRET: preserve(),
      MAIL_FROM: preserve(),
      MAIL_FROM_NAME: preserve(),
    },
  });

  return project("submissoes-allos", {
    resources: [submissoesAllos, submissoesAllosVolume],
  });
});
