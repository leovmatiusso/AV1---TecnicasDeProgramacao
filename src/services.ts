import {
  ErroNegocio,
  estadosFisicos,
  idNovo,
  statusRastreamento,
  tiposEquipamento,
  type Credencial,
  type Estado,
  type EstadoFisico,
  type Equipamento,
  type Lote,
  type Movimentacao,
  type Organizacao,
  type PapelUsuario,
  type StatusRastreamento,
  type TipoEquipamento,
} from './domain.js';
import { criarCredencial, verificarSenha } from './security.js';
import { RepositorioArquivo } from './storage.js';
import {
  ValidadorCNPJ,
  ValidadorDataEntrada,
  exigir,
  exigirJustificativaDegradacao,
  podeIrParaDesmonte,
} from './validators.js';

type Permissao = 'administrar' | 'cadastro' | 'estoque' | 'consultar';

const papeisPermitidos: Record<Permissao, PapelUsuario[]> = {
  administrar: ['ADMINISTRADOR'],
  cadastro: ['ADMINISTRADOR', 'OPERADOR_CADASTRO'],
  estoque: ['ADMINISTRADOR', 'GESTOR_ALMOXARIFADO'],
  consultar: [
    'ADMINISTRADOR',
    'OPERADOR_CADASTRO',
    'GESTOR_ALMOXARIFADO',
    'AUDITOR',
  ],
};

export const pode = (papel: PapelUsuario, permissao: Permissao): boolean =>
  papeisPermitidos[permissao].includes(papel);

export class ServicoDominio {
  constructor(private readonly repo: RepositorioArquivo) {}

  estado(): Estado {
    return this.repo.obterEstado();
  }

  async login(usuario: string, senha: string): Promise<Credencial> {
    const credencial = this.estado().credenciais.find(
      (item) => item.usuario.toLowerCase() === usuario.toLowerCase() && item.ativo,
    );

    if (
      !credencial ||
      !verificarSenha(senha, credencial.salt, credencial.hashSenha)
    ) {
      throw new ErroNegocio('Usuário ou senha inválidos.');
    }

    return credencial;
  }

  async criarUsuario(
    usuario: string,
    senha: string,
    papel: PapelUsuario,
    responsavel: string,
  ): Promise<void> {
    const estado = this.estado();

    exigir(
      /^[a-zA-Z0-9._-]{3,32}$/.test(usuario),
      'Usuário deve ter 3 a 32 caracteres (letras, números, ponto, hífen ou sublinhado).',
    );
    exigir(
      !estado.credenciais.some(
        (item) => item.usuario.toLowerCase() === usuario.toLowerCase(),
      ),
      'Usuário já existe.',
    );

    const credencial = criarCredencial(usuario, senha, papel);

    await this.repo.transacionar(
      'CRIAR',
      'Credencial',
      null,
      credencial,
      responsavel,
      (copia) => {
        copia.credenciais.push(credencial);
      },
    );
  }

  async alterarAcesso(
    usuario: string,
    ativo: boolean,
    responsavel: string,
  ): Promise<void> {
    const antes = this.estado().credenciais.find(
      (item) => item.usuario.toLowerCase() === usuario.toLowerCase(),
    );

    exigir(antes, 'Usuário não encontrado.');

    if (!ativo && antes.papel === 'ADMINISTRADOR' && antes.ativo) {
      const administradoresAtivos = this.estado().credenciais.filter(
        (item) => item.ativo && item.papel === 'ADMINISTRADOR',
      );
      exigir(
        administradoresAtivos.length > 1,
        'Não é possível desativar o último administrador ativo.',
      );
    }

    const depois = { ...antes, ativo };

    await this.repo.transacionar(
      ativo ? 'REATIVAR' : 'DESATIVAR',
      'Credencial',
      antes,
      depois,
      responsavel,
      (copia) => {
        const credencial = copia.credenciais.find(
          (item) => item.usuario === antes.usuario,
        )!;
        credencial.ativo = ativo;
      },
    );
  }

  async cadastrarOrganizacao(
    input: Omit<Organizacao, 'id' | 'dataCadastro' | 'ativo' | 'contratoVigente'>,
    usuario: string,
  ): Promise<Organizacao> {
    const estado = this.estado();
    const validadorCNPJ = new ValidadorCNPJ();

    exigir(validadorCNPJ.validar(input.cnpj), validadorCNPJ.obterMensagemErro());
    exigir(input.razaoSocial.trim().length > 1, 'Razão social é obrigatória.');
    exigir(/^\S+@\S+\.\S+$/.test(input.email), 'E-mail inválido.');
    exigir(
      !estado.organizacoes.some(
        (item) => item.cnpj.replace(/\D/g, '') === input.cnpj.replace(/\D/g, ''),
      ),
      'Já existe organização com este CNPJ.',
    );

    const organizacao: Organizacao = {
      ...input,
      id: idNovo(),
      dataCadastro: new Date().toISOString(),
      ativo: true,
    };

    await this.repo.transacionar(
      'CRIAR',
      'Organizacao',
      null,
      organizacao,
      usuario,
      (copia) => {
        copia.organizacoes.push(organizacao);
      },
    );

    return organizacao;
  }

