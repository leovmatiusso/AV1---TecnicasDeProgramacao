import { createInterface, type Interface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, rename } from 'node:fs/promises';
import {
  ErroNegocio,
  estadosFisicos,
  papeis,
  statusRastreamento,
  type EstadoFisico,
  type PapelUsuario,
  type StatusRastreamento,
  type TipoEquipamento,
} from './domain.js';
import {
  carregarConfig,
  cifrar,
  decifrar,
  gravarPrivado,
  novoConfig,
  ServicoAutenticacao,
  validarSenha,
} from './security.js';
import { RepositorioArquivo } from './storage.js';
import { pode, ServicoDominio } from './services.js';
import { exigir } from './validators.js';

const dataDir = process.env.GREENCODE_HOME ?? join(homedir(), '.greencode');
let rl: Interface;

const palavrasCompletaveis = [
  'login',
  'usuario',
  'organizacao',
  'contrato',
  'parametros',
  'lote',
  'equipamento',
  'triagem',
  'relatorio',
  'journal',
  'desfazer',
  'ajuda',
  'logout',
  'sair',
  'criar',
  'cadastrar',
  'listar',
  'adicionar',
  'mover',
  'estado',
  'rastrear',
  'concluir',
  'resumo',
  'organizacoes',
  '--org',
  '--id',
  '--papel',
  '--tipo',
  '--status',
];

const completarComando = (linha: string): [string[], string] => {
  const parte = linha.split(/\s+/).at(-1) ?? '';
  const correspondencias = palavrasCompletaveis.filter((palavra) =>
    palavra.startsWith(parte),
  );

  return [correspondencias, parte];
};

const perguntar = (texto: string): Promise<string> =>
  new Promise((resolve) => rl.question(texto, resolve));

const perguntarSenha = async (texto: string): Promise<string> => {
  const entrada = process.stdin;
  const modoRawAnterior = entrada.isRaw;
  const ouvintesDados = entrada.listeners('data') as ((...args: any[]) => void)[];
  const ouvintesTeclas = entrada.listeners('keypress') as ((...args: any[]) => void)[];

  for (const ouvinte of ouvintesDados) {
    entrada.off('data', ouvinte);
  }

  for (const ouvinte of ouvintesTeclas) {
    entrada.off('keypress', ouvinte);
  }

  entrada.setRawMode?.(true);
  entrada.resume();
  process.stdout.write(texto);

  return new Promise((resolve) => {
    let senha = '';

    const restaurarEntrada = (): void => {
      entrada.off('data', receberDados);
      entrada.setRawMode?.(modoRawAnterior ?? false);

      for (const ouvinte of ouvintesDados) {
        entrada.on('data', ouvinte);
      }

      for (const ouvinte of ouvintesTeclas) {
        entrada.on('keypress', ouvinte);
      }

      process.stdout.write('\n');
      resolve(senha);
    };

    const receberDados = (dados: Buffer): void => {
      for (const caractere of dados.toString()) {
        if (caractere === '\u0003') {
          process.stdout.write('\n');
          process.exit(130);
        }

        if (caractere === '\r' || caractere === '\n') {
          restaurarEntrada();
          return;
        }

        if (caractere === '\u007f' || caractere === '\b') {
          senha = senha.slice(0, -1);
          continue;
        }

        senha += caractere;
      }
    };

    entrada.on('data', receberDados);
  });
};

const tokenizar = (entrada: string): string[] => {
  const tokens: string[] = [];
  let atual = '';
  let aspas = '';
  let escapar = false;

  for (const caractere of entrada.trim()) {
    if (escapar) {
      atual += caractere;
      escapar = false;
      continue;
    }

    if (caractere === '\\') {
      escapar = true;
      continue;
    }

    if (aspas) {
      if (caractere === aspas) {
        aspas = '';
      } else {
        atual += caractere;
      }

      continue;
    }

    if (caractere === '"' || caractere === "'") {
      aspas = caractere;
      continue;
    }

    if (/\s/.test(caractere)) {
      if (atual) {
        tokens.push(atual);
        atual = '';
      }

      continue;
    }

    atual += caractere;
  }

  if (aspas) {
    throw new ErroNegocio('Aspas não fechadas.');
  }

  if (atual) {
    tokens.push(atual);
  }

  return tokens;
};

