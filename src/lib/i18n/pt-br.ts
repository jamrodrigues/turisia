/**
 * pt-BR dictionary for shared / cross-cutting strings (nav, common
 * actions, status words). Product is Brazilian-Portuguese only, so this
 * is a plain typed object — no i18n framework, no runtime.
 *
 * Scope note: area-specific copy is translated inline in each component
 * (parallel-safe — no single hot file). This dictionary is the single
 * home for the shared vocabulary + the glossary the whole app agrees on.
 * Import as `import { t } from '@/lib/i18n/pt-br'` and use `t.nav.inbox`.
 *
 * Glossary (keep consistent everywhere):
 *   Inbox→Caixa de entrada · Contacts→Contatos · Pipelines→Funis ·
 *   Deals→Negócios · Broadcasts→Disparos · Automations→Automações ·
 *   Flows→Fluxos · Settings→Configurações · Agents/Members→Atendentes/Membros ·
 *   Tags→Etiquetas · Assigned→Atribuído · Unread→Não lida ·
 *   Handoff→Transferência para atendente · Knowledge base→Base de conhecimento ·
 *   Templates→Modelos.
 */
export const t = {
  nav: {
    dashboard: 'Painel',
    inbox: 'Caixa de entrada',
    notifications: 'Notificações',
    contacts: 'Contatos',
    pacotes: 'Pacotes',
    reservas: 'Reservas',
    agendaOperacional: 'Agenda operacional',
    motoristas: 'Motoristas',
    guias: 'Guias',
    veiculos: 'Veículos',
    financeiro: 'Financeiro',
    tarefas: 'Tarefas',
    pipelines: 'Funis',
    broadcasts: 'Disparos',
    automations: 'Automações',
    flows: 'Fluxos',
    aiAgents: 'Agentes de IA',
    settings: 'Configurações',
  },
  roles: {
    owner: 'Dono',
    admin: 'Administrador',
    agent: 'Atendente',
    viewer: 'Visualizador',
  },
  common: {
    save: 'Salvar',
    saving: 'Salvando…',
    cancel: 'Cancelar',
    delete: 'Excluir',
    remove: 'Remover',
    edit: 'Editar',
    add: 'Adicionar',
    search: 'Buscar',
    loading: 'Carregando…',
    close: 'Fechar',
    confirm: 'Confirmar',
    back: 'Voltar',
    copy: 'Copiar',
    copied: 'Copiado',
    connected: 'Conectado',
    disconnected: 'Desconectado',
    yes: 'Sim',
    no: 'Não',
    signOut: 'Sair',
  },
  status: {
    open: 'Aberta',
    pending: 'Pendente',
    closed: 'Fechada',
  },
} as const

export type Dictionary = typeof t