  async criarContrato(
    organizacaoId: string,
    dataVencimento: string,
    valorMensal: number,
    usuario: string,
  ): Promise<void> {
    const organizacao = this.estado().organizacoes.find(
      (item) => item.id === organizacaoId,
    );

    exigir(organizacao, 'Organização não encontrada.');
    exigir(
      Number.isFinite(Date.parse(dataVencimento)) &&
        Date.parse(dataVencimento) >= Date.now(),
      'Data de vencimento deve ser futura.',
    );
    exigir(Number.isFinite(valorMensal) && valorMensal >= 0, 'Valor mensal inválido.');

    const contrato = {
      id: idNovo(),
      organizacaoId,
      dataAssinatura: new Date().toISOString(),
      dataVencimento: new Date(dataVencimento).toISOString(),
      clausulas: [],
      valorMensal,
      renovacaoAutomatica: false,
    };

    await this.repo.transacionar(
      'CRIAR',
      'Contrato',
      null,
      contrato,
      usuario,
      (copia) => {
        copia.contratos.push(contrato);
        copia.organizacoes.find((item) => item.id === organizacaoId)!.contratoVigente =
          contrato;
      },
    );
  }

  async criarLote(
    organizacaoId: string,
    notaFiscal: string,
    transportadora: string,
    dataEntrada: string,
    usuario: string,
  ): Promise<Lote> {
    const estado = this.estado();
    const validadorData = new ValidadorDataEntrada();

    exigir(
      estado.organizacoes.some(
        (item) => item.id === organizacaoId && item.ativo,
      ),
      'Organização inexistente ou inativa.',
    );
    exigir(
      notaFiscal.trim().length > 0 && transportadora.trim().length > 0,
      'Nota fiscal e transportadora são obrigatórias.',
    );
    exigir(validadorData.validar(dataEntrada), validadorData.obterMensagemErro());

    const lote: Lote = {
      id: idNovo(),
      dataEntrada: new Date(dataEntrada).toISOString(),
      organizacaoId,
      notaFiscal,
      transportadora,
      equipamentoIds: [],
      statusProcessamento: 'RECEBIDO',
      observacoes: '',
      triagemConcluida: false,
    };

    await this.repo.transacionar(
      'CRIAR',
      'Lote',
      null,
      lote,
      usuario,
      (copia) => {
        copia.lotes.push(lote);
      },
    );

    return lote;
  }

  async criarEquipamento(
    input: {
      loteId: string;
      tipo: TipoEquipamento;
      marca: string;
      modelo: string;
      anoFabricacao: number;
      estadoFisico: EstadoFisico;
      pesoQuilogramas: number;
    },
    usuario: string,
  ): Promise<Equipamento> {
    const estado = this.estado();
    const lote = estado.lotes.find((item) => item.id === input.loteId);

    exigir(lote, 'Lote não encontrado.');
    exigir(tiposEquipamento.includes(input.tipo), 'Tipo de equipamento inválido.');
    exigir(estadosFisicos.includes(input.estadoFisico), 'Estado físico inválido.');
    exigir(
      input.marca.trim().length > 0 && input.modelo.trim().length > 0,
      'Marca e modelo são obrigatórios.',
    );
    exigir(
      Number.isInteger(input.anoFabricacao) &&
        input.anoFabricacao >= 1970 &&
        input.anoFabricacao <= new Date().getFullYear(),
      'Ano de fabricação inválido.',
    );
    exigir(
      Number.isFinite(input.pesoQuilogramas) && input.pesoQuilogramas > 0,
      'Peso deve ser maior que zero.',
    );

    const posicao = lote.equipamentoIds.length + 1;
    const equipamento: Equipamento = {
      id: idNovo(),
      codigoBarrasInterno: `GC-${new Date().getFullYear()}-${String(
        estado.equipamentos.length + 1,
      ).padStart(6, '0')}`,
      tipo: input.tipo,
      marca: input.marca,
      modelo: input.modelo,
      anoFabricacao: input.anoFabricacao,
      estadoFisico: input.estadoFisico,
      pesoQuilogramas: input.pesoQuilogramas,
      loteId: input.loteId,
      posicaoNoLote: posicao,
      statusRastreamento: 'AGUARDANDO_TRIAGEM',
      historicoMovimentacao: [],
    };

    await this.repo.transacionar(
      'CRIAR',
      'Equipamento',
      null,
      equipamento,
      usuario,
      (copia) => {
        copia.equipamentos.push(equipamento);
        copia.lotes.find((item) => item.id === input.loteId)!.equipamentoIds.push(
          equipamento.id,
        );
      },
    );

    return equipamento;
  }