const separarArgumentos = (argumentos: string[]): Record<string, string> => {
  const valores: Record<string, string> = {};
  let indicePosicional = 0;

  for (let indice = 0; indice < argumentos.length; indice += 1) {
    const argumento = argumentos[indice]!;

    if (!argumento.startsWith('--')) {
      valores[`_${indicePosicional}`] = argumento;
      indicePosicional += 1;
      continue;
    }

    const chave = argumento.slice(2);
    const valor = argumentos[indice + 1];

    if (!valor || valor.startsWith('--')) {
      throw new ErroNegocio(`Falta valor para --${chave}.`);
    }

    valores[chave] = valor;
    indice += 1;
  }

  return valores;
};

const obterArgumento = (
  valores: Record<string, string>,
  nome: string,
  indice: number,
): string | undefined => valores[nome] ?? valores[`_${indice}`];

const salvarConfig = async (
  diretorio: string,
  config: NonNullable<Awaited<ReturnType<typeof carregarConfig>>>,
): Promise<void> => {
  const caminho = join(diretorio, 'config.json');
  const temporario = `${caminho}.tmp`;

  await gravarPrivado(temporario, JSON.stringify(config, null, 2));
  await rename(temporario, caminho);
};

const provisionar = async (
  diretorio: string,
): Promise<NonNullable<Awaited<ReturnType<typeof carregarConfig>>>> => {
  console.log('Provisionamento inicial do GreenCode. Crie o administrador mestre.');

  const usuario = (await perguntar('Usuário administrador: ')).trim();
  const senha = await perguntarSenha('Senha (não será exibida): ');
  validarSenha(senha);

  const confirmacao = await perguntarSenha('Confirme a senha: ');
  exigir(senha === confirmacao, 'As senhas não conferem.');

  const config = novoConfig();
  const credencial = (await import('./security.js')).criarCredencial(
    usuario,
    senha,
    'ADMINISTRADOR',
  );

  config.adminInicial = {
    usuario: credencial.usuario,
    hashSenha: credencial.hashSenha,
    salt: credencial.salt,
    papel: credencial.papel,
    ativo: true,
  };

  await salvarConfig(diretorio, config);

  console.log(
    'Configuração mestre criada. Guarde a cópia segura de config.json; sem ela os dados não podem ser recuperados.',
  );

  return config;
};

const exibirAjuda = (): void => {
  console.log(`
GreenCode - logística reversa
  login
  usuario criar --usuario N --papel administrador|operador_cadastro|gestor_almoxarifado|auditor
  usuario listar | usuario desativar --usuario N | usuario reativar --usuario N
  organizacao cadastrar --razao "Nome" --cnpj 00000000000000 --email contato@empresa.com [--telefone ... --endereco ...]
  organizacao listar | organizacao desativar --id ID
  contrato criar --org ID --vencimento AAAA-MM-DD --valor 1200 | contrato renovar --org ID --vencimento AAAA-MM-DD
  parametros ver | parametros definir --imposto 12.5 --depreciacao 0.15
  lote criar --org ID --nf 123456 --transp Transportadora [--data AAAA-MM-DD]
  lote listar
  equipamento adicionar --lote ID --tipo notebook --marca X --modelo Y --ano 2022 --estado bom_estado --peso 2.5
  triagem iniciar --lote ID | triagem concluir --lote ID
  equipamento mover --id ID|CODIGO --status STATUS --responsavel Nome [--obs Texto]
    status: em_triagem|aguardando_desmonte|em_desmonte|pecas_reaproveitadas|material_reciclavel|descarte_seguro|baixa_definitiva
  equipamento estado --id ID --estado danificado_leve [--justificativa Texto]
  equipamento rastrear --id ID
  relatorio resumo | status | financeiro | organizacoes | lotes | organizacao --id ID
  journal listar
  desfazer --id ID_DA_TRANSACAO
  ajuda | logout | sair
`);
};

