import {
  mkdir,
  readFile,
  rename,
  stat,
  readdir,
  unlink,
  open,
} from 'node:fs/promises';
import { join } from 'node:path';
import {
  ErroNegocio,
  estadoVazio,
  type Contrato,
  type Estado,
  type JournalTransacao,
} from './domain.js';
import { cifrar, decifrar, gravarPrivado } from './security.js';

const MAX_JOURNAL = 10 * 1024 * 1024;
const RETENCAO_DIAS = 180;

const aplicarTransacao = (estado: Estado, entrada: JournalTransacao): void => {
  const colecaoPorEntidade: Record<string, keyof Estado> = {
    Credencial: 'credenciais',
    Organizacao: 'organizacoes',
    Contrato: 'contratos',
    Lote: 'lotes',
    Equipamento: 'equipamentos',
  };
  const chaveColecao = colecaoPorEntidade[entrada.entidade];

  if (!chaveColecao) {
    throw new ErroNegocio(`Entidade inválida no journal: ${entrada.entidade}`);
  }

  const colecao = estado[chaveColecao] as Array<{ id?: string }>;
  const dadosDepois = entrada.dadosDepois as Record<string, unknown> | null;
  const dadosOrigem = entrada.dadosAntes as Record<string, unknown> | null;
  const id = String((dadosDepois ?? dadosOrigem)?.id ?? '');
  const indice = colecao.findIndex((item) => item.id === id);

  if (dadosDepois === null) {
    if (indice >= 0) {
      colecao.splice(indice, 1);
    }
  } else if (indice >= 0) {
    colecao[indice] = dadosDepois as { id?: string };
  } else {
    colecao.push(dadosDepois as { id?: string });
  }

  if (entrada.entidade === 'Contrato' && dadosDepois) {
    const organizacao = estado.organizacoes.find(
      (item) => item.id === String(dadosDepois.organizacaoId),
    );

    if (organizacao) {
      organizacao.contratoVigente = dadosDepois as unknown as Contrato;
    }
  }
};

export class RepositorioArquivo {
  private estado: Estado = estadoVazio();
  private filaTransacoes: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dir: string,
    private readonly chave: string,
  ) {}

  async inicializar(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await this.recuperar();
    await this.rotacionarJournal();
  }

  obterEstado(): Estado {
    return structuredClone(this.estado);
  }

  async transacionar<T>(
    operacao: string,
    entidade: string,
    antes: unknown,
    depois: unknown,
    usuario: string,
    alterar: (estado: Estado) => T,
  ): Promise<T> {
    const executar = async (): Promise<T> => {
      const entrada: JournalTransacao = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        operacao,
        entidade,
        dadosAntes: antes,
        dadosDepois: depois,
        usuarioResponsavel: usuario,
      };

      await this.registrarJournal(entrada);

      const copia = structuredClone(this.estado);
      const resultado = alterar(copia);

      await this.gravarEstado(copia);
      this.estado = copia;

      return resultado;
    };

    const resultado = this.filaTransacoes.then(executar, executar);
    this.filaTransacoes = resultado.then(
      () => undefined,
      () => undefined,
    );

    return resultado;
  }

  async registrarSomente(
    operacao: string,
    entidade: string,
    antes: unknown,
    depois: unknown,
    usuario: string,
  ): Promise<void> {
    const entrada: JournalTransacao = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      operacao,
      entidade,
      dadosAntes: antes,
      dadosDepois: depois,
      usuarioResponsavel: usuario,
    };

    await this.registrarJournal(entrada);
  }

  async listarJournal(): Promise<JournalTransacao[]> {
    const arquivos = (await readdir(this.dir))
      .filter((nome) => nome.startsWith('journal-') && nome.endsWith('.log'))
      .sort();
    const entradas: JournalTransacao[] = [];

    for (const arquivo of arquivos) {
      const conteudo = await readFile(join(this.dir, arquivo), 'utf8');
      const linhas = conteudo.split(/\r?\n/).filter(Boolean);

      for (const linha of linhas) {
        entradas.push(decifrar<JournalTransacao>(linha, this.chave));
      }
    }

    return entradas;
  }

  async excluirCredencial(usuario: string): Promise<void> {
    const antes = this.estado.credenciais.find(
      (credencial) => credencial.usuario === usuario,
    );

    if (!antes) {
      throw new ErroNegocio('Usuário não encontrado.');
    }

    await this.transacionar(
      'EXCLUIR',
      'Credencial',
      antes,
      null,
      'sistema',
      (estado) => {
        estado.credenciais = estado.credenciais.filter(
          (credencial) => credencial.usuario !== usuario,
        );
      },
    );
  }

  private async registrarJournal(entrada: JournalTransacao): Promise<void> {
    await this.rotacionarJournal();

    const linha = `${cifrar(entrada, this.chave)}\n`;
    const nomeArquivo = `journal-${new Date().toISOString().slice(0, 10)}-current.log`;
    const arquivo = await open(join(this.dir, nomeArquivo), 'a', 0o600);

    try {
      await arquivo.writeFile(linha, 'utf8');
      await arquivo.sync();
    } finally {
      await arquivo.close();
    }
  }

  private async gravarEstado(estado: Estado): Promise<void> {
    const arquivos: Record<string, unknown> = {
      credenciais: estado.credenciais,
      organizacoes: estado.organizacoes,
      contratos: estado.contratos,
      lotes: estado.lotes,
      equipamentos: estado.equipamentos,
    };

    for (const [nome, dados] of Object.entries(arquivos)) {
      const caminho = join(this.dir, `${nome}.enc`);
      const temporario = `${caminho}.tmp`;

      await gravarPrivado(temporario, cifrar(dados, this.chave));
      await rename(temporario, caminho);
    }
  }

  private async recuperar(): Promise<void> {
    this.estado = estadoVazio();

    const nomes = [
      'credenciais',
      'organizacoes',
      'contratos',
      'lotes',
      'equipamentos',
    ] as const;

    for (const nome of nomes) {
      try {
        const conteudo = await readFile(join(this.dir, `${nome}.enc`), 'utf8');
        (this.estado as unknown as Record<string, unknown>)[nome] = decifrar(
          conteudo,
          this.chave,
        );
      } catch (erro) {
        if ((erro as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw erro;
        }
      }
    }

    const entradas = await this.listarJournal();
    let houveAlteracao = false;

    for (const entrada of entradas) {
      const idade = Date.now() - Date.parse(entrada.timestamp);

      if (idade > RETENCAO_DIAS * 86_400_000 || entrada.operacao === 'AUDITORIA') {
        continue;
      }

      aplicarTransacao(this.estado, entrada);
      houveAlteracao = true;
    }

    if (houveAlteracao) {
      await this.gravarEstado(this.estado);
    }
  }

  private async rotacionarJournal(): Promise<void> {
    const arquivos = (await readdir(this.dir).catch(() => []))
      .filter((nome) => nome.startsWith('journal-') && nome.endsWith('.log'))
      .sort();
    const limiteRetencao = Date.now() - RETENCAO_DIAS * 86_400_000;

    for (const nome of arquivos) {
      const caminho = join(this.dir, nome);
      const dataArquivo = Date.parse(nome.slice(8, 18));

      if (dataArquivo < limiteRetencao) {
        await unlink(caminho);
        continue;
      }

      const informacoes = await stat(caminho);

      if (informacoes.size > MAX_JOURNAL) {
        const dia = nome.slice(8, 18);
        const rotacionado = join(this.dir, `journal-${dia}-${Date.now()}.log`);
        await rename(caminho, rotacionado);
      }
    }
  }
}