  async iniciarTriagem(loteId: string, usuario: string): Promise<void> {
    const lote = this.estado().lotes.find((item) => item.id === loteId);

    exigir(lote, 'Lote não encontrado.');
    exigir(
      lote.statusProcessamento === 'RECEBIDO',
      'Triagem só pode ser iniciada em lote recebido.',
    );
    exigir(
      lote.equipamentoIds.length > 0,
      'Cadastre ao menos um equipamento antes da triagem.',
    );

    const antes = structuredClone(lote);
    const depois = { ...lote, statusProcessamento: 'EM_TRIAGEM' as const };

    await this.repo.transacionar(
      'INICIAR_TRIAGEM',
      'Lote',
      antes,
      depois,
      usuario,
      (copia) => {
        copia.lotes.find((item) => item.id === loteId)!.statusProcessamento =
          'EM_TRIAGEM';
      },
    );
  }

  async registrarTriagem(loteId: string, usuario: string): Promise<void> {
    const lote = this.estado().lotes.find((item) => item.id === loteId);

    exigir(lote, 'Lote não encontrado.');
    exigir(
      lote.statusProcessamento === 'EM_TRIAGEM',
      'Inicie a triagem antes de concluí-la.',
    );
    exigir(
      lote.equipamentoIds.length > 0,
      'Não é possível concluir triagem sem equipamentos cadastrados.',
    );

    const antes = structuredClone(lote);
    const depois = {
      ...lote,
      statusProcessamento: 'TRIAGEM_CONCLUIDA' as const,
      triagemConcluida: true,
    };

    await this.repo.transacionar(
      'TRIAGEM_CONCLUIDA',
      'Lote',
      antes,
      depois,
      usuario,
      (copia) => {
        const loteAtual = copia.lotes.find((item) => item.id === loteId)!;
        loteAtual.statusProcessamento = 'TRIAGEM_CONCLUIDA';
        loteAtual.triagemConcluida = true;
      },
    );
  }

  async movimentar(
    equipamentoId: string,
    destino: StatusRastreamento,
    responsavel: string,
    observacao: string,
    usuario: string,
  ): Promise<void> {
    const estado = this.estado();
    const equipamento = estado.equipamentos.find(
      (item) =>
        item.id === equipamentoId || item.codigoBarrasInterno === equipamentoId,
    );

    exigir(equipamento, 'Equipamento não encontrado.');
    exigir(statusRastreamento.includes(destino), 'Status de rastreamento inválido.');
    exigir(responsavel.trim().length > 0, 'Responsável pela movimentação é obrigatório.');

    const lote = estado.lotes.find((item) => item.id === equipamento.loteId)!;

    if (destino === 'EM_DESMONTE') {
      exigir(
        podeIrParaDesmonte(lote.triagemConcluida, equipamento.statusRastreamento),
        'Equipamento só pode ir para desmonte após triagem completa.',
      );
    }

    const proximosStatus: Record<StatusRastreamento, StatusRastreamento[]> = {
      AGUARDANDO_TRIAGEM: ['EM_TRIAGEM'],
      EM_TRIAGEM: ['AGUARDANDO_DESMONTE'],
      AGUARDANDO_DESMONTE: ['EM_DESMONTE'],
      EM_DESMONTE: [
        'PECAS_REAPROVEITADAS',
        'MATERIAL_RECICLAVEL',
        'DESCARTE_SEGURO',
      ],
      PECAS_REAPROVEITADAS: ['BAIXA_DEFINITIVA'],
      MATERIAL_RECICLAVEL: ['BAIXA_DEFINITIVA'],
      DESCARTE_SEGURO: ['BAIXA_DEFINITIVA'],
      BAIXA_DEFINITIVA: [],
    };

    exigir(
      proximosStatus[equipamento.statusRastreamento].includes(destino),
      'Transição de status não permitida.',
    );

    const movimentacao: Movimentacao = {
      id: idNovo(),
      equipamentoId: equipamento.id,
      dataHora: new Date().toISOString(),
      origem: equipamento.statusRastreamento,
      destino,
      responsavel,
      observacao,
    };
    const antes = structuredClone(equipamento);
    const depois = {
      ...equipamento,
      statusRastreamento: destino,
      historicoMovimentacao: [
        ...equipamento.historicoMovimentacao,
        movimentacao,
      ],
    };

    await this.repo.transacionar(
      'MOVIMENTAR',
      'Equipamento',
      antes,
      depois,
      usuario,
      (copia) => {
        const item = copia.equipamentos.find(
          (registro) => registro.id === equipamento.id,
        )!;
        item.statusRastreamento = destino;
        item.historicoMovimentacao.push(movimentacao);
      },
    );
  }