async function main(): Promise<void> {
  rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: completarComando,
    historySize: 500,
    terminal: true,
  });

  await mkdir(dataDir, { recursive: true, mode: 0o700 });

  let config = await carregarConfig(dataDir);

  if (!config) {
    config = await provisionar(dataDir);
  }

  if (!/^[0-9a-f]{64}$/i.test(config.chaveCriptografia)) {
    throw new ErroNegocio('Chave mestra ausente ou inválida no config.json.');
  }

  const repositorio = new RepositorioArquivo(
    dataDir,
    config.chaveCriptografia,
  );
  await repositorio.inicializar();

  if (
    config.adminInicial &&
    !repositorio
      .obterEstado()
      .credenciais.some((item) => item.usuario === config!.adminInicial!.usuario)
  ) {
    const credencial = { ...config.adminInicial };

    await repositorio.transacionar(
      'PROVISIONAMENTO',
      'Credencial',
      null,
      credencial,
      'sistema',
      (estado) => {
        estado.credenciais.push(credencial);
      },
    );

    delete config.adminInicial;
    await salvarConfig(dataDir, config);
  }

  const servico = new ServicoDominio(repositorio);
  const autenticacao = new ServicoAutenticacao();
  let token: string | undefined;
  let identidade: { usuario: string; papel: PapelUsuario } | undefined;

  const caminhoHistorico = join(dataDir, 'historico.enc');
  let historico: string[] = [];

  try {
    const conteudo = await readFile(caminhoHistorico, 'utf8');
    historico = decifrar<string[]>(conteudo, config.chaveCriptografia).slice(0, 500);
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw erro;
    }
  }

  (rl as Interface & { history: string[] }).history = historico;

  console.log(`GreenCode pronto. Dados cifrados em ${dataDir}. Digite ajuda.`);

  for await (const linha of rl) {
    try {
      const historicoAtual = (rl as Interface & { history: string[] }).history;
      const conteudoHistorico = cifrar(historicoAtual, config.chaveCriptografia);

      await gravarPrivado(`${caminhoHistorico}.tmp`, conteudoHistorico);
      await rename(`${caminhoHistorico}.tmp`, caminhoHistorico);

      const partes = tokenizar(linha);

      if (partes.length === 0) {
        continue;
      }

      const [entidade, acao, ...resto] = partes;
      const argumentos = separarArgumentos(resto);

      if (entidade === 'ajuda' || entidade === 'help') {
        exibirAjuda();
        continue;
      }

      if (entidade === 'sair' || entidade === 'exit') {
        break;
      }

      if (entidade === 'logout') {
        if (token) {
          autenticacao.encerrar(token);
        }

        token = undefined;
        identidade = undefined;
        console.log('Sessão encerrada.');
        continue;
      }

      if (entidade === 'login') {
        const usuario =
          argumentos.usuario ??
          argumentos._0 ??
          (await perguntar('Usuário: ')).trim();
        const senha = argumentos.senha ?? (await perguntarSenha('Senha: '));
        const credencial = await servico.login(usuario, senha);

        token = autenticacao.criarSessao(
          credencial.usuario,
          credencial.papel,
        );
        identidade = {
          usuario: credencial.usuario,
          papel: credencial.papel,
        };

        console.log(`Login realizado como ${credencial.papel}.`);
        continue;
      }

      if (!token || !identidade) {
        throw new ErroNegocio('Faça login primeiro: login.');
      }

      identidade = autenticacao.validar(token);

      const usuarioAtual = identidade.usuario;
      const papelAtual = identidade.papel;

      if (entidade === 'usuario' && acao === 'criar') {
        exigir(pode(papelAtual, 'administrar'), 'Apenas administrador pode criar usuários.');

        const usuario =
          obterArgumento(argumentos, 'usuario', 0) ??
          (await perguntar('Usuário: ')).trim();
        const papelNovo = argumentos.papel?.toUpperCase() as PapelUsuario;

        exigir(papeis.includes(papelNovo), 'Papel inválido.');

        const senha = await perguntarSenha('Senha: ');
        validarSenha(senha);

        await servico.criarUsuario(usuario, senha, papelNovo, usuarioAtual);
        console.log('Usuário criado.');
      } else if (entidade === 'usuario' && acao === 'listar') {
        exigir(pode(papelAtual, 'administrar'), 'Apenas administrador pode consultar usuários.');

        console.table(
          servico.estado().credenciais.map(({ usuario, papel, ativo }) => ({
            usuario,
            papel,
            ativo,
          })),
        );
      } else if (
        entidade === 'usuario' &&
        (acao === 'desativar' || acao === 'reativar')
      ) {
        exigir(pode(papelAtual, 'administrar'), 'Apenas administrador pode alterar usuários.');

        await servico.alterarAcesso(
          argumentos.usuario ?? argumentos._0 ?? '',
          acao === 'reativar',
          usuarioAtual,
        );

        console.log(`Usuário ${acao === 'reativar' ? 'reativado' : 'desativado'}.`);
      } else if (entidade === 'organizacao' && acao === 'cadastrar') {
        exigir(pode(papelAtual, 'cadastro'), 'Sem permissão para cadastrar organizações.');

        const organizacao = await servico.cadastrarOrganizacao(
          {
            razaoSocial: argumentos.razao ?? '',
            cnpj: argumentos.cnpj ?? '',
            inscricaoEstadual: argumentos.ie ?? '',
            enderecoCompleto: argumentos.endereco ?? '',
            telefone: argumentos.telefone ?? '',
            email: argumentos.email ?? '',
          },
          usuarioAtual,
        );

        console.log(
          `Organização cadastrada: ${organizacao.id} (${organizacao.razaoSocial}).`,
        );
      } else if (entidade === 'organizacao' && acao === 'listar') {
        exigir(pode(papelAtual, 'consultar'), 'Sem permissão.');

        console.table(
          servico.estado().organizacoes.map(({ id, razaoSocial, cnpj, ativo }) => ({
            id,
            razaoSocial,
            cnpj,
            ativo,
          })),
        );
      } else if (entidade === 'organizacao' && acao === 'desativar') {
        exigir(pode(papelAtual, 'cadastro'), 'Sem permissão para alterar organizações.');

        await servico.desativarOrganizacao(
          argumentos.id ?? argumentos._0 ?? '',
          usuarioAtual,
        );

        console.log('Organização desativada.');
      } else if (entidade === 'contrato' && acao === 'criar') {
        exigir(pode(papelAtual, 'cadastro'), 'Sem permissão para criar contrato.');

        await servico.criarContrato(
          obterArgumento(argumentos, 'org', 0) ?? '',
          argumentos.vencimento ?? '',
          Number(argumentos.valor),
          usuarioAtual,
        );

        console.log('Contrato criado.');
      } else if (entidade === 'contrato' && acao === 'renovar') {
        exigir(pode(papelAtual, 'cadastro'), 'Sem permissão para renovar contrato.');

        await servico.renovarContrato(
          obterArgumento(argumentos, 'org', 0) ?? '',
          argumentos.vencimento ?? '',
          usuarioAtual,
        );

        console.log('Contrato renovado.');
      } else if (
        entidade === 'parametros' &&
        (acao === 'ver' || acao === 'definir')
      ) {
        exigir(
          pode(papelAtual, 'administrar'),
          'Apenas administrador pode consultar ou alterar parâmetros globais.',
        );

        if (acao === 'ver') {
          console.log(
            JSON.stringify(
              config.parametros ?? {
                aliquotaImposto: 0,
                coeficienteDepreciacao: 0,
              },
              null,
              2,
            ),
          );
        } else {
          const antes = config.parametros ?? {
            aliquotaImposto: 0,
            coeficienteDepreciacao: 0,
          };
          const aliquotaImposto = Number(argumentos.imposto);
          const coeficienteDepreciacao = Number(argumentos.depreciacao);

          exigir(
            Number.isFinite(aliquotaImposto) &&
              aliquotaImposto >= 0 &&
              aliquotaImposto <= 100,
            'Alíquota deve estar entre 0 e 100%.',
          );
          exigir(
            Number.isFinite(coeficienteDepreciacao) &&
              coeficienteDepreciacao >= 0 &&
              coeficienteDepreciacao <= 1,
            'Coeficiente de depreciação deve estar entre 0 e 1.',
          );

          config.parametros = {
            aliquotaImposto,
            coeficienteDepreciacao,
          };

          await salvarConfig(dataDir, config);
          await repositorio.registrarSomente(
            'AUDITORIA',
            'Configuracao',
            antes,
            config.parametros,
            usuarioAtual,
          );

          console.log('Parâmetros globais atualizados.');
        }
      } else if (entidade === 'lote' && acao === 'criar') {
        exigir(pode(papelAtual, 'estoque'), 'Sem permissão para criar lotes.');

        const lote = await servico.criarLote(
          obterArgumento(argumentos, 'org', 0) ?? '',
          argumentos.nf ?? '',
          argumentos.transp ?? '',
          argumentos.data ?? new Date().toISOString(),
          usuarioAtual,
        );

        console.log(`Lote criado: ${lote.id}.`);
      } else if (entidade === 'lote' && acao === 'listar') {
        exigir(pode(papelAtual, 'consultar'), 'Sem permissão.');

        console.table(
          servico.estado().lotes.map(
            ({ id, organizacaoId, dataEntrada, statusProcessamento, equipamentoIds }) => ({
              id,
              organizacaoId,
              dataEntrada,
              statusProcessamento,
              equipamentos: equipamentoIds.length,
            }),
          ),
        );
      } else if (entidade === 'equipamento' && acao === 'adicionar') {
        exigir(pode(papelAtual, 'estoque'), 'Sem permissão para cadastrar equipamento.');

        const equipamento = await servico.criarEquipamento(
          {
            loteId: obterArgumento(argumentos, 'lote', 0) ?? '',
            tipo: argumentos.tipo?.toUpperCase() as TipoEquipamento,
            marca: argumentos.marca ?? '',
            modelo: argumentos.modelo ?? '',
            anoFabricacao: Number(argumentos.ano),
            estadoFisico: argumentos.estado?.toUpperCase() as EstadoFisico,
            pesoQuilogramas: Number(argumentos.peso),
          },
          usuarioAtual,
        );

        console.log(
          `Equipamento registrado: ${equipamento.codigoBarrasInterno} (${equipamento.id}).`,
        );
      } else if (entidade === 'triagem' && acao === 'iniciar') {
        exigir(pode(papelAtual, 'estoque'), 'Sem permissão para iniciar triagem.');

        await servico.iniciarTriagem(
          obterArgumento(argumentos, 'lote', 0) ?? '',
          usuarioAtual,
        );

        console.log('Triagem iniciada.');
      } else if (entidade === 'triagem' && acao === 'concluir') {
        exigir(pode(papelAtual, 'estoque'), 'Sem permissão para concluir triagem.');

        await servico.registrarTriagem(
          obterArgumento(argumentos, 'lote', 0) ?? '',
          usuarioAtual,
        );

        console.log('Triagem do lote concluída.');
      } else if (entidade === 'equipamento' && acao === 'mover') {
        exigir(pode(papelAtual, 'estoque'), 'Sem permissão para movimentar equipamentos.');

        const status = (argumentos.status ?? argumentos._1)?.toUpperCase() as StatusRastreamento;

        exigir(statusRastreamento.includes(status), 'Status de rastreamento inválido.');

        await servico.movimentar(
          obterArgumento(argumentos, 'id', 0) ?? '',
          status,
          argumentos.responsavel ?? usuarioAtual,
          argumentos.obs ?? '',
          usuarioAtual,
        );

        console.log('Movimentação registrada.');
      } else if (entidade === 'equipamento' && acao === 'estado') {
        exigir(pode(papelAtual, 'estoque'), 'Sem permissão para alterar equipamento.');

        const estado = (argumentos.estado ?? argumentos._1)?.toUpperCase() as EstadoFisico;

        exigir(estadosFisicos.includes(estado), 'Estado físico inválido.');

        await servico.alterarEstado(
          obterArgumento(argumentos, 'id', 0) ?? '',
          estado,
          argumentos.justificativa ?? '',
          usuarioAtual,
        );

        console.log('Estado físico atualizado.');
      } else if (entidade === 'equipamento' && acao === 'rastrear') {
        exigir(pode(papelAtual, 'consultar'), 'Sem permissão.');

        const id = obterArgumento(argumentos, 'id', 0);
        const equipamento = servico
          .estado()
          .equipamentos.find(
            (item) => item.id === id || item.codigoBarrasInterno === id,
          );

        exigir(equipamento, 'Equipamento não encontrado.');
        console.log(JSON.stringify(equipamento, null, 2));
      } else if (entidade === 'relatorio') {
        exigir(pode(papelAtual, 'consultar'), 'Sem permissão.');

        const estado = servico.estado();

        if (acao === 'organizacoes') {
          console.table(estado.organizacoes);
        } else if (acao === 'lotes') {
          console.table(estado.lotes);
        } else if (acao === 'status') {
          console.table(
            statusRastreamento.map((status) => ({
              status,
              quantidade: estado.equipamentos.filter(
                (item) => item.statusRastreamento === status,
              ).length,
            })),
          );
        } else if (acao === 'financeiro') {
          const organizacoesAtivas = estado.organizacoes.filter(
            (item) => item.ativo && item.contratoVigente,
          );

          console.log(
            JSON.stringify(
              {
                contratosAtivos: organizacoesAtivas.length,
                receitaMensalPrevista: organizacoesAtivas.reduce(
                  (total, item) => total + (item.contratoVigente?.valorMensal ?? 0),
                  0,
                ),
                pesoTotalKg: estado.equipamentos.reduce(
                  (total, item) => total + item.pesoQuilogramas,
                  0,
                ),
              },
              null,
              2,
            ),
          );
        } else if (acao === 'organizacao') {
          const organizacao = await servico.buscarOrganizacao(
            argumentos.id ?? argumentos._0 ?? '',
          );
          const lotes = estado.lotes.filter(
            (item) => item.organizacaoId === organizacao.id,
          );
          const equipamentos = estado.equipamentos.filter((equipamento) =>
            lotes.some((lote) => lote.id === equipamento.loteId),
          );

          console.log(
            JSON.stringify(
              {
                organizacao,
                lotes: lotes.length,
                equipamentos: equipamentos.length,
                pesoTotalKg: equipamentos.reduce(
                  (total, item) => total + item.pesoQuilogramas,
                  0,
                ),
              },
              null,
              2,
            ),
          );
        } else if (acao === 'resumo') {
          console.log(
            JSON.stringify(
              {
                organizacoes: estado.organizacoes.length,
                lotes: estado.lotes.length,
                equipamentos: estado.equipamentos.length,
                pesoTotalKg: estado.equipamentos.reduce(
                  (total, item) => total + item.pesoQuilogramas,
                  0,
                ),
                porStatus: Object.fromEntries(
                  statusRastreamento.map((status) => [
                    status,
                    estado.equipamentos.filter(
                      (item) => item.statusRastreamento === status,
                    ).length,
                  ]),
                ),
              },
              null,
              2,
            ),
          );
        } else {
          exibirAjuda();
        }

        await repositorio.registrarSomente(
          'AUDITORIA',
          'Relatorio',
          null,
          { tipo: acao },
          usuarioAtual,
        );
      } else if (entidade === 'journal' && acao === 'listar') {
        exigir(pode(papelAtual, 'consultar'), 'Sem permissão.');

        const entradas = await repositorio.listarJournal();

        console.table(
          entradas.map(
            ({ id, timestamp, operacao, entidade: nomeEntidade, usuarioResponsavel }) => ({
              id,
              timestamp,
              operacao,
              entidade: nomeEntidade,
              usuarioResponsavel,
            }),
          ),
        );

        await repositorio.registrarSomente(
          'AUDITORIA',
          'Journal',
          null,
          { quantidade: entradas.length },
          usuarioAtual,
        );
      } else if (entidade === 'desfazer') {
        exigir(pode(papelAtual, 'administrar'), 'Apenas administrador pode reverter transações.');

        await servico.reverterTransacao(
          argumentos.id ?? acao ?? '',
          usuarioAtual,
        );

        console.log('Reversão registrada no journal.');
      } else {
        throw new ErroNegocio('Comando não reconhecido. Digite ajuda.');
      }
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      console.error(`[ERRO] ${mensagem}`);
    }
  }

  rl.close();
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  console.error(`[FATAL] ${mensagem}`);
  process.exitCode = 1;
});
