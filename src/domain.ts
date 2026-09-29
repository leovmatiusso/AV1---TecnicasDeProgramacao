import { randomUUID } from 'node:crypto';

export type PapelUsuario =
  | 'ADMINISTRADOR'
  | 'OPERADOR_CADASTRO'
  | 'GESTOR_ALMOXARIFADO'
  | 'AUDITOR';

export type TipoEquipamento =
  | 'COMPUTADOR_MESA'
  | 'NOTEBOOK'
  | 'MONITOR'
  | 'IMPRESSORA'
  | 'SERVIDOR'
  | 'ROTEADOR'
  | 'CABO_ESTRUTURADO'
  | 'FONTE_ALIMENTACAO';

export type EstadoFisico =
  | 'NOVO'
  | 'BOM_ESTADO'
  | 'USADO_LEVE'
  | 'USADO_MODERADO'
  | 'DANIFICADO_LEVE'
  | 'DANIFICADO_GRAVE'
  | 'INSERVIVEL';

export type StatusLote =
  | 'RECEBIDO'
  | 'EM_TRIAGEM'
  | 'TRIAGEM_CONCLUIDA'
  | 'ENCAMINHADO'
  | 'FINALIZADO';

export type StatusRastreamento =
  | 'AGUARDANDO_TRIAGEM'
  | 'EM_TRIAGEM'
  | 'AGUARDANDO_DESMONTE'
  | 'EM_DESMONTE'
  | 'PECAS_REAPROVEITADAS'
  | 'MATERIAL_RECICLAVEL'
  | 'DESCARTE_SEGURO'
  | 'BAIXA_DEFINITIVA';

export interface Credencial {
  usuario: string;
  hashSenha: string;
  salt: string;
  papel: PapelUsuario;
  ativo: boolean;
}

export interface Organizacao {
  id: string;
  razaoSocial: string;
  cnpj: string;
  inscricaoEstadual: string;
  enderecoCompleto: string;
  telefone: string;
  email: string;
  dataCadastro: string;
  ativo: boolean;
  contratoVigente?: Contrato;
}

export interface Contrato {
  id: string;
  organizacaoId: string;
  dataAssinatura: string;
  dataVencimento: string;
  clausulas: string[];
  valorMensal: number;
  renovacaoAutomatica: boolean;
}

export interface Lote {
  id: string;
  dataEntrada: string;
  organizacaoId: string;
  notaFiscal: string;
  transportadora: string;
  equipamentoIds: string[];
  statusProcessamento: StatusLote;
  observacoes: string;
  triagemConcluida: boolean;
}

export interface Equipamento {
  id: string;
  codigoBarrasInterno: string;
  tipo: TipoEquipamento;
  marca: string;
  modelo: string;
  anoFabricacao: number;
  estadoFisico: EstadoFisico;
  pesoQuilogramas: number;
  loteId: string;
  posicaoNoLote: number;
  statusRastreamento: StatusRastreamento;
  historicoMovimentacao: Movimentacao[];
}

export interface Movimentacao {
  id: string;
  equipamentoId: string;
  dataHora: string;
  origem: string;
  destino: string;
  responsavel: string;
  observacao: string;
}

export interface JournalTransacao {
  id: string;
  timestamp: string;
  operacao: string;
  entidade: string;
  dadosAntes: unknown;
  dadosDepois: unknown;
  usuarioResponsavel: string;
}

export interface Estado {
  credenciais: Credencial[];
  organizacoes: Organizacao[];
  contratos: Contrato[];
  lotes: Lote[];
  equipamentos: Equipamento[];
}

export const estadoVazio = (): Estado => ({
  credenciais: [],
  organizacoes: [],
  contratos: [],
  lotes: [],
  equipamentos: [],
});

export const idNovo = (): string => randomUUID();

export const papeis: PapelUsuario[] = [
  'ADMINISTRADOR',
  'OPERADOR_CADASTRO',
  'GESTOR_ALMOXARIFADO',
  'AUDITOR',
];

export const tiposEquipamento: TipoEquipamento[] = [
  'COMPUTADOR_MESA',
  'NOTEBOOK',
  'MONITOR',
  'IMPRESSORA',
  'SERVIDOR',
  'ROTEADOR',
  'CABO_ESTRUTURADO',
  'FONTE_ALIMENTACAO',
];

export const estadosFisicos: EstadoFisico[] = [
  'NOVO',
  'BOM_ESTADO',
  'USADO_LEVE',
  'USADO_MODERADO',
  'DANIFICADO_LEVE',
  'DANIFICADO_GRAVE',
  'INSERVIVEL',
];

export const statusRastreamento: StatusRastreamento[] = [
  'AGUARDANDO_TRIAGEM',
  'EM_TRIAGEM',
  'AGUARDANDO_DESMONTE',
  'EM_DESMONTE',
  'PECAS_REAPROVEITADAS',
  'MATERIAL_RECICLAVEL',
  'DESCARTE_SEGURO',
  'BAIXA_DEFINITIVA',
];

export class ErroNegocio extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErroNegocio';
  }
}