  async alterarEstado(
    equipamentoId: string,
    estadoNovo: EstadoFisico,
    justificativa: string,
    usuario: string,
  ): Promise<void> {
    const equipamento = this.estado().equipamentos.find(
      (item) =>
        item.id === equipamentoId || item.codigoBarrasInterno === equipamentoId,
    );

    exigir(equipamento, 'Equipamento não encontrado.');
    exigirJustificativaDegradacao(
      equipamento.estadoFisico,
      estadoNovo,
      justificativa,
    );

    const antes = structuredClone(equipamento);
    const depois = { ...equipamento, estadoFisico: estadoNovo };

    await this.repo.transacionar(
      'ALTERAR_ESTADO',
      'Equipamento',
      antes,
      depois,
      usuario,
      (copia) => {
        copia.equipamentos.find((item) => item.id === equipamento.id)!.estadoFisico =
          estadoNovo;
      },
    );
  }

  async buscarOrganizacao(id: string): Promise<Organizacao> {
    const organizacao = this.estado().organizacoes.find(
      (item) =>
        item.id === id || item.cnpj.replace(/\D/g, '') === id.replace(/\D/g, ''),
    );

    if (!organizacao) {
      throw new ErroNegocio('Organização não encontrada.');
    }

    return organizacao;
  }

  async desativarOrganizacao(
    id: string,
    responsavel: string,
  ): Promise<void> {
    const antes = await this.buscarOrganizacao(id);
    const depois = { ...antes, ativo: false };

    await this.repo.transacionar(
      'DESATIVAR',
      'Organizacao',
      antes,
      depois,
      responsavel,
      (estado) => {
        estado.organizacoes.find((item) => item.id === antes.id)!.ativo = false;
      },
    );
  }

  async renovarContrato(
    organizacaoId: string,
    vencimento: string,
    responsavel: string,
  ): Promise<void> {
    const organizacao = await this.buscarOrganizacao(organizacaoId);
    const contrato = organizacao.contratoVigente;

    exigir(contrato, 'Organização não tem contrato vigente.');
    exigir(
      Number.isFinite(Date.parse(vencimento)) &&
        Date.parse(vencimento) > Date.parse(contrato.dataVencimento),
      'A nova data deve ser posterior ao vencimento atual.',
    );

    const antes = structuredClone(contrato);
    const depois = {
      ...contrato,
      dataVencimento: new Date(vencimento).toISOString(),
    };

    await this.repo.transacionar(
      'RENOVAR',
      'Contrato',
      antes,
      depois,
      responsavel,
      (estado) => {
        estado.contratos = estado.contratos.map((item) =>
          item.id === contrato.id ? depois : item,
        );

        const item = estado.organizacoes.find(
          (registro) =>
            registro.id === organizacaoId ||
            registro.cnpj.replace(/\D/g, '') === organizacaoId.replace(/\D/g, ''),
        );

        if (item) {
          item.contratoVigente = depois;
        }
      },
    );
  }

  async reverterTransacao(id: string, usuario: string): Promise<void> {
    const entrada = (await this.repo.listarJournal()).find(
      (item) => item.id === id,
    );

    exigir(entrada, 'Transação não encontrada.');
    exigir(
      entrada.operacao !== 'REVERSAO',
      'Não é possível reverter diretamente uma reversão.',
    );

    const antes = entrada.dadosAntes as { id?: string } | null;
    const depois = entrada.dadosDepois as { id?: string } | null;
    const alvo = depois ?? antes;

    exigir(alvo?.id, 'Transação sem entidade reversível.');

    const colecaoPorEntidade: Record<string, keyof Estado> = {
      Credencial: 'credenciais',
      Organizacao: 'organizacoes',
      Contrato: 'contratos',
      Lote: 'lotes',
      Equipamento: 'equipamentos',
    };
    const chaveColecao = colecaoPorEntidade[entrada.entidade];

    exigir(chaveColecao, 'Entidade não suportada para reversão.');

    const colecao = this.estado()[chaveColecao] as Array<{ id?: string }>;
    const atual = colecao.find((item) => item.id === alvo.id);
    const restaurar = antes;

    await this.repo.transacionar(
      'REVERSAO',
      entrada.entidade,
      atual ?? null,
      restaurar,
      usuario,
      (estado) => {
        const itens = estado[chaveColecao] as Array<{ id?: string }>;
        const indice = itens.findIndex((item) => item.id === alvo.id);

        if (restaurar) {
          if (indice >= 0) {
            itens[indice] = restaurar;
          } else {
            itens.push(restaurar);
          }
        } else if (indice >= 0) {
          itens.splice(indice, 1);
        }
      },
    );
  }
}
